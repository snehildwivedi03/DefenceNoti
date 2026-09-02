'use strict';

const { parseDate, formatDate } = require('./util');

// Pull the first match of any given pattern; returns the captured group.
function pick(text, patterns) {
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return (m[1] || m[0]).replace(/\s+/g, ' ').trim();
  }
  return null;
}

// Find an age/DOB window: "born not earlier than X and not later than Y".
function parseAgeWindow(text) {
  const t = text.toLowerCase();
  const dateRe =
    '(\\d{1,2}[\\s\\-/][a-z]{3,9}[\\s\\-/,]+\\d{4}|\\d{1,2}[\\-/.]\\d{1,2}[\\-/.]\\d{4})';

  let m = t.match(
    new RegExp('not\\s*earlier\\s*than\\s*' + dateRe + '[\\s\\S]{0,60}?not\\s*later\\s*than\\s*' + dateRe, 'i')
  );
  if (m) {
    const early = parseDate(m[1]);
    const late = parseDate(m[2]);
    if (early && late) return { notEarlier: early, notLater: late, raw: m[0] };
  }

  // "between DD Mon YYYY and DD Mon YYYY"
  m = t.match(new RegExp('between\\s*' + dateRe + '\\s*and\\s*' + dateRe, 'i'));
  if (m) {
    const a = parseDate(m[1]);
    const b = parseDate(m[2]);
    if (a && b) {
      const notEarlier = a < b ? a : b;
      const notLater = a < b ? b : a;
      return { notEarlier, notLater, raw: m[0] };
    }
  }

  // "X to Y years as on DD Mon YYYY"
  m = t.match(new RegExp('(\\d{2})\\s*(?:to|-|–)\\s*(\\d{2})\\s*years[\\s\\S]{0,40}?as\\s*on\\s*' + dateRe, 'i'));
  if (m) {
    const ref = parseDate(m[3]);
    if (ref) {
      const minAge = +m[1];
      const maxAge = +m[2];
      const notLater = new Date(Date.UTC(ref.getUTCFullYear() - minAge, ref.getUTCMonth(), ref.getUTCDate()));
      const notEarlier = new Date(Date.UTC(ref.getUTCFullYear() - maxAge, ref.getUTCMonth(), ref.getUTCDate()));
      return { notEarlier, notLater, raw: m[0], ageText: `${minAge}-${maxAge} yrs as on ${formatDate(ref)}` };
    }
  }

  const raw = pick(t, [/age[^.]{0,120}(years|yrs)[^.]{0,40}/i]);
  return raw ? { raw } : null;
}

// Best-effort extraction of structured fields from notification text.
function parseNotification(text) {
  const ageWindow = parseAgeWindow(text);

  return {
    notificationDate: pickDate(text, [/date\s*of\s*notification[:\s]+([^\n.;]{6,30})/i]),
    appStart: pickDate(text, [
      /(?:application|apply|registration).{0,30}?(?:opens?|start|from|begin)[:\s]+([^\n.;]{6,30})/i,
      /opening\s*date[:\s]+([^\n.;]{6,30})/i,
    ]),
    appEnd: pickDate(text, [
      /last\s*date.{0,30}?(?:apply|application|submission|receipt)[:\s]+([^\n.;]{6,30})/i,
      /closing\s*date[:\s]+([^\n.;]{6,30})/i,
      /last\s*date[:\s]+([^\n.;]{6,30})/i,
    ]),
    examDate: pickDate(text, [/(?:date\s*of\s*)?(?:exam|examination|written\s*test)[:\s]+([^\n.;]{6,30})/i]),
    ageWindow,
    ageRequirement: ageWindow
      ? ageWindow.ageText ||
        (ageWindow.notEarlier && ageWindow.notLater
          ? `Born ${formatDate(ageWindow.notEarlier)} to ${formatDate(ageWindow.notLater)}`
          : ageWindow.raw)
      : null,
    qualification: pick(text, [
      /(?:educational\s*)?qualification[:\s]+([^\n.;]{10,200})/i,
      /(bachelor'?s?\s*(?:degree|of\s*engineering|of\s*technology)[^.;]{0,120})/i,
    ]),
    gender: pick(text, [/(unmarried\s*male|male\s*candidates?|male\s*&?\s*female|men\s*&?\s*women|women\s*candidates?)/i]),
    marital: pick(text, [/(unmarried|married)[^.;]{0,40}/i]),
    vacancies: pick(text, [/(?:total\s*)?(?:vacanc(?:y|ies)|posts?)[:\s]+(\d{1,4})/i]),
    commission: pick(text, [/(permanent\s*commission|short\s*service\s*commission|\bpc\b|\bssc\b)/i]),
    selection: pick(text, [/(written\s*exam[^.;]{0,80}|ssb[^.;]{0,80}|afsb[^.;]{0,80}|interview[^.;]{0,80})/i]),
  };
}

function pickDate(text, patterns) {
  const raw = pick(text, patterns);
  const d = parseDate(raw);
  return d ? formatDate(d) : raw;
}

module.exports = { parseNotification, parseAgeWindow };
