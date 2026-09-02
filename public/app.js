'use strict';

const listEl = document.getElementById('list');
const filtersEl = document.getElementById('filters');
const updatedEl = document.getElementById('updated');

let records = [];
let filter = 'ALL';

function tagClass(status) {
  if (status === 'ELIGIBLE') return 'ok';
  if (status === 'NOT ELIGIBLE') return 'no';
  return 'maybe';
}

function render() {
  const rows = records
    .filter((r) => filter === 'ALL' || r.status === filter)
    .sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen));

  if (!rows.length) {
    listEl.innerHTML = '<p class="empty">no notifications tracked right now.</p>';
    return;
  }

  listEl.innerHTML = rows
    .map(
      (r) => `
      <div class="item">
        <div class="top">
          <span>${esc(r.force)} &middot; ${esc(r.exam)} &middot; ${esc(r.subCode)}${
        r.changed ? ' (updated)' : ''
      }</span>
          <span class="tag ${tagClass(r.status)}">${esc(r.status)}</span>
        </div>
        <div class="meta">${esc(r.title || '')}</div>
        <div class="reason">${esc(r.reason || '')}</div>
        <div class="meta"><a href="${esc(r.url)}" target="_blank" rel="noopener">official notification &rarr;</a></div>
      </div>`
    )
    .join('');
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function buildFilters() {
  const opts = ['ALL', 'ELIGIBLE', 'NOT ELIGIBLE', 'ELIGIBILITY UNCERTAIN'];
  filtersEl.innerHTML = opts
    .map((o) => `<button data-f="${o}"${o === filter ? ' class="active"' : ''}>${o.toLowerCase()}</button>`)
    .join('');
  filtersEl.querySelectorAll('button').forEach((b) =>
    b.addEventListener('click', () => {
      filter = b.dataset.f;
      buildFilters();
      render();
    })
  );
}

fetch('data/notifications.json?t=' + Date.now())
  .then((r) => r.json())
  .then((data) => {
    records = Object.values(data.records || {});
    updatedEl.textContent = data.updatedAt ? '\u00b7 updated ' + new Date(data.updatedAt).toLocaleString() : '';
    buildFilters();
    render();
  })
  .catch(() => {
    listEl.innerHTML = '<p class="empty">could not load state.</p>';
  });
