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

// Aggregator pages are noisy: they also link previous papers, answer keys,
// results, cut-offs, syllabi, etc. Those are not actionable notifications or
// admit cards, so drop them even when they mention an exam we track.
const NOISE = /previous\s*year|previous\s*paper|question\s*paper|answer\s*key|response\s*sheet|\bresult\b|merit\s*list|cut\s*-?off|syllabus|salary|mock\s*test|\bbooks?\b|preparation|coaching|exam\s*pattern|eligibility\s*criteria|exam\s*date|exam\s*schedule|exam\s*city|study\s*material|selection\s*process|apply\s*process/i;

// "SSC" is ambiguous: on defence sites it means Short Service Commission, but
// aggregators mix in Staff Selection Commission clerical exams (CHSL, CGL, GD
// Constable, Stenographer, CPO/SI, JE, MTS, Havaldar, Selection Post, etc.).
// Those are never officer-entry defence notifications, so drop them outright.
const SSC_CLERICAL = /\bchsl\b|\bcgl\b|\bmts\b|constable|stenographer|\bcpo\b|sub-?inspector|junior\s*engineer|\bje\b|havaldar|selection\s*post|multi\s*tasking|delhi\s*police|\bgd\b|head\s*constable|\bldc\b|\bdeo\b|scientific\s*assistant/i;

const ADMIT = /admit\s*card|hall\s*ticket|e-?admit|call\s*letter/i;

// Run a listing title through the SAME anchor-matching logic the official
// pipeline uses: drop EXCLUDE/NOISE hits, otherwise return the first exam whose
// `match` regex fires. Returns null when nothing (in scope) matches.
function classifyTitle(title) {
  if (!title || EXCLUDE.test(title) || NOISE.test(title) || SSC_CLERICAL.test(title)) return null;
  for (const source of SOURCES) {
    for (const exam of source.exams) {
      if (exam.match.test(title)) {
        return {
          force: source.force,
          exam: exam.exam,
          subEntry: exam.subEntries[0],
          admitCard: ADMIT.test(title),
        };
      }
    }
  }
  return null;
}

// Pull { title, url, rawDate } tuples from one aggregator page's markup. Uses a
// container pass first (better date association) and then a direct anchor scan
// so sites whose markup does not match the container selector (e.g. testbook)
// are still fully covered. Deduped by url+title.
function extractListings($, base, selectors) {
  const sel = { ...DEFAULT_SELECTORS, ...(selectors || {}) };
  const out = [];
  const seen = new Set();

  const add = ($a, $scope) => {
    const title = $a.text().replace(/\s+/g, ' ').trim();
    let href = $a.attr('href') || '';
    if (!title || title.length < 8 || !href || href.startsWith('#') || href.startsWith('javascript:')) return;
    try {
      href = new URL(href, base).toString();
    } catch {
      return;
    }
    const dedupe = `${href}||${title}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    const rawDate =
      ($scope && $scope.length ? $scope.find(sel.date).first().text().replace(/\s+/g, ' ').trim() : '') || null;
    out.push({ title, url: href, rawDate });
  };

  $(sel.item).each((_, el) => {
    const $el = $(el);
    const $a = $el.find(sel.link).first();
    if ($a.length) add($a, $el);
  });

  $('a').each((_, el) => {
    const $a = $(el);
    add($a, $a.closest(sel.item));
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
      admitCard: !!match.admitCard,
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
