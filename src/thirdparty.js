'use strict';

// Secondary, NON-authoritative discovery layer. Polls third-party aggregator
// pages and cross-references their listings against the official SOURCES/EXCLUDE
// patterns to catch notifications faster or ones the official scraper missed.
// It never replaces official eligibility/date data.

const cheerio = require('cheerio');
const { SOURCES, EXCLUDE, THIRD_PARTY_SOURCES } = require('./config');
const { httpGet } = require('./fetcher');

const DEFAULT_SELECTORS = {
  item: 'article',
  link: 'h2 a, h3 a, a',
  date: 'time, .date, .entry-date',
};

// Run a listing title through the SAME anchor-matching logic the official
// pipeline uses: drop EXCLUDE hits, otherwise return the first exam whose
// `match` regex fires. Returns null when nothing (in scope) matches.
function classifyTitle(title) {
  if (!title || EXCLUDE.test(title)) return null;
  for (const source of SOURCES) {
    for (const exam of source.exams) {
      if (exam.match.test(title)) {
        return { force: source.force, exam: exam.exam, subEntry: exam.subEntries[0] };
      }
    }
  }
  return null;
}

// Pull { title, url, rawDate } tuples from one aggregator page's markup.
function extractListings($, base, selectors) {
  const sel = { ...DEFAULT_SELECTORS, ...(selectors || {}) };
  const out = [];
  const seen = new Set();
  $(sel.item).each((_, el) => {
    const $el = $(el);
    const $a = $el.find(sel.link).first();
    const title = $a.text().replace(/\s+/g, ' ').trim();
    let href = $a.attr('href') || '';
    if (!title || !href || href.startsWith('#') || href.startsWith('javascript:')) return;
    try {
      href = new URL(href, base).toString();
    } catch {
      return;
    }
    if (seen.has(href)) return;
    seen.add(href);
    const rawDate = $el.find(sel.date).first().text().replace(/\s+/g, ' ').trim() || null;
    out.push({ title, url: href, rawDate });
  });
  return out;
}

async function fetchSiteListings(site) {
  const html = await httpGet(site.url);
  const $ = cheerio.load(html);
  const raw = extractListings($, new URL(site.url), site.selectors);
  const out = [];
  for (const item of raw) {
    const match = classifyTitle(item.title);
    if (!match) continue; // unclassified or EXCLUDE -> out of scope, dropped.
    out.push({
      sourceSite: site.site,
      title: item.title,
      url: item.url,
      rawDate: item.rawDate,
      matchedExamCode: match.exam,
      force: match.force,
      qualType: match.subEntry ? match.subEntry.qualType : null,
      watch: match.subEntry ? !!match.subEntry.watch : false,
    });
  }
  return out;
}

// Fetch every configured third-party page. Each site is isolated: one site
// being unreachable or having broken markup never blocks the others.
async function fetchThirdPartyListings() {
  const out = [];
  for (const site of THIRD_PARTY_SOURCES) {
    try {
      const listings = await fetchSiteListings(site);
      out.push(...listings);
    } catch (err) {
      console.warn(`  ! third-party ${site.site} failed: ${err.message}`);
    }
  }
  return out;
}

module.exports = { fetchThirdPartyListings, classifyTitle, extractListings };
