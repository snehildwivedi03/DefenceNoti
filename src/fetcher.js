'use strict';

const cheerio = require('cheerio');
const pdfParse = require('pdf-parse');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function httpGet(url, asBuffer = false) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: '*/*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return asBuffer ? Buffer.from(await res.arrayBuffer()) : await res.text();
}

// Return all anchors on a page as { text, href } with absolute URLs.
async function getLinks(pageUrl) {
  const html = await httpGet(pageUrl);
  const $ = cheerio.load(html);
  const base = new URL(pageUrl);
  const links = [];
  $('a[href]').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    let href = $(el).attr('href') || '';
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
    try {
      href = new URL(href, base).toString();
    } catch {
      return;
    }
    links.push({ text, href });
  });
  return links;
}

// Extract readable text from a notification URL (PDF or HTML page).
async function extractText(url) {
  try {
    if (/\.pdf(\?|$)/i.test(url)) {
      const buf = await httpGet(url, true);
      const data = await pdfParse(buf);
      return (data.text || '').replace(/\s+/g, ' ').trim();
    }
    const html = await httpGet(url);
    const $ = cheerio.load(html);
    $('script, style, nav, footer, header').remove();
    return $('body').text().replace(/\s+/g, ' ').trim();
  } catch (err) {
    return `__FETCH_ERROR__ ${err.message}`;
  }
}

module.exports = { httpGet, getLinks, extractText };
