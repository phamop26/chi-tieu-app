import { t, setLang, getLang, catName, locale } from './i18n.js';
import * as db from './db.js';
import { readStatement, maskSensitive, norm, rowsToTransactions } from './parse.js';
import { BUILTIN_CATS, classify, learn, merchantKey, emptyModel, REVIEW_THRESHOLD, forgetCategory, shortLabel } from './classify.js';
import { monthOf, shiftMonth, monthlySeries, findRecurring, findAnomalies, buildInsights } from './insights.js';
import * as lock from './lock.js';
import { sampleCSV } from './sample.js';

// ---------------- Trạng thái ----------------
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ymNow = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

const S = {
  txs: [], cats: [], imports: [], model: emptyModel(),
  settings: { lang: 'vi', currency: 'VND', notif: false, autoLock: 60 },
  tab: 'overview', month: ymNow(), trendN: 6, trendCat: '',
  q: '', fCat: '', fMonth: '', txLimit: 150,
  skipped: new Set(), remember: true, locked: false,
};
let catMap = {};
const kindOf = id => (catMap[id] ? catMap[id].kind : 'out');
const catText = id => catName(catMap[id]);
const catOrder = id => { const i = BUILTIN_CATS.findIndex(b => b.id === id); return i < 0 ? 999 : i; };
const rebuildCatMap = () => {
  S.cats.sort((a, b) => catOrder(a.id) - catOrder(b.id) || a.id.localeCompare(b.id));
  catMap = Object.fromEntries(S.cats.map(c => [c.id, c]));
};

