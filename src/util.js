'use strict';

const crypto = require('crypto');

const MONTHS = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
  sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10,
  dec: 11, december: 11,
};

function sha256(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

// Parse the many date formats found in notifications into a UTC Date.
// Returns null if it cannot be parsed with confidence.
function parseDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase();

  // 03 September 2003  /  3 sep 2003  /  03-sep-2003
  let m = s.match(/(\d{1,2})[\s\-/]+([a-z]{3,9})[\s\-/,]+(\d{4})/);
  if (m && MONTHS[m[2]] !== undefined) {
    return new Date(Date.UTC(+m[3], MONTHS[m[2]], +m[1]));
  }
  // September 3, 2003
  m = s.match(/([a-z]{3,9})[\s\-/]+(\d{1,2})[\s\-/,]+(\d{4})/);
  if (m && MONTHS[m[1]] !== undefined) {
    return new Date(Date.UTC(+m[3], MONTHS[m[1]], +m[2]));
  }
  // 03-09-2003 or 03/09/2003 (DD-MM-YYYY, Indian convention)
  m = s.match(/(\d{1,2})[\-/.](\d{1,2})[\-/.](\d{4})/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  // 2003-09-03 (ISO)
  m = s.match(/(\d{4})[\-/.](\d{1,2})[\-/.](\d{1,2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));

  return null;
}

function formatDate(d) {
  if (!d || isNaN(d)) return null;
  return d.toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  return Math.floor((a.getTime() - b.getTime()) / 86400000);
}

module.exports = { sha256, parseDate, formatDate, daysBetween, MONTHS };
