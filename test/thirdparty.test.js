'use strict';

// Standalone test for the third-party discovery layer. No test framework and
// no network: global.fetch is mocked, DRY_RUN prevents real emails.
// Run with:  npm test   (or)   node test/thirdparty.test.js

process.env.DRY_RUN = '1';

const assert = require('assert');

// --- Canned aggregator pages (the CDS admit card scenario) ---
const PAGES = {
  'https://govtjobsalert.in/defence-jobs/': `<!doctype html><html><body>
    <article><h2><a href="/upsc-cds-2-2026-admit-card">UPSC CDS II 2026 Admit Card Released - Download Hall Ticket</a></h2><time>07 Sep 2026</time></article>
    <article><h2><a href="/afcat-01-2026-admit-card">AFCAT 01/2026 Admit Card Out Now</a></h2><time>06 Sep 2026</time></article>
    <article><h2><a href="/nda-2-2026-admit-card">NDA II 2026 Admit Card Download</a></h2><time>05 Sep 2026</time></article>
    <article><h2><a href="/some-teaching-job">State PGT/TGT Teacher Recruitment 2026</a></h2><time>05 Sep 2026</time></article>
  </body></html>`,
  'https://testbook.com/news/defence-jobs/': `<!doctype html><html><body>
    <article><h3><a href="https://testbook.com/news/army-tgc-143">Indian Army TGC 143 Technical Graduate Course Notification 2026</a></h3><span class="date">04 Sep 2026</span></article>
  </body></html>`,
};

global.fetch = async (url) => {
  const key = String(url);
  const html = PAGES[key];
  if (html === undefined) throw new Error('unexpected fetch: ' + key);
  return {
    ok: true,
    status: 200,
    text: async () => html,
    arrayBuffer: async () => Buffer.from(html),
  };
};

const { fetchThirdPartyListings } = require('../src/thirdparty');
const { processThirdParty } = require('../src/track');
const { buildProvisionalEmail } = require('../src/email');
const { hasConfirmedExam, upgradeProvisional, provisionalKey } = require('../src/store');
const {
  passesEmailGate,
  profileQualifies,
  isAdmitCard,
  isClosed,
  ELIGIBLE,
  NOT_ELIGIBLE,
  UNCERTAIN,
} = require('../src/eligibility');

function pass(msg) {
  console.log('PASS:', msg);
}

