'use strict';

const nodemailer = require('nodemailer');

function makeTransport() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_USER || !SMTP_PASS) {
    throw new Error('SMTP_USER / SMTP_PASS not set (add them as GitHub Actions secrets).');
  }
  return nodemailer.createTransport({
    host: SMTP_HOST || 'smtp.gmail.com',
    port: Number(SMTP_PORT) || 465,
    secure: (Number(SMTP_PORT) || 465) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

function buildEmail(r) {
  const subject = `[${r.status}] ${r.force} ${r.exam} - ${r.subCode}${r.year ? ' ' + r.year : ''}`;
  const line = (k, v) => `${k.padEnd(22)}: ${v || 'N/A'}`;
  const body = [
    line('Entry / Exam', `${r.exam} (${r.subCode})`),
    line('Force', r.force),
    line('Course / Title', r.title),
    line('Eligibility', r.status),
    line('Reason', r.reason),
    line('Age / DOB requirement', r.fields.ageRequirement),
    line('Qualification', r.fields.qualification),
    line('Application start', r.fields.appStart),
    line('Application deadline', r.fields.appEnd),
    line('Exam date', r.fields.examDate),
    line('SSB/AFSB / Selection', r.fields.selection),
    line('Commission type', r.fields.commission),
    line('Vacancies', r.fields.vacancies),
    line('Notification link', r.url),
    line('Application link', r.appUrl || r.source),
    '',
    '>> Verify the official notification before applying. The PDF is the final authority.',
  ].join('\n');
  return { subject, body };
}

async function sendResult(r) {
  const { subject, body } = buildEmail(r);
  if (process.env.DRY_RUN) {
    console.log('--- DRY RUN EMAIL ---\n' + subject + '\n' + body + '\n');
    return;
  }
  const transport = makeTransport();
  await transport.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: process.env.MAIL_TO || process.env.SMTP_USER,
    subject,
    text: body,
  });
  console.log('Emailed:', subject);
}

module.exports = { sendResult, buildEmail };
