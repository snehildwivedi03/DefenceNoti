'use strict';

const { PROFILE } = require('./config');
const { parseDate, formatDate } = require('./util');

const ELIGIBLE = 'ELIGIBLE';
const NOT_ELIGIBLE = 'NOT ELIGIBLE';
const UNCERTAIN = 'ELIGIBILITY UNCERTAIN';

const DOB = parseDate(PROFILE.dob);

// Deterministic age check against a parsed born-between window.
function checkAge(ageWindow) {
  if (!ageWindow || !ageWindow.notEarlier || !ageWindow.notLater) {
    return { status: UNCERTAIN, reason: 'Age/DOB window could not be read from the notification.' };
  }
  const early = ageWindow.notEarlier;
  const late = ageWindow.notLater;
  const myDob = `${formatDate(DOB)} (03 Sep 2003)`;
  const range = `born ${formatDate(early)} to ${formatDate(late)}`;

  if (DOB < early) {
    return { status: NOT_ELIGIBLE, reason: `DOB outside range: you are too OLD. Required ${range}; your DOB ${myDob}.` };
  }
  if (DOB > late) {
    return { status: NOT_ELIGIBLE, reason: `DOB outside range: you are too YOUNG. Required ${range}; your DOB ${myDob}.` };
  }
  return { status: ELIGIBLE, reason: `DOB within range (${range}); your DOB ${myDob}.` };
}

function checkQualification(text, qualType) {
  const t = (text || '').toLowerCase();
  const hasCse = /computer\s*science|computer\s*engineering|\bcse\b|information\s*technology|\bit\b/.test(t);
  const hasEngg = /engineering|b\.?\s*tech|b\.?\s*e\.?|technology|degree/.test(t);

  switch (qualType) {
    case 'graduate':
      // Any bachelor's degree qualifies -> B.Tech CSE is fine.
      return { status: ELIGIBLE, reason: 'Any bachelor\u2019s degree accepted; B.Tech CSE qualifies.' };

    case 'it':
      if (hasCse) return { status: ELIGIBLE, reason: 'CSE/IT discipline is explicitly accepted.' };
      return { status: UNCERTAIN, reason: 'Could not confirm CSE/IT discipline in text \u2013 verify manually.' };

    case 'engineering':
      if (hasCse) return { status: ELIGIBLE, reason: 'Engineering entry and CSE/IT discipline appears in the notification.' };
      if (hasEngg) return { status: UNCERTAIN, reason: 'Engineering entry but CSE not explicitly listed \u2013 do NOT assume; verify discipline list.' };
      return { status: UNCERTAIN, reason: 'Discipline list not readable \u2013 verify whether CSE is included.' };

    case 'flying':
      // Flying branches are age-driven; qualification rarely the blocker for a graduate.
      return { status: UNCERTAIN, reason: 'Flying branch \u2013 confirm degree + PCM and medical criteria manually.' };

    default:
      return { status: UNCERTAIN, reason: 'Qualification rule not defined \u2013 verify manually.' };
  }
}

// Combine component statuses. NOT ELIGIBLE (deterministic fail) always wins.
function combine(...parts) {
  if (parts.some((p) => p.status === NOT_ELIGIBLE)) {
    return NOT_ELIGIBLE;
  }
  if (parts.some((p) => p.status === UNCERTAIN)) {
    return UNCERTAIN;
  }
  return ELIGIBLE;
}

// Classify a single sub-entry against the profile.
function classify({ text, subEntry, fields }) {
  const age = checkAge(fields.ageWindow);
  const qual = checkQualification(text, subEntry.qualType);
  const status = combine(age, qual);

  const reasons = [`Age: ${age.reason}`, `Qualification: ${qual.reason}`];
  if (PROFILE.ncc === false) reasons.push('NCC: No (not required for this entry).');

  return { status, reason: reasons.join(' | '), ageDetail: age, qualDetail: qual };
}

const ADMIT_CARD_RE = /admit\s*card|hall\s*ticket|e-?admit|call\s*letter/i;

function isAdmitCard(text) {
  return ADMIT_CARD_RE.test(text || '');
}

// Deterministic qualification-only eligibility from the PROFILE, independent of
// any notification text. Used for admit cards / third-party listings whose text
// carries no age or qualification criteria of its own.
function profileQualifies(qualType) {
  const hasDegree = !!PROFILE.degree;
  const isEngg = PROFILE.degree === 'engineering';
  const isCse = /computer\s*science|\bcse\b|information\s*technology|\bit\b/i.test(PROFILE.discipline || '');
  switch (qualType) {
    case 'graduate':
      return hasDegree;
    case 'it':
      return isCse;
    case 'engineering':
      return isEngg && isCse;
    case 'flying':
      return false; // age + medical decide flying; not a pure qualification gate
    default:
      return false;
  }
}

// Safeguard: decide whether an alert should actually be emailed.
//   - watch (hope/backup) entries always pass, by design.
//   - admit cards carry no criteria, so gate on static PROFILE qualification.
//   - a deterministic NOT ELIGIBLE is never emailed.
//   - UNCERTAIN is emailed unless STRICT_ELIGIBLE_ONLY is set.
function passesEmailGate({ status, subEntry, admitCard }) {
  if (subEntry && subEntry.watch) return true;
  if (admitCard) return profileQualifies(subEntry ? subEntry.qualType : null);
  if (status === NOT_ELIGIBLE) return false;
  if (status === UNCERTAIN && process.env.STRICT_ELIGIBLE_ONLY) return false;
  return true;
}

module.exports = {
  classify,
  isAdmitCard,
  profileQualifies,
  passesEmailGate,
  ELIGIBLE,
  NOT_ELIGIBLE,
  UNCERTAIN,
};