(async () => {
  // 1. Listings are classified against SOURCES; EXCLUDE (NDA) and unclassified
  //    (teacher job) listings are dropped.
  const listings = await fetchThirdPartyListings();
  const exams = listings.map((l) => l.matchedExamCode);
  assert.ok(exams.includes('CDS'), 'CDS admit card should be discovered');
  assert.ok(exams.includes('AFCAT'), 'AFCAT admit card should be discovered');
  assert.ok(exams.includes('TGC'), 'Army TGC should be discovered');
  assert.ok(!listings.some((l) => /nda/i.test(l.title)), 'NDA must be EXCLUDE-dropped');
  assert.ok(!listings.some((l) => /teacher/i.test(l.title)), 'unclassified job must be dropped');
  assert.strictEqual(listings.length, 3, 'exactly the 3 in-scope defence listings');
  pass('classification + EXCLUDE + unclassified drop');

  // 2. The CDS admit card produces a NEW provisional [UNCONFIRMED] email.
  const state = { updatedAt: null, records: {} };
  const results = await processThirdParty(state);
  const cds = results.find((r) => r.exam === 'CDS' && r.action === 'provisional-new');
  assert.ok(cds, 'CDS admit card should be a new provisional alert');
  const mail = buildProvisionalEmail(cds.payload);
  assert.ok(/\[UNCONFIRMED\]/.test(mail.subject), 'subject marked [UNCONFIRMED]');
  assert.ok(/CDS/.test(mail.subject), 'subject mentions CDS');
  assert.ok(/Admit Card/i.test(cds.payload.title), 'CDS admit-card wording carried through');
  assert.ok(/not yet confirmed on the official/i.test(mail.body), 'body has the verify caveat');
  pass('CDS admit-card email -> ' + mail.subject);

  // Admit cards for the other mentioned exams also alert.
  assert.ok(results.some((r) => r.exam === 'AFCAT' && r.action === 'provisional-new'), 'AFCAT admit card alerts');
  assert.ok(results.some((r) => r.exam === 'TGC' && r.action === 'provisional-new'), 'TGC alerts');
  pass('AFCAT + TGC also alert');

  // 3. Stored as provisional with origin + a shorter prune window flag.
  const cdsKey = provisionalKey('UPSC', 'CDS');
  const rec = state.records[cdsKey];
  assert.strictEqual(rec.provisional, true, 'stored as provisional');
  assert.ok(/^thirdparty:/.test(rec.origin), 'origin flagged thirdparty:<site>');
  pass('provisional storage (flag + origin)');

  // 4. Dedup: if the exam is already confirmed officially, only corroborate.
  const state2 = {
    updatedAt: null,
    records: {
      official: {
        force: 'UPSC', exam: 'CDS', subCode: 'IMA', title: 'CDS', status: 'ELIGIBLE',
        url: 'https://upsc.gov.in/x', hash: 'h', firstSeen: '2026-09-01T00:00:00Z',
        lastSeen: new Date().toISOString(),
      },
    },
  };
  assert.strictEqual(hasConfirmedExam(state2, 'UPSC', 'CDS'), true);
  const results2 = await processThirdParty(state2);
  const cds2 = results2.find((r) => r.exam === 'CDS');
  assert.strictEqual(cds2.action, 'corroborated', 'confirmed exam -> corroboration, no duplicate email');
  pass('dedup against confirmed official record');

  // 5. Re-running does not re-alert an existing provisional (refresh only).
  const rerun = await processThirdParty(state);
  assert.strictEqual(rerun.find((r) => r.exam === 'CDS').action, 'provisional-refresh', 'no duplicate provisional email');
  pass('no duplicate provisional email on re-run');

  // 6. Upgrade: official confirmation flips the provisional flag (no re-email).
  const upgraded = upgradeProvisional(state, 'UPSC', 'CDS', new Date().toISOString());
  assert.strictEqual(upgraded, true);
  assert.strictEqual(state.records[cdsKey].provisional, false, 'provisional upgraded to confirmed');
  pass('provisional -> confirmed upgrade');

  // 7. Eligibility helpers remain available; current policy emails everything.
  assert.strictEqual(isAdmitCard('UPSC CDS II 2026 Admit Card Released'), true, 'admit card detected');
  assert.strictEqual(isAdmitCard('UPSC CDS II 2026 Notification'), false, 'notification is not an admit card');

  assert.strictEqual(profileQualifies('graduate'), true, 'graduate entries qualify');
  assert.strictEqual(profileQualifies('it'), true, 'IT entries qualify (CSE)');
  assert.strictEqual(profileQualifies('engineering'), true, 'engineering entries qualify (CSE)');
  assert.strictEqual(profileQualifies('flying'), false, 'flying not qualification-gated');

  // Current policy: alert on everything, regardless of computed status.
  assert.strictEqual(passesEmailGate({ status: NOT_ELIGIBLE, subEntry: { qualType: 'graduate' }, admitCard: false }), true, 'email-all: NOT ELIGIBLE still alerts');
  assert.strictEqual(passesEmailGate({ status: ELIGIBLE, subEntry: { qualType: 'graduate' }, admitCard: false }), true, 'email-all: ELIGIBLE alerts');
  assert.strictEqual(passesEmailGate({ status: UNCERTAIN, subEntry: { qualType: 'engineering' }, admitCard: true }), true, 'email-all: admit cards alert');
  pass('email-all policy + eligibility helpers');

  // 8. A FAILED send sets pendingRetry and is retried on the next run.
  const savedUser = process.env.SMTP_USER;
  const savedPass = process.env.SMTP_PASS;
  delete process.env.DRY_RUN;    // force the real deliver() path
  delete process.env.SMTP_USER;  // guarantee makeTransport() throws -> send fails
  delete process.env.SMTP_PASS;

  const stateR = { updatedAt: null, records: {} };
  const r1 = await processThirdParty(stateR);
  const cdsR1 = r1.find((r) => r.exam === 'CDS' && r.action === 'provisional-new');
  assert.ok(cdsR1, 'CDS provisional attempted');
  assert.strictEqual(cdsR1.emailed, false, 'failed send -> emailed:false');
  const recR = stateR.records[provisionalKey('UPSC', 'CDS')];
  assert.strictEqual(recR.pendingRetry, true, 'pendingRetry set after a failed send');

  const r2 = await processThirdParty(stateR);
  assert.strictEqual(r2.find((r) => r.exam === 'CDS').action, 'provisional-retry', 'failed send is retried, not skipped');

  process.env.DRY_RUN = '1';
  if (savedUser !== undefined) process.env.SMTP_USER = savedUser;
  if (savedPass !== undefined) process.env.SMTP_PASS = savedPass;
  pass('failed send retries on next run (pendingRetry)');

  // 9. Closed application windows are suppressed (but admit cards still pass).
  assert.strictEqual(isClosed('SSC (various entries) Jun 27 Course is extended (Closed)'), true, '"(Closed)" is detected');
  assert.strictEqual(isClosed('Registration closed for this entry'), true, 'registration closed detected');
  assert.strictEqual(isClosed('Online application window is live. Login to apply.'), false, 'open window not flagged');
  assert.strictEqual(passesEmailGate({ status: UNCERTAIN, subEntry: { qualType: 'graduate' }, admitCard: false, closed: true }), false, 'closed non-admit entry is NOT emailed');
  assert.strictEqual(passesEmailGate({ status: UNCERTAIN, subEntry: { qualType: 'graduate' }, admitCard: true, closed: true }), true, 'admit card still emailed even if window closed');
  assert.strictEqual(passesEmailGate({ status: UNCERTAIN, subEntry: { qualType: 'graduate' }, admitCard: false, closed: false }), true, 'open entry still emailed');
  pass('closed applications suppressed; admit cards still alert');

  console.log('\nAll third-party tests passed.');
})().catch((err) => {
  console.error('TEST FAILED:', err && err.stack ? err.stack : err);
  process.exit(1);
});
