'use strict';

const { SOURCES, EXCLUDE } = require('./config');
const { getLinks, extractText } = require('./fetcher');
const { parseNotification } = require('./parser');
const { classify } = require('./eligibility');
const { sendResult } = require('./email');
const { load, save, prune } = require('./store');
const { sha256 } = require('./util');

// Only follow links that look like a notification (PDF or advert page).
function looksLikeNotification(href, text) {
  const blob = `${href} ${text}`;
  if (EXCLUDE.test(blob)) return false;
  return /\.pdf(\?|$)/i.test(href) || /notification|advertisement|recruit|apply|circular|admit|entry|course/i.test(blob);
}

function yearFrom(text) {
  const m = text.match(/\b(20\d{2})\b/);
  return m ? m[1] : '';
}

async function processSource(source, state) {
  console.log(`\n== ${source.force} :: ${source.url}`);
  let links;
  try {
    links = await getLinks(source.url);
  } catch (err) {
    console.warn(`  ! Could not load ${source.url}: ${err.message}`);
    return;
  }

  // A link handled by a more specific exam (e.g. SSC IT) is not re-processed
  // by a broader one (e.g. SSC Officer) in the same source.
  const handled = new Set();

  for (const exam of source.exams) {
    const matched = links.filter(
      (l) =>
        !handled.has(l.href) &&
        exam.match.test(`${l.text} ${l.href}`) &&
        looksLikeNotification(l.href, l.text)
    );
    // De-duplicate by href.
    const seen = new Set();
    const uniq = matched.filter((l) => (seen.has(l.href) ? false : seen.add(l.href)));

    for (const link of uniq.slice(0, 8)) {
      handled.add(link.href);
      await processLink(source, exam, link, state);
    }
  }
}

async function processLink(source, exam, link, state) {
  const notifId = `${source.force}|${exam.exam}|${link.href}`;
  const text = await extractText(link.href);
  if (text.startsWith('__FETCH_ERROR__')) {
    console.warn(`  ! ${link.href} -> ${text}`);
    return;
  }
  const hash = sha256(text.slice(0, 20000));
  const fields = parseNotification(text);
  const year = yearFrom(`${link.text} ${text.slice(0, 400)}`);

  for (const sub of exam.subEntries) {
    const key = sha256(`${notifId}::${sub.code}`);
    const prev = state.records[key];
    const nowIso = new Date().toISOString();

    // Already emailed and content unchanged -> just refresh lastSeen.
    if (prev && prev.hash === hash) {
      prev.lastSeen = nowIso;
      continue;
    }

    const result = classify({ text, subEntry: sub, fields });
    const payload = {
      force: source.force,
      exam: exam.exam,
      subCode: sub.code,
      title: link.text || `${exam.exam} ${sub.code}`,
      year,
      status: result.status,
      reason: result.reason,
      url: link.href,
      appUrl: null,
      source: source.url,
      fields,
    };

    try {
      await sendResult(payload);
    } catch (err) {
      console.warn(`  ! Email failed for ${sub.code}: ${err.message}`);
    }

    state.records[key] = {
      force: source.force,
      exam: exam.exam,
      subCode: sub.code,
      title: payload.title,
      status: result.status,
      reason: result.reason,
      url: link.href,
      hash,
      firstSeen: prev ? prev.firstSeen : nowIso,
      lastSeen: nowIso,
      changed: !!prev,
    };
  }
}

async function main() {
  const state = load();
  for (const source of SOURCES) {
    try {
      await processSource(source, state);
    } catch (err) {
      console.warn(`  ! Source failed: ${err.message}`);
    }
  }
  prune(state);
  save(state);
  console.log(`\nDone. ${Object.keys(state.records).length} active record(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
