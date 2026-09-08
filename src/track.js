'use strict';

const { SOURCES, EXCLUDE } = require('./config');
const { getLinks, extractText } = require('./fetcher');
const { parseNotification } = require('./parser');
const { classify, isAdmitCard, passesEmailGate } = require('./eligibility');
const { sendResult, sendProvisional } = require('./email');
const { load, save, prune, provisionalKey, hasConfirmedExam, upgradeProvisional } = require('./store');
const { sha256 } = require('./util');
const { fetchThirdPartyListings } = require('./thirdparty');
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
  const admitCard = isAdmitCard(`${link.text} ${text.slice(0, 3000)}`);

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
    const emailAllowed = passesEmailGate({ status: result.status, subEntry: sub, admitCard });
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

    // Safeguard: only email when eligible (admit cards gated on qualification).
    if (emailAllowed) {
      try {
        await sendResult(payload);
      } catch (err) {
        console.warn(`  ! Email failed for ${sub.code}: ${err.message}`);
      }
    } else {
      console.log(`  - suppressed (not eligible): ${exam.exam} ${sub.code} [${admitCard ? 'admit card' : result.status}]`);
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
      emailed: emailAllowed,
      firstSeen: prev ? prev.firstSeen : nowIso,
      lastSeen: nowIso,
      changed: !!prev,
    };

    // Official confirmation: retire any third-party provisional for this exam.
    // The upgrade itself does not send a new email (it was already alerted).
    if (!prev) upgradeProvisional(state, source.force, exam.exam, nowIso);
  }
}

// ---- Secondary third-party discovery layer (fully isolated) ----

function yearFromTitle(title) {
  const m = String(title).match(/\b(20\d{2})\b/);
  return m ? m[1] : '';
}

// A basic, qualType-only note for provisional entries. We deliberately do NOT
// run eligibility.classify here: sub-entry details are not available yet.
function basicProvisionalNote(qualType) {
  switch (qualType) {
    case 'graduate':
      return 'Any bachelor\u2019s degree entry (unconfirmed) \u2013 likely eligible; verify.';
    case 'it':
      return 'CSE/IT entry (unconfirmed) \u2013 likely a good fit; verify discipline list.';
    case 'engineering':
      return 'Engineering entry (unconfirmed) \u2013 verify CSE is in the discipline list.';
    case 'flying':
      return 'Flying branch (unconfirmed) \u2013 age/medical criteria apply; verify.';
    default:
      return 'Third-party listing \u2013 not yet scored.';
  }
}

async function handleThirdPartyListing(item, state) {
  const nowIso = new Date().toISOString();

  // Already tracked from an official fetch -> corroboration only, no email.
  if (hasConfirmedExam(state, item.force, item.matchedExamCode)) {
    console.log(`  ~ corroboration: ${item.matchedExamCode} already tracked officially (also seen on ${item.sourceSite}).`);
    return { action: 'corroborated', exam: item.matchedExamCode, item };
  }

  const key = provisionalKey(item.force, item.matchedExamCode);
  const prev = state.records[key];

  // Already alerted provisionally -> just refresh, do not email again.
  if (prev) {
    prev.lastSeen = nowIso;
    prev.title = item.title;
    prev.url = item.url;
    return { action: 'provisional-refresh', exam: item.matchedExamCode, item };
  }

  // Genuinely new -> store as provisional and send an [UNCONFIRMED] email.
  const note = basicProvisionalNote(item.qualType);
  const payload = {
    force: item.force,
    exam: item.matchedExamCode,
    title: item.title,
    year: yearFromTitle(item.title),
    url: item.url,
    sourceSite: item.sourceSite,
    rawDate: item.rawDate,
    status: 'UNCONFIRMED (third-party)',
    reason: note,
  };

  // Same safeguard as the official path: only alert for exams the profile
  // qualifies for (or watch/backup entries). No age criteria on these listings.
  const emailAllowed = passesEmailGate({
    subEntry: { qualType: item.qualType, watch: item.watch },
    admitCard: true,
  });

  if (emailAllowed) {
    try {
      await sendProvisional(payload);
    } catch (err) {
      console.warn(`  ! provisional email failed for ${item.matchedExamCode}: ${err.message}`);
    }
  } else {
    console.log(`  - suppressed provisional (not eligible): ${item.matchedExamCode}`);
  }

  state.records[key] = {
    force: item.force,
    exam: item.matchedExamCode,
    subCode: item.matchedExamCode,
    title: item.title,
    status: 'UNCONFIRMED',
    reason: note,
    url: item.url,
    hash: sha256(`${item.url}|${item.title}`),
    emailed: emailAllowed,
    firstSeen: nowIso,
    lastSeen: nowIso,
    provisional: true,
    origin: `thirdparty:${item.sourceSite}`,
  };

  return { action: 'provisional-new', exam: item.matchedExamCode, item, payload, emailed: emailAllowed };
}

// Never let a third-party failure block or crash the official pipeline.
async function processThirdParty(state) {
  const results = [];
  let listings;
  try {
    listings = await fetchThirdPartyListings();
  } catch (err) {
    console.warn(`  ! third-party discovery failed: ${err.message}`);
    return results;
  }
  console.log(`\n== third-party discovery :: ${listings.length} in-scope listing(s)`);
  for (const item of listings) {
    try {
      results.push(await handleThirdPartyListing(item, state));
    } catch (err) {
      console.warn(`  ! third-party listing failed (${item.matchedExamCode}): ${err.message}`);
    }
  }
  return results;
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

  // Secondary discovery layer, isolated from the official pipeline above.
  try {
    await processThirdParty(state);
  } catch (err) {
    console.warn(`  ! third-party stage failed (ignored): ${err.message}`);
  }

  prune(state);
  save(state);
  console.log(`\nDone. ${Object.keys(state.records).length} active record(s).`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { main, processSource, processLink, processThirdParty, handleThirdPartyListing };