// ---------------- Định dạng ----------------
function money(v, compact = false) {
  const cur = S.settings.currency;
  return new Intl.NumberFormat(locale(), {
    style: 'currency', currency: cur, notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: cur === 'VND' ? (compact ? 1 : 0) : (compact ? 1 : 2),
  }).format(v);
}
const pct = v => new Intl.NumberFormat(locale(), { style: 'percent', maximumFractionDigits: 0 }).format(v);
function monthLabel(ym, style = 'long') {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(locale(), style === 'long' ? { month: 'long', year: 'numeric' } : { month: 'short' });
}
function dateLabel(d) {
  const [y, m, dd] = d.split('-').map(Number);
  return new Date(y, m - 1, dd).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtParams(p) {
  const o = {};
  for (const [k, v] of Object.entries(p || {})) {
    if ('money' in v) o[k] = money(v.money);
    else if ('pct' in v) o[k] = pct(v.pct);
    else if ('cat' in v) o[k] = catText(v.cat);
    else if ('num' in v) o[k] = v.num;
    else if ('names' in v) o[k] = v.names.map(shortLabel).join(', ');
  }
  return o;
}
const signed = v => (v > 0 ? '+' : '−') + money(Math.abs(v));

// ---------------- Dữ liệu ----------------
async function load() {
  S.settings = { ...S.settings, ...(await db.getKV('settings', {})) };
  setLang(S.settings.lang);
  S.cats = await db.getAll('cats');
  if (!S.cats.length) {
    S.cats = BUILTIN_CATS.filter(c => !c.lib).map(c => ({ id: c.id, icon: c.icon, kind: c.kind }));
    await db.putMany('cats', S.cats);
  }
  S.txs = await db.getAll('tx');
  S.imports = await db.getAll('imports');
  S.model = await db.getKV('model', emptyModel());
  rebuildCatMap();
  if (S.txs.length) S.month = monthOf(S.txs.reduce((m, x) => (x.date > m ? x.date : m), ''));
}
const saveSettings = () => db.setKV('settings', S.settings);

// Tự tạo mục mới khi gặp giao dịch thuộc mục có trong thư viện nhưng chưa dùng.
function ensureCat(id) {
  if (catMap[id]) return false;
  const b = BUILTIN_CATS.find(c => c.id === id);
  const cat = b ? { id, icon: b.icon, kind: b.kind, auto: true } : { id, icon: '📦', kind: 'out', name: id };
  S.cats.push(cat); rebuildCatMap(); db.put('cats', cat);
  return true;
}

function applyClassification(tx) {
  const r = classify(tx, S.model, id => !!catMap[id]);
  tx.cat = r.cat; tx.conf = r.conf; tx.alts = r.alts;
  tx.status = r.conf >= REVIEW_THRESHOLD ? 'auto' : 'review';
  ensureCat(tx.cat);
}

function fnv(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

async function ingest(raw, source) {
  const importId = 'imp' + Date.now().toString(36);
  const existing = new Set(S.txs.map(x => x.id));
  const occ = {}; const added = []; let dups = 0;
  const catsBefore = new Set(S.cats.map(c => c.id));
  for (const r of raw) {
    const desc = maskSensitive(r.desc);
    const base = fnv(r.date + '|' + r.amount + '|' + norm(desc));
    occ[base] = (occ[base] || 0) + 1;
    const id = base + '.' + occ[base];
    if (existing.has(id)) { dups++; continue; }
    const tx = { id, date: r.date, amount: r.amount, desc, importId };
    applyClassification(tx);
    added.push(tx);
  }
  if (added.length) {
    S.txs.push(...added);
    await db.putMany('tx', added);
    const imp = { id: importId, name: source, at: new Date().toISOString(), count: added.length, dups };
    S.imports.push(imp); await db.put('imports', imp);
    S.month = monthOf(added.reduce((m, x) => (x.date > m ? x.date : m), ''));
  }
  const newCats = S.cats.filter(c => !catsBefore.has(c.id));
  const review = added.filter(x => x.status === 'review').length;
  return { added: added.length, dups, review, newCats };
}

async function importFiles(files) {
  for (const file of files) {
    toast(t('importing'), 60000);
    let res;
    try { res = await readStatement(file); } catch (e) { toast(t('importFail', { e: e.message || e })); continue; }
    let txs = res.txs;
    if (res.needsMapping) { txs = await mappingDialog(res.rows); if (!txs) { hideToast(); continue; } }
    if (!txs || !txs.length) { toast(t('importNone')); continue; }
    const r = await ingest(txs, file.name || 'statement');
    hideToast();
    render();
    showImportSummary(r);
    notifyImport(r);
  }
}

async function notifyImport(r) {
  if (!S.settings.notif || !('Notification' in window) || Notification.permission !== 'granted' || !r.added) return;
  const body = r.review ? t('notifReview', { n: r.review }) : t('importSummary', { n: r.added, dup: '', r: 0 });
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const opts = { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'import', silent: true };
    if (reg) reg.showNotification(t('newStatement'), opts); else new Notification(t('newStatement'), opts);
  } catch (e) { /* bỏ qua */ }
}

// Xác nhận mục của một giao dịch + học cho lần sau.
async function confirmTx(tx, cat, remember = true) {
  tx.cat = cat; tx.status = 'confirmed'; tx.conf = 1;
  const changed = [tx];
  let n = 0;
  if (remember) {
    learn(S.model, tx, cat);
    const key = merchantKey(tx.desc);
    const sign = Math.sign(tx.amount);
    for (const o of S.txs) {
      if (o === tx || o.status === 'confirmed') continue;
      if (key && Math.sign(o.amount) === sign && merchantKey(o.desc) === key) {
        if (o.cat !== cat || o.status === 'review') n++;
        o.cat = cat; o.status = 'auto'; o.conf = 0.9; changed.push(o);
      } else if (o.status === 'review') {
        const before = o.cat;
        applyClassification(o);
        if (o.status !== 'review') { n++; changed.push(o); } else if (o.cat !== before) changed.push(o);
      }
    }
    await db.setKV('model', S.model);
  }
  await db.putMany('tx', changed);
  return n;
}

// ---------------- Giao diện chung ----------------
let toastTimer;
function toast(msg, ms = 3500) {
  const el = $('#toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(hideToast, ms);
}
function hideToast() { $('#toast').classList.remove('show'); }

let sheetResolve = null;
function openSheet(html, onClose) {
  const sh = $('#sheet');
  sh.innerHTML = `<div class="sheet-backdrop" data-act="sheet-close"></div><div class="sheet-panel" role="dialog" aria-modal="true"><div class="sheet-grip"></div>${html}</div>`;
  sh.hidden = false;
  requestAnimationFrame(() => sh.classList.add('open'));
  sheetResolve = onClose || null;
}
function closeSheet(value) {
  const sh = $('#sheet');
  sh.classList.remove('open');
  setTimeout(() => { sh.hidden = true; sh.innerHTML = ''; }, 200);
  const r = sheetResolve; sheetResolve = null;
  if (r) r(value);
}

const ICONS = {
  overview: '<path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1z"/>',
  trends: '<path d="M4 19h16M7 16v-4M12 16V8M17 16v-6"/>',
  review: '<rect x="5" y="4" width="14" height="16" rx="3"/><path d="m9 12 2 2 4-4"/>',
  tx: '<path d="M5 7h14M5 12h14M5 17h9"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>',
};
const svgIcon = n => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]}</svg>`;

function renderTabs() {
  const n = S.txs.filter(x => x.status === 'review').length;
  $('#tabs').innerHTML = ['overview', 'trends', 'review', 'tx', 'settings'].map(k => {
    const label = t({ overview: 'tabOverview', trends: 'tabTrends', review: 'tabReview', tx: 'tabTx', settings: 'tabSettings' }[k]);
    const badge = k === 'review' && n ? `<span class="badge">${n > 99 ? '99+' : n}</span>` : '';
    return `<button class="tab ${S.tab === k ? 'on' : ''}" data-act="tab" data-tab="${k}" aria-current="${S.tab === k ? 'page' : 'false'}">${svgIcon(k)}${badge}<span>${esc(label)}</span></button>`;
  }).join('');
}

function render() {
  document.title = t('appName');
  renderTabs();
  const v = $('#view');
  const views = { overview: viewOverview, trends: viewTrends, review: viewReview, tx: viewTx, settings: viewSettings };
  v.innerHTML = views[S.tab]();
  if (S.tab === 'review') attachSwipe();
  if (S.tab === 'trends') attachChart();
}

function monthBounds() {
  if (!S.txs.length) return [ymNow(), ymNow()];
  let a = '9999', b = '0000';
  for (const x of S.txs) { const m = monthOf(x.date); if (m < a) a = m; if (m > b) b = m; }
  return [a, b > ymNow() ? b : ymNow()];
}
function monthSwitcher() {
  const [a, b] = monthBounds();
  return `<div class="month-switch">
    <button class="icon-btn" data-act="month" data-d="-1" ${S.month <= a ? 'disabled' : ''} aria-label="‹">‹</button>
    <h2>${esc(monthLabel(S.month))}</h2>
    <button class="icon-btn" data-act="month" data-d="1" ${S.month >= b ? 'disabled' : ''} aria-label="›">›</button>
  </div>`;
}

// ---------------- Tổng quan ----------------
function welcome() {
  return `<section class="welcome">
    <div class="welcome-art">💸</div>
    <h1>${esc(t('welcomeTitle'))}</h1>
    <p>${esc(t('welcomeBody'))}</p>
    <button class="btn primary big" data-act="import">${esc(t('importBtn'))}</button>
    <button class="btn ghost" data-act="sample">${esc(t('sampleBtn'))}</button>
    <p class="privacy-note">🔒 ${esc(t('welcomePrivacy'))} <a href="#" data-act="privacy">${esc(t('whereData'))}</a></p>
  </section>`;
}

function viewOverview() {
  if (!S.txs.length) return welcome();
  const rec = findRecurring(S.txs, kindOf);
  const { cur, prev, list } = buildInsights(S.txs, S.month, kindOf, rec);
  const dups = findAnomalies(S.txs, S.month, kindOf).filter(a => a.type === 'dup').length;
  if (dups) list.push({ icon: '👀', key: 'insDup', p: { n: { num: dups } } });
  const reviewN = S.txs.filter(x => x.status === 'review').length;
  let cmp;
  if (!prev.out) cmp = t('vsLastNone');
  else {
    const ch = cur.out / prev.out - 1;
    cmp = Math.abs(ch) < 0.03 ? t('vsLastSame') : t(ch > 0 ? 'vsLastMore' : 'vsLastLess', { p: pct(Math.abs(ch)) });
    if (prev.partial) cmp += t('samePeriod');
  }
  const maxV = cur.cats.length ? cur.cats[0].v : 1;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  return `
  <header class="top"><span class="brand">${esc(t('appName'))}</span><button class="btn small primary" data-act="import">＋ ${esc(t('importBtn'))}</button></header>
  ${monthSwitcher()}
  <section class="hero card">
    <div class="hero-label">${esc(t('spent'))}</div>
    <div class="hero-value">${esc(money(cur.out))}</div>
    <div class="hero-cmp">${esc(cmp)}</div>
    <div class="hero-row">
      <div><span class="muted">${esc(t('income'))}</span><b>${esc(money(cur.inc))}</b></div>
      <div><span class="muted">${esc(t('net'))}</span><b>${esc(money(cur.inc - cur.out))}</b></div>
      <div><span class="muted">${esc(t('txCount', { n: '' }).trim())}</span><b>${cur.count}</b></div>
    </div>
  </section>
  ${reviewN ? `<button class="review-banner card" data-act="tab" data-tab="review">
      <span class="rb-icon">🗂️</span><span><b>${esc(t('reviewBanner', { n: reviewN }))}</b><small>${esc(t('reviewBannerSub'))}</small></span><span class="rb-go">${esc(t('reviewNow'))} ›</span>
    </button>` : ''}
  ${cur.count ? `
  <section class="card">
    <h3>${esc(t('notes'))}</h3>
    <ul class="insights">${list.map(i => `<li><span class="ins-icon">${i.icon}</span><span>${esc(t(i.key, fmtParams(i.p)))}</span></li>`).join('')}</ul>
  </section>
  <section class="card">
    <h3>${esc(t('byCategory'))}</h3>
    <ul class="cat-bars">${cur.cats.map(c => `
      <li><button data-act="cat-filter" data-cat="${esc(c.cat)}">
        <span class="cb-icon">${catMap[c.cat]?.icon || '📦'}</span>
        <span class="cb-main"><span class="cb-top"><span class="cb-name">${esc(catText(c.cat))}</span><span class="cb-val">${esc(money(c.v))}</span></span>
        <span class="cb-track"><span class="cb-fill" style="width:${Math.max(2, (c.v / maxV) * 100).toFixed(1)}%"></span></span>
        <span class="cb-pct muted">${esc(pct(cur.out ? c.v / cur.out : 0))}</span></span>
      </button></li>`).join('')}</ul>
  </section>` : `<p class="empty card">${esc(t('noData'))}</p>`}
  ${standalone ? '' : `<p class="hint">📲 ${esc(t('installHint'))}</p>`}`;
}

// ---------------- Xu hướng ----------------
function viewTrends() {
  if (!S.txs.length) return welcome();
  const [, maxM] = monthBounds();
  let endYm = maxM;
  if (S.month < shiftMonth(maxM, -(S.trendN - 1))) endYm = shiftMonth(S.month, S.trendN - 1);
  const series = monthlySeries(S.txs, endYm, S.trendN, kindOf, S.trendCat);
  const usedCats = [...new Set(S.txs.filter(x => x.amount < 0 && kindOf(x.cat) !== 'neutral').map(x => x.cat))];
  const rec = findRecurring(S.txs, kindOf);
  const anom = findAnomalies(S.txs, S.month, kindOf);
  window.__series = series;
  return `
  <header class="top"><span class="brand">${esc(t('tabTrends'))}</span></header>
  <section class="card">
    <div class="row-between"><h3>${esc(t('monthlySpend'))}${S.trendCat ? ' · ' + esc(catText(S.trendCat)) : ''}</h3>
      <div class="seg">${[6, 12].map(n => `<button class="${S.trendN === n ? 'on' : ''}" data-act="trend-n" data-n="${n}">${esc(t('months' + n))}</button>`).join('')}</div></div>
    <div class="chips scroll">${['', ...usedCats].map(c => `<button class="chip ${S.trendCat === c ? 'on' : ''}" data-act="trend-cat" data-cat="${esc(c)}">${c ? (catMap[c]?.icon || '') + ' ' + esc(catText(c)) : esc(t('allCats'))}</button>`).join('')}</div>
    <div class="chart" id="chart">${barChart(series)}<div class="tip" id="tip" hidden></div></div>
    <details class="table-view"><summary>${esc(t('tableView'))}</summary>
      <table><thead><tr><th>${esc(t('month'))}</th><th class="num">${esc(t('amount'))}</th></tr></thead>
      <tbody>${series.map(s => `<tr><td>${esc(monthLabel(s.ym))}</td><td class="num">${esc(money(s.v))}</td></tr>`).join('')}</tbody></table>
    </details>
  </section>
  ${monthSwitcher()}
  <section class="card">
    <h3>${esc(t('anomTitle'))}</h3>
    ${anom.length ? `<ul class="list">${anom.map(a => anomItem(a)).join('')}</ul>` : `<p class="muted">${esc(t('anomEmpty'))}</p>`}
  </section>
  <section class="card">
    <h3>${esc(t('recurringTitle'))}</h3>
    ${rec.length ? `<ul class="list">${rec.map(r => `
      <li class="li"><span class="li-icon">${catMap[r.cat]?.icon || '🔄'}</span>
        <span class="li-main"><b>${esc(shortLabel(r.desc))}</b>${r.isNew ? ` <span class="pill new">${esc(t('recurringNew'))}</span>` : ''}
        <small class="muted">${esc(catText(r.cat))} · ${esc(t('nextAround', { d: dateLabel(r.next) }))}</small></span>
        <span class="li-amt">${esc(money(r.amount))}<small class="muted">${esc(t({ month: 'perMonth', week: 'perWeek', year: 'perYear' }[r.period]))}</small></span></li>`).join('')}</ul>`
      : `<p class="muted">${esc(t('recurringEmpty'))}</p>`}
  </section>`;
}

function anomItem(a) {
  if (a.type === 'big') return `<li class="li"><span class="li-icon">📌</span><span class="li-main"><b>${esc(shortLabel(a.tx.desc))}</b><small class="muted">${esc(dateLabel(a.tx.date))} · ${esc(t('anomBig', { x: a.ratio, c: catText(a.tx.cat) }))}</small></span><span class="li-amt">${esc(money(-a.tx.amount))}</span></li>`;
  if (a.type === 'spike') return `<li class="li"><span class="li-icon">${catMap[a.cat]?.icon || '📈'}</span><span class="li-main"><b>${esc(catText(a.cat))}</b><small class="muted">${esc(t('anomSpike', { c: catText(a.cat), m: monthLabel(S.month), d: pct(a.pct) }))}</small></span><span class="li-amt">${esc(money(a.cur))}</span></li>`;
  return `<li class="li"><span class="li-icon">👀</span><span class="li-main"><b>${esc(shortLabel(a.tx.desc))}</b><small class="muted">${esc(dateLabel(a.tx.date))} · ${esc(t('anomDup', { a: money(-a.tx.amount) }))}</small></span><span class="li-amt">${esc(money(-a.tx.amount))}</span></li>`;
}

function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
function barChart(series) {
  const W = 340, H = 190, top = 22, bottom = 26, left = 4, right = 4;
  const ph = H - top - bottom, pw = W - left - right;
  const max = niceMax(Math.max(...series.map(s => s.v), 1));
  const col = pw / series.length;
  const bw = Math.min(28, col * 0.56);
  const grid = [0.5, 1].map(f => {
    const y = top + ph - f * ph;
    return `<line class="grid" x1="${left}" x2="${W - right}" y1="${y}" y2="${y}"/><text class="axis" x="${left}" y="${y - 4}">${esc(money(max * f, true))}</text>`;
  }).join('');
  const bars = series.map((s, i) => {
    const h = (s.v / max) * ph;
    const x = left + i * col + (col - bw) / 2;
    const y = top + ph - h;
    const r = Math.min(4, h, bw / 2);
    const sel = s.ym === S.month;
    const path = h > 0 ? `M${x},${top + ph} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${top + ph} Z` : '';
    const label = sel && s.v > 0 ? `<text class="val" x="${x + bw / 2}" y="${y - 6}" text-anchor="middle">${esc(money(s.v, true))}</text>` : '';
    return `<g class="bar ${sel ? 'sel' : ''}" data-i="${i}">
      <rect class="hit" x="${left + i * col}" y="${top - 10}" width="${col}" height="${ph + 10 + bottom}" data-act="chart-bar" data-ym="${s.ym}"/>
      ${path ? `<path class="mark" d="${path}"/>` : ''}${label}
      <text class="axis ${sel ? 'strong' : ''}" x="${left + i * col + col / 2}" y="${H - 8}" text-anchor="middle">${esc(monthLabel(s.ym, 'short'))}</text></g>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('monthlySpend'))}">${grid}<line class="base" x1="${left}" x2="${W - right}" y1="${top + ph}" y2="${top + ph}"/>${bars}</svg>`;
}
function attachChart() {
  const chart = $('#chart'), tip = $('#tip');
  if (!chart) return;
  const show = e => {
    const g = e.target.closest('.bar');
    if (!g) { tip.hidden = true; return; }
    const s = window.__series[+g.dataset.i];
    tip.innerHTML = `<b>${esc(monthLabel(s.ym))}</b><br>${esc(money(s.v))}`;
    tip.hidden = false;
    const r = chart.getBoundingClientRect(), br = g.querySelector('.hit').getBoundingClientRect();
    const x = Math.min(Math.max(br.left - r.left + br.width / 2, 60), r.width - 60);
    tip.style.left = x + 'px';
  };
  chart.addEventListener('pointermove', show);
  chart.addEventListener('pointerdown', show);
  chart.addEventListener('pointerleave', () => { tip.hidden = true; });
}

