'use strict';

// Manual email-service check: sends ONE provisional [UNCONFIRMED] alert for the
// CDS II 2026 admit card. Uses the same email path as the tracker.
//
// Preview (no real email):
//   DRY_RUN=1 node test/send-email.js
//
// Real send — set SMTP creds in your shell FIRST (type the app password
// directly into the terminal; never commit it), then run:
//   $env:SMTP_HOST='smtp.gmail.com'; $env:SMTP_PORT='465'
//   $env:SMTP_USER='you@gmail.com';  $env:SMTP_PASS='your-16-char-app-password'
//   $env:MAIL_TO='you@gmail.com'
//   node test/send-email.js

const { sendProvisional } = require('../src/email');

const payload = {
  force: 'UPSC',
  exam: 'CDS',
  title: 'UPSC CDS (II) 2026 Admit Card Released - Download e-Admit Card / Hall Ticket',
  year: '2026',
  url: 'https://upsc.gov.in/examinations/active-examinations',
  sourceSite: 'govtjobsalert',
  rawDate: '07 Sep 2026',
  status: 'UNCONFIRMED (third-party)',
  reason: 'Test email from GovNoti email service - CDS II 2026 admit card notification.',
};

sendProvisional(payload)
  .then(() => console.log('\nEmail service check finished.'))
  .catch((err) => {
    console.error('\nEmail send failed:', err.message);
    process.exit(1);
  });