// ---------------- Xem lại ----------------
function reviewList() {
  return S.txs.filter(x => x.status === 'review')
    .sort((a, b) => (S.skipped.has(a.id) - S.skipped.has(b.id)) || Math.abs(b.amount) - Math.abs(a.amount));
}
function catChoices(tx) {
  const want = tx.amount < 0 ? ['out', 'neutral'] : ['in', 'neutral', 'out'];
  const first = [tx.cat, ...(tx.alts || [])].filter(c => catMap[c]);
  const rest = S.cats.filter(c => want.includes(c.kind) && !first.includes(c.id)).map(c => c.id);
  if (tx.amount >= 0) rest.sort((a, b) => (kindOf(a) === 'out') - (kindOf(b) === 'out'));
  return [...new Set([...first, ...rest])];
}
function viewReview() {
  const list = reviewList();
  if (!list.length) return `<header class="top"><span class="brand">${esc(t('reviewTitle'))}</span></header>
    <section class="welcome"><div class="welcome-art">🌿</div><h1>${esc(t('reviewEmpty'))}</h1><p>${esc(t('reviewEmptySub'))}</p></section>`;
  const tx = list[0];
  const total = list.length;
  const sug = catMap[tx.cat] && tx.conf > 0.3 ? tx.cat : null;
  const choices = catChoices(tx).filter(c => c !== sug);
  return `
  <header class="top"><span class="brand">${esc(t('reviewTitle'))}</span><span class="muted">${esc(t('progress', { i: 1, n: total }))}</span></header>
  <div class="rv-stack">
    ${total > 1 ? '<div class="rv-card ghost-card"></div>' : ''}
    <article class="rv-card card" id="rv-card" data-id="${esc(tx.id)}">
      <div class="rv-stamp yes">✓</div><div class="rv-stamp later">⏭</div>
      <div class="rv-date muted">${esc(dateLabel(tx.date))}</div>
      <div class="rv-amount ${tx.amount > 0 ? 'in' : ''}">${esc(signed(tx.amount))}</div>
      <div class="rv-desc">${esc(tx.desc)}</div>
      <div class="rv-sug">${sug ? `${esc(t('isThisRight', { c: catText(sug) }))} <span class="big-emoji">${catMap[sug].icon}</span>` : esc(t('noSuggestion'))}</div>
    </article>
  </div>
  <div class="rv-actions">
    <button class="btn round later" data-act="rv-later" aria-label="${esc(t('later'))}">⏭<span>${esc(t('later'))}</span></button>
    ${sug ? `<button class="btn round yes" data-act="rv-yes" aria-label="${esc(t('correct'))}">✓<span>${esc(t('correct'))}</span></button>` : ''}
  </div>
  <p class="muted center small">${esc(t('swipeHint'))}</p>
  <section class="card">
    <h3>${esc(sug ? t('pickOther') : t('suggestion'))}</h3>
    <div class="chips">${choices.map(c => `<button class="chip" data-act="rv-pick" data-cat="${esc(c)}">${catMap[c].icon} ${esc(catText(c))}</button>`).join('')}
      <button class="chip dashed" data-act="rv-new">＋ ${esc(t('newCat'))}</button></div>
    <label class="check"><input type="checkbox" data-chg="remember" ${S.remember ? 'checked' : ''}> ${esc(t('rememberSimilar'))}</label>
  </section>`;
}

async function reviewDecide(cat) {
  const card = $('#rv-card');
  const tx = S.txs.find(x => x.id === card?.dataset.id);
  if (!tx) return;
  const n = await confirmTx(tx, cat, S.remember);
  if (n) toast(t('learnedN', { n }));
  render();
}
function reviewLater() {
  const card = $('#rv-card');
  if (!card) return;
  S.skipped.add(card.dataset.id);
  render();
}
function attachSwipe() {
  const card = $('#rv-card');
  if (!card) return;
  let x0 = null, dx = 0;
  card.addEventListener('pointerdown', e => { x0 = e.clientX; dx = 0; card.setPointerCapture(e.pointerId); card.classList.add('dragging'); });
  card.addEventListener('pointermove', e => {
    if (x0 === null) return;
    dx = e.clientX - x0;
    card.style.transform = `translateX(${dx}px) rotate(${dx / 20}deg)`;
    card.classList.toggle('to-yes', dx > 40); card.classList.toggle('to-later', dx < -40);
  });
  const end = () => {
    if (x0 === null) return;
    x0 = null; card.classList.remove('dragging');
    const canYes = !!$('[data-act="rv-yes"]');
    if (dx > 90 && canYes) { card.style.transform = 'translateX(120%) rotate(12deg)'; setTimeout(() => reviewDecide(S.txs.find(x => x.id === card.dataset.id).cat), 160); }
    else if (dx < -90) { card.style.transform = 'translateX(-120%) rotate(-12deg)'; setTimeout(reviewLater, 160); }
    else { card.style.transform = ''; card.classList.remove('to-yes', 'to-later'); }
  };
  card.addEventListener('pointerup', end);
  card.addEventListener('pointercancel', end);
}

// ---------------- Giao dịch ----------------
function filteredTx() {
  const q = norm(S.q);
  return S.txs.filter(x => (!S.fCat || x.cat === S.fCat) && (!S.fMonth || monthOf(x.date) === S.fMonth) && (!q || norm(x.desc).includes(q) || norm(catText(x.cat)).includes(q)))
    .sort((a, b) => b.date.localeCompare(a.date) || a.amount - b.amount);
}
function viewTx() {
  const months = [...new Set(S.txs.map(x => monthOf(x.date)))].sort().reverse();
  return `
  <header class="top"><span class="brand">${esc(t('tabTx'))}</span><button class="btn small primary" data-act="import">＋ ${esc(t('importBtn'))}</button></header>
  <div class="filters">
    <input type="search" id="q" placeholder="${esc(t('search'))}" value="${esc(S.q)}" data-chg="q" autocomplete="off">
    <div class="filter-row">
      <select data-chg="fMonth"><option value="">${esc(t('allMonths'))}</option>${months.map(m => `<option value="${m}" ${S.fMonth === m ? 'selected' : ''}>${esc(monthLabel(m))}</option>`).join('')}</select>
      <select data-chg="fCat"><option value="">${esc(t('allCats'))}</option>${S.cats.map(c => `<option value="${esc(c.id)}" ${S.fCat === c.id ? 'selected' : ''}>${c.icon} ${esc(catName(c))}</option>`).join('')}</select>
    </div>
  </div>
  <div id="tx-list">${txListHtml()}</div>`;
}
function txListHtml() {
  const list = filteredTx();
  if (!list.length) return `<p class="empty card">${esc(t('noTx'))}</p>`;
  let html = '', lastDate = '';
  for (const x of list.slice(0, S.txLimit)) {
    if (x.date !== lastDate) { if (lastDate) html += '</ul>'; html += `<h4 class="day">${esc(dateLabel(x.date))}</h4><ul class="list card">`; lastDate = x.date; }
    const neutral = kindOf(x.cat) === 'neutral';
    html += `<li><button class="li" data-act="tx-open" data-id="${esc(x.id)}">
      <span class="li-icon">${catMap[x.cat]?.icon || '📦'}</span>
      <span class="li-main"><b>${esc(shortLabel(x.desc))}</b><small class="muted">${esc(catText(x.cat))}${x.status === 'review' ? ` · <span class="pill">${esc(t('statusReview'))}</span>` : ''}${neutral ? ` · ${esc(t('excluded'))}` : ''}</small><small class="desc">${esc(x.desc)}</small></span>
      <span class="li-amt ${x.amount > 0 ? 'in' : ''}">${esc(signed(x.amount))}</span></button></li>`;
  }
  html += '</ul>';
  if (list.length > S.txLimit) html += `<button class="btn ghost wide" data-act="more">… ${list.length - S.txLimit}</button>`;
  return html;
}
function openTxSheet(tx) {
  openSheet(`
    <h3>${esc(t('editCat'))}</h3>
    <p class="muted">${esc(dateLabel(tx.date))} · <b>${esc(signed(tx.amount))}</b></p>
    <p class="desc-box">${esc(tx.desc)}</p>
    <div class="chips">${catChoices(tx).map(c => `<button class="chip ${c === tx.cat ? 'on' : ''}" data-act="tx-pick" data-id="${esc(tx.id)}" data-cat="${esc(c)}">${catMap[c].icon} ${esc(catText(c))}</button>`).join('')}
    <button class="chip dashed" data-act="tx-new" data-id="${esc(tx.id)}">＋ ${esc(t('newCat'))}</button></div>
    <label class="check"><input type="checkbox" data-chg="remember" ${S.remember ? 'checked' : ''}> ${esc(t('rememberSimilar'))}</label>
    <button class="btn ghost wide" data-act="sheet-close">${esc(t('close'))}</button>`);
}

// ---------------- Mục mới ----------------
function newCatDialog() {
  return new Promise(resolve => {
    openSheet(`
      <h3>${esc(t('newCat'))}</h3>
      <label class="field">${esc(t('catName'))}<input id="nc-name" maxlength="30" autocomplete="off"></label>
      <label class="field">${esc(t('catIcon'))}<input id="nc-icon" maxlength="4" value="🏷️"></label>
      <div class="emoji-row">${['🏷️', '☕', '🎮', '🏋️', '👶', '🐶', '🎓', '🚗', '🏠', '💼', '🎁', '🧾'].map(e => `<button class="chip" data-act="nc-emoji" data-e="${e}">${e}</button>`).join('')}</div>
      <div class="row-gap"><button class="btn ghost" data-act="sheet-close">${esc(t('cancel'))}</button><button class="btn primary" data-act="nc-save">${esc(t('save'))}</button></div>`,
      v => resolve(v || null));
    setTimeout(() => $('#nc-name')?.focus(), 250);
  });
}
async function createCat(name, icon, kind = 'out') {
  const cat = { id: 'c_' + Date.now().toString(36), name, icon: icon || '🏷️', kind };
  S.cats.push(cat); rebuildCatMap(); await db.put('cats', cat);
  return cat.id;
}

// ---------------- Ánh xạ cột thủ công ----------------
function mappingDialog(rows) {
  return new Promise(resolve => {
    const width = Math.max(...rows.slice(0, 30).map(r => r.length));
    let headerRow = 0;
    for (let i = 0; i < Math.min(rows.length, 30); i++) if (rows[i].filter(c => String(c).trim()).length >= Math.min(3, width)) { headerRow = i; break; }
    const colName = i => String(rows[headerRow][i] ?? '').trim() || `#${i + 1}`;
    const opts = sel => `<option value="">${esc(t('colNone'))}</option>` + Array.from({ length: width }, (_, i) => `<option value="${i}" ${sel === i ? 'selected' : ''}>${esc(colName(i))}</option>`).join('');
    const preview = rows.slice(headerRow, headerRow + 5).map(r => `<tr>${Array.from({ length: width }, (_, i) => `<td>${esc(String(r[i] ?? '').slice(0, 24))}</td>`).join('')}</tr>`).join('');
    openSheet(`
      <h3>${esc(t('mapTitle'))}</h3><p class="muted">${esc(t('mapBody'))}</p>
      <div class="preview"><table>${preview}</table></div>
      ${['date', 'desc', 'amount', 'debit', 'credit'].map(role => `<label class="field">${esc(t({ date: 'colDate', desc: 'colDesc', amount: 'colAmount', debit: 'colDebit', credit: 'colCredit' }[role]))}<select id="map-${role}">${opts(role === 'date' ? 0 : role === 'desc' ? 1 : role === 'amount' ? 2 : null)}</select></label>`).join('')}
      <div class="row-gap"><button class="btn ghost" data-act="sheet-close">${esc(t('cancel'))}</button><button class="btn primary" data-act="map-ok">${esc(t('continue'))}</button></div>`,
      v => resolve(v || null));
    window.__mapRows = { rows, headerRow };
  });
}

// ---------------- Cài đặt ----------------
function viewSettings() {
  const counts = {};
  for (const x of S.txs) counts[x.cat] = (counts[x.cat] || 0) + 1;
  const sec = S._sec || {};
  return `
  <header class="top"><span class="brand">${esc(t('tabSettings'))}</span></header>
  <section class="card settings">
    <label class="set-row"><span>🌐 ${esc(t('language'))}</span><select data-chg="lang">${[['vi', 'Tiếng Việt'], ['en', 'English'], ['fr', 'Français']].map(([k, n]) => `<option value="${k}" ${getLang() === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    <label class="set-row"><span>💱 ${esc(t('currency'))}</span><select data-chg="currency">${['VND', 'USD', 'EUR'].map(c => `<option ${S.settings.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
  </section>
  <h4 class="sec-title">${esc(t('security'))}</h4>
  <section class="card settings">
    <div class="set-row"><span>🔒 ${esc(t('pinLock'))}</span>${sec.pin ? `<span class="row-gap"><button class="btn small ghost" data-act="pin-change">${esc(t('pinChange'))}</button><button class="btn small ghost" data-act="pin-remove">${esc(t('pinRemove'))}</button></span>` : `<button class="btn small primary" data-act="pin-set">${esc(t('pinSet'))}</button>`}</div>
    <label class="set-row"><span>🫆 ${esc(t('bio'))}</span><input type="checkbox" class="switch" data-chg="bio" ${sec.bio ? 'checked' : ''} ${sec.pin && sec.bioOk ? '' : 'disabled'}></label>
    ${!sec.bioOk ? `<p class="muted small">${esc(t('bioUnsupported'))}</p>` : !sec.pin ? `<p class="muted small">${esc(t('bioNeedPin'))}</p>` : ''}
    <label class="set-row"><span>⏱️ ${esc(t('autoLock'))}</span><select data-chg="autoLock" ${sec.pin ? '' : 'disabled'}>${[[0, 'autoLockNow'], [60, 'autoLock1'], [300, 'autoLock5']].map(([v, k]) => `<option value="${v}" ${S.settings.autoLock === v ? 'selected' : ''}>${esc(t(k))}</option>`).join('')}</select></label>
  </section>
  <h4 class="sec-title">${esc(t('notif'))}</h4>
  <section class="card settings">
    <label class="set-row"><span>🔔 ${esc(t('notifToggle'))}</span><input type="checkbox" class="switch" data-chg="notif" ${S.settings.notif ? 'checked' : ''}></label>
    ${'Notification' in window && Notification.permission === 'denied' ? `<p class="muted small">${esc(t('notifDenied'))}</p>` : ''}
  </section>
  <h4 class="sec-title">${esc(t('categories'))}</h4>
  <section class="card">
    <div class="chips">${S.cats.map(c => `<button class="chip" data-act="cat-edit" data-cat="${esc(c.id)}">${c.icon} ${esc(catName(c))} <small class="muted">${counts[c.id] || 0}</small></button>`).join('')}
    <button class="chip dashed" data-act="cat-add">＋ ${esc(t('addCat'))}</button></div>
  </section>
  <h4 class="sec-title">${esc(t('data'))}</h4>
  <section class="card settings">
    <button class="set-row link" data-act="privacy"><span>🛡️ ${esc(t('whereData'))}</span><span>›</span></button>
    <button class="set-row link" data-act="export"><span>💾 ${esc(t('exportData'))}</span><span>›</span></button>
    <button class="set-row link" data-act="restore"><span>📂 ${esc(t('importBackup'))}</span><span>›</span></button>
    ${S.imports.length ? `<div class="imports"><small class="muted">${esc(t('imports'))}</small>${[...S.imports].reverse().map(i => `<div class="set-row"><span><b>${esc(i.name)}</b><small class="muted"> · ${esc(new Date(i.at).toLocaleDateString(locale()))} · ${esc(t('txCount', { n: S.txs.filter(x => x.importId === i.id).length }))}</small></span><button class="btn small ghost" data-act="import-del" data-id="${esc(i.id)}" aria-label="${esc(t('importDel'))}">🗑️</button></div>`).join('')}</div>` : ''}
    <button class="btn danger wide" data-act="wipe">${esc(t('wipe'))}</button>
  </section>
  <p class="muted center small">v1.0 · ${esc(t('welcomePrivacy'))}</p>`;
}
async function refreshSecurity() {
  S._sec = { pin: await lock.hasPin(), bio: await lock.hasBio(), bioOk: await lock.bioAvailable() };
}

function openPrivacy() {
  openSheet(`<h3>${esc(t('whereData'))}</h3><ul class="privacy">${t('privacyBody').map(p => `<li>${p}</li>`).join('')}</ul>
    <button class="btn primary wide" data-act="sheet-close">${esc(t('close'))}</button>`);
}

function showImportSummary(r) {
  const created = r.newCats.length ? `<p class="muted">✨ ${r.newCats.map(c => `${c.icon} ${esc(catName(c))}`).join(', ')}</p>` : '';
  openSheet(`<div class="center"><div class="welcome-art">${r.added ? '✅' : 'ℹ️'}</div><h3>${esc(t('importDone'))}</h3>
    <p>${esc(r.added ? t('importSummary', { n: r.added, dup: r.dups ? t('importDup', { d: r.dups }) : '', r: r.review }) : t('importNone') + (r.dups ? t('importDup', { d: r.dups }) : ''))}</p>${created}</div>
    <div class="row-gap">${r.review ? `<button class="btn ghost" data-act="sheet-close">${esc(t('reviewLater'))}</button><button class="btn primary" data-act="review-now">${esc(t('reviewNow'))}</button>` : `<button class="btn primary wide" data-act="sheet-close">${esc(t('done'))}</button>`}</div>`);
}

function openWipe() {
  openSheet(`<h3>⚠️ ${esc(t('wipe'))}</h3><p>${esc(t('wipeConfirm'))}</p>
    <label class="field">${esc(t('wipeType'))}<input id="wipe-input" autocomplete="off"></label>
    <div class="row-gap"><button class="btn ghost" data-act="sheet-close">${esc(t('cancel'))}</button><button class="btn danger" data-act="wipe-ok">${esc(t('delete'))}</button></div>`);
}

function openCatEdit(id) {
  const c = catMap[id];
  const custom = id.startsWith('c_');
  openSheet(`<h3>${c.icon} ${esc(catName(c))}</h3>
    <label class="field">${esc(t('catName'))}<input id="ce-name" value="${esc(catName(c))}" maxlength="30"></label>
    <label class="field">${esc(t('catIcon'))}<input id="ce-icon" value="${esc(c.icon)}" maxlength="4"></label>
    <div class="row-gap">${custom ? `<button class="btn danger" data-act="ce-del" data-cat="${esc(id)}">${esc(t('delete'))}</button>` : ''}<button class="btn primary" data-act="ce-save" data-cat="${esc(id)}">${esc(t('save'))}</button></div>`);
}

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// ---------------- Khóa PIN ----------------
function pinPad({ title, len = null, onSubmit, bio = null, cancellable = false }) {
  return new Promise(resolve => {
    const el = $('#lock');
    let pin = '';
    const draw = (err = '') => {
      el.innerHTML = `<div class="lock-inner">
        <div class="lock-logo">🔒</div><h2>${esc(title)}</h2>
        <div class="dots ${err ? 'shake' : ''}">${Array.from({ length: len || 6 }, (_, i) => `<span class="${i < pin.length ? 'on' : ''}"></span>`).join('')}</div>
        <p class="lock-err">${esc(err)}</p>
        <div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-k="${n}">${n}</button>`).join('')}
          ${bio ? `<button data-k="bio" aria-label="${esc(t('useBio'))}">🫆</button>` : cancellable ? `<button data-k="cancel" class="txt">${esc(t('cancel'))}</button>` : '<span></span>'}
          <button data-k="0">0</button>
          <button data-k="del" aria-label="⌫">⌫</button>
        </div>
        ${len ? '' : `<button class="btn primary wide" data-k="ok" ${pin.length >= 4 ? '' : 'disabled'}>OK</button>`}
        </div>`;
    };
    const finish = ok => { el.hidden = true; el.onclick = null; document.removeEventListener('keydown', onKey); resolve(ok); };
    const submit = async () => {
      const res = await onSubmit(pin);
      if (res === true) finish(true);
      else { pin = ''; draw(res || t('wrongPin')); }
    };
    const press = async k => {
      if (k === 'bio') { if (await bio()) finish(true); return; }
      if (k === 'cancel') return finish(false);
      if (k === 'del') { pin = pin.slice(0, -1); draw(); return; }
      if (k === 'ok') return pin.length >= 4 ? submit() : undefined;
      if (pin.length >= 6) return;
      pin += k; draw();
      if (len && pin.length === len) submit();
    };
    const onKey = e => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('del');
      else if (e.key === 'Enter' && !len) press('ok');
      else if (e.key === 'Escape' && cancellable) press('cancel');
    };
    el.onclick = e => { const b = e.target.closest('[data-k]'); if (b) press(b.dataset.k); };
    document.addEventListener('keydown', onKey);
    draw(); el.hidden = false;
    if (bio) setTimeout(async () => { if (!el.hidden && await bio()) finish(true); }, 300);
  });
}

async function lockApp() {
  if (S.locked || !(await lock.hasPin())) return;
  S.locked = true;
  document.body.classList.add('locked');
  const p = await db.getKV('pin');
  const useBio = (await lock.hasBio()) ? () => lock.unlockWithBio() : null;
  await pinPad({ title: t('enterPin'), len: p.len, onSubmit: async pin => (await lock.checkPin(pin)) || t('wrongPin'), bio: useBio });
  S.locked = false;
  document.body.classList.remove('locked');
}

async function setupPin() {
  let first = null;
  const ok1 = await pinPad({ title: t('newPin'), cancellable: true, onSubmit: async pin => { first = pin; return true; } });
  if (!ok1) return false;
  const ok2 = await pinPad({ title: t('confirmPin'), len: first.length, cancellable: true, onSubmit: async pin => (pin === first) || t('pinMismatch') });
  if (!ok2) return false;
  await lock.setPin(first);
  const p = await db.getKV('pin'); p.len = first.length; await db.setKV('pin', p);
  toast(t('pinSaved'));
  return true;
}

// ---------------- Sự kiện ----------------
const actions = {
  'tab': el => { S.tab = el.dataset.tab; if (S.tab === 'tx') S.txLimit = 150; render(); window.scrollTo(0, 0); },
  'month': el => { S.month = shiftMonth(S.month, +el.dataset.d); render(); },
  'import': () => $('#file').click(),
  'sample': async () => {
    const file = new File([sampleCSV()], 'sao-ke-mau.csv', { type: 'text/csv' });
    await importFiles([file]);
    toast(t('sampleLoaded'));
  },
  'review-now': () => { closeSheet(); S.tab = 'review'; render(); },
  'cat-filter': el => { S.tab = 'tx'; S.fCat = el.dataset.cat; S.fMonth = S.month; S.q = ''; render(); window.scrollTo(0, 0); },
  'rv-yes': () => { const tx = S.txs.find(x => x.id === $('#rv-card').dataset.id); reviewDecide(tx.cat); },
  'rv-later': reviewLater,
  'rv-pick': el => reviewDecide(el.dataset.cat),
  'rv-new': async () => { const id = await newCatDialog(); if (id) reviewDecide(id); },
  'tx-open': el => openTxSheet(S.txs.find(x => x.id === el.dataset.id)),
  'tx-pick': async el => {
    const tx = S.txs.find(x => x.id === el.dataset.id);
    closeSheet();
    const n = await confirmTx(tx, el.dataset.cat, S.remember);
    if (n) toast(t('learnedN', { n }));
    render();
  },
  'tx-new': async el => {
    const tx = S.txs.find(x => x.id === el.dataset.id);
    closeSheet();
    await new Promise(r => setTimeout(r, 220));
    const id = await newCatDialog();
    if (id) { const n = await confirmTx(tx, id, S.remember); if (n) toast(t('learnedN', { n })); render(); }
  },
  'nc-emoji': el => { $('#nc-icon').value = el.dataset.e; },
  'nc-save': async () => {
    const name = $('#nc-name').value.trim();
    if (!name) { $('#nc-name').focus(); return; }
    const id = await createCat(name, $('#nc-icon').value.trim());
    closeSheet(id);
  },
  'more': () => { S.txLimit += 300; $('#tx-list').innerHTML = txListHtml(); },
  'trend-n': el => { S.trendN = +el.dataset.n; render(); },
  'trend-cat': el => { S.trendCat = el.dataset.cat; render(); },
  'chart-bar': el => { S.month = el.dataset.ym; render(); },
  'sheet-close': () => closeSheet(),
  'map-ok': () => {
    const { rows, headerRow } = window.__mapRows;
    const map = {};
    for (const role of ['date', 'desc', 'amount', 'debit', 'credit']) { const v = $('#map-' + role).value; if (v !== '') map[role] = +v; }
    if (map.date === undefined || (map.amount === undefined && map.debit === undefined && map.credit === undefined)) return;
    if (map.debit !== undefined || map.credit !== undefined) delete map.amount;
    closeSheet(rowsToTransactions(rows, headerRow, map));
  },
  'privacy': (el, e) => { e.preventDefault(); openPrivacy(); },
  'export': () => {
    const data = { app: 'chi-tieu', version: 1, exportedAt: new Date().toISOString(), txs: S.txs, cats: S.cats, imports: S.imports, model: S.model, settings: S.settings };
    download(`chi-tieu-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data), 'application/json');
  },
  'restore': () => $('#restore-file').click(),
  'import-del': async el => {
    const id = el.dataset.id;
    const ids = S.txs.filter(x => x.importId === id).map(x => x.id);
    if (!confirm(`${t('importDel')}? (${t('txCount', { n: ids.length })})`)) return;
    S.txs = S.txs.filter(x => x.importId !== id);
    S.imports = S.imports.filter(i => i.id !== id);
    await db.removeMany('tx', ids); await db.remove('imports', id);
    render();
  },
  'wipe': openWipe,
  'wipe-ok': async () => {
    const v = norm($('#wipe-input').value);
    if (!['xoa', 'delete', 'supprimer'].includes(v)) { $('#wipe-input').focus(); return; }
    await db.wipeEverything();
    alert(t('wipeDone'));
    location.replace(location.pathname);
  },
  'cat-edit': el => openCatEdit(el.dataset.cat),
  'cat-add': async () => { const id = await newCatDialog(); if (id) render(); },
  'ce-save': async el => {
    const c = catMap[el.dataset.cat];
    const name = $('#ce-name').value.trim(), icon = $('#ce-icon').value.trim();
    if (name && name !== catName(c)) c.name = name;
    if (icon) c.icon = icon;
    await db.put('cats', c); closeSheet(); render();
  },
  'ce-del': async el => {
    const id = el.dataset.cat;
    const moved = S.txs.filter(x => x.cat === id);
    moved.forEach(x => { x.cat = 'other'; x.status = 'review'; x.conf = 0; });
    forgetCategory(S.model, id);
    S.cats = S.cats.filter(c => c.id !== id); rebuildCatMap();
    await db.putMany('tx', moved); await db.remove('cats', id); await db.setKV('model', S.model);
    closeSheet(); render();
  },
  'pin-set': async () => { await setupPin(); await refreshSecurity(); render(); },
  'pin-change': async () => {
    const p = await db.getKV('pin');
    const ok = await pinPad({ title: t('enterPin'), len: p.len, cancellable: true, onSubmit: async pin => (await lock.checkPin(pin)) || t('wrongPin') });
    if (ok) await setupPin();
    await refreshSecurity(); render();
  },
  'pin-remove': async () => {
    const p = await db.getKV('pin');
    const ok = await pinPad({ title: t('enterPin'), len: p.len, cancellable: true, onSubmit: async pin => (await lock.checkPin(pin)) || t('wrongPin') });
    if (ok) await lock.clearPin();
    await refreshSecurity(); render();
  },
};

const changes = {
  remember: el => { S.remember = el.checked; },
  q: el => { S.q = el.value; S.txLimit = 150; $('#tx-list').innerHTML = txListHtml(); },
  fMonth: el => { S.fMonth = el.value; $('#tx-list').innerHTML = txListHtml(); },
  fCat: el => { S.fCat = el.value; $('#tx-list').innerHTML = txListHtml(); },
  lang: async el => { S.settings.lang = el.value; setLang(el.value); await saveSettings(); render(); },
  currency: async el => { S.settings.currency = el.value; await saveSettings(); render(); },
  autoLock: async el => { S.settings.autoLock = +el.value; await saveSettings(); },
  notif: async el => {
    if (el.checked && 'Notification' in window) {
      const p = await Notification.requestPermission();
      if (p !== 'granted') { el.checked = false; toast(t('notifDenied')); }
    }
    S.settings.notif = el.checked && 'Notification' in window; await saveSettings(); render();
  },
  bio: async el => {
    try {
      if (el.checked) await lock.enableBio(t('appName')); else await lock.disableBio();
    } catch (e) { el.checked = false; toast(t('bioUnsupported')); }
    await refreshSecurity(); render();
  },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || S.locked) return;
  const fn = actions[el.dataset.act];
  if (fn) fn(el, e);
});
document.addEventListener('input', e => { if (e.target.dataset.chg === 'q') changes.q(e.target); });
document.addEventListener('change', e => {
  const k = e.target.dataset.chg;
  if (k && k !== 'q' && changes[k]) changes[k](e.target);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });

$('#file').addEventListener('change', async e => {
  const files = [...e.target.files]; e.target.value = '';
  if (files.length) await importFiles(files);
});
$('#restore-file').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (data.app !== 'chi-tieu' || !Array.isArray(data.txs)) throw new Error('format');
    await db.clear('tx'); await db.clear('cats'); await db.clear('imports');
    await db.putMany('tx', data.txs); await db.putMany('cats', data.cats); await db.putMany('imports', data.imports || []);
    await db.setKV('model', data.model || emptyModel());
    await db.setKV('settings', { ...S.settings, ...(data.settings || {}) });
    await load(); render(); toast('✅');
  } catch (err) { toast(t('importFail', { e: err.message })); }
});

// Tự khóa khi rời app, làm mờ nội dung trong trình chuyển app.
let hiddenAt = 0;
document.addEventListener('visibilitychange', async () => {
  if (document.hidden) { hiddenAt = Date.now(); document.body.classList.add('privacy-blur'); return; }
  document.body.classList.remove('privacy-blur');
  if (Date.now() - hiddenAt >= (S.settings.autoLock || 0) * 1000) await lockApp();
});
// Phòng khi trình duyệt không báo "visible" lại: luôn bỏ làm mờ khi trang hiện ra / được chạm vào.
const unblur = () => { if (!document.hidden) document.body.classList.remove('privacy-blur'); };
window.addEventListener('pageshow', unblur);
window.addEventListener('focus', unblur);
document.addEventListener('touchstart', unblur, { passive: true });

// File được chia sẻ từ app khác (Android): service worker giữ tạm file trong cache "shared".
async function takeSharedFiles() {
  if (!location.search.includes('shared') || !window.caches) return;
  history.replaceState(null, '', location.pathname);
  const cache = await caches.open('shared');
  const files = [];
  for (const req of await cache.keys()) {
    const res = await cache.match(req);
    const blob = await res.blob();
    files.push(new File([blob], decodeURIComponent(res.headers.get('x-name') || 'shared'), { type: blob.type }));
    await cache.delete(req);
  }
  if (files.length) { toast(t('sharedReceived')); await importFiles(files); }
}

// ---------------- Khởi động ----------------
(async function start() {
  try {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    await load();
    await refreshSecurity();
    window.__started = true;
    await lockApp();
    render();
  } catch (err) {
    if (window.__bootFail) window.__bootFail(err); else throw err;
    return;
  }
  takeSharedFiles().catch(() => {});
})();
