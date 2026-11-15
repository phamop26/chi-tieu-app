// Báo cáo "câu chuyện tháng": nhịp chi tiêu, tỷ lệ để dành, ngân sách, trang chi tiết từng mục, tổng kết tháng.
import { t, locale, catName } from './i18n.js';
import { shortLabel } from './classify.js';
import { monthOf, shiftMonth } from './insights.js';

const pad = n => String(n).padStart(2, '0');
const daysIn = ym => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); };
const isThisMonth = ym => { const d = new Date(); return ym === `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };

export function initReport(ctx) {
  const { S, esc, money, pct, monthLabel, dateLabel, openSheet, closeSheet, toast, render, db, kindOf, catMap } = ctx;
  const catText = id => catName(catMap()[id]);
  const icon = id => (catMap()[id] && catMap()[id].icon) || '📦';
  const isOut = x => x.amount < 0 && kindOf(x.cat) !== 'neutral';
  const isIn = x => x.amount > 0 && kindOf(x.cat) !== 'neutral';
  const inMonth = ym => S.txs.filter(x => monthOf(x.date) === ym);
  const sumOut = list => list.filter(isOut).reduce((s, x) => s - x.amount, 0);
  const sumIn = list => list.filter(isIn).reduce((s, x) => s + x.amount, 0);
  const weekdayName = (i, style = 'long') => new Date(2024, 0, 1 + i).toLocaleDateString(locale(), { weekday: style }); // 1/1/2024 là thứ Hai
  const wdIndex = d => (new Date(d).getDay() + 6) % 7; // 0 = thứ Hai

  // ---------- Nhịp chi tiêu (đường cộng dồn theo ngày) ----------
  function cumulative(ym, upto) {
    const n = daysIn(ym), arr = new Array(n).fill(0);
    for (const x of inMonth(ym)) if (isOut(x)) arr[+x.date.slice(8, 10) - 1] -= x.amount;
    let run = 0;
    return arr.map((v, i) => { run += v; return i < upto ? run : null; });
  }
  function paceCard(ym) {
    const n = daysIn(ym);
    const today = isThisMonth(ym) ? new Date().getDate() : n;
    const cur = cumulative(ym, today);
    const prevYm = shiftMonth(ym, -1);
    const prev = cumulative(prevYm, daysIn(prevYm));
    if (!cur[today - 1] && !prev.some(Boolean)) return '';
    const W = 340, H = 170, L = 6, R = 6, T = 14, B = 22, pw = W - L - R, ph = H - T - B;
    const max = Math.max(1, ...cur.filter(v => v !== null), ...prev) * 1.08;
    const X = i => L + (i / (Math.max(n, prev.length) - 1)) * pw;
    const Y = v => T + ph - (v / max) * ph;
    const path = arr => arr.map((v, i) => (v === null ? '' : `${i === 0 || arr[i - 1] === null ? 'M' : 'L'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`)).join('');
    const nowV = cur[today - 1] || 0, prevAt = prev[Math.min(today, prev.length) - 1] || 0;
    let sentence;
    if (!isThisMonth(ym)) sentence = t('paceFull', { a: money(nowV) });
    else if (prevAt && nowV >= prevAt) sentence = t('paceAhead', { d: today, a: money(nowV), x: money(nowV - prevAt) });
    else if (prevAt) sentence = t('paceBehind', { d: today, a: money(nowV), x: money(prevAt - nowV) });
    else sentence = t('paceFull', { a: money(nowV) });
    window.__pace = { cur, prev, n, ym, prevYm };
    const ticks = [1, Math.ceil(n / 2), n].map(d => `<text class="axis" x="${X(d - 1)}" y="${H - 6}" text-anchor="${d === 1 ? 'start' : d === n ? 'end' : 'middle'}">${d}</text>`).join('');
    return `<section class="card">
      <div class="row-between"><h3>${esc(t('paceTitle'))}</h3><span class="legend"><i class="lg cur"></i>${esc(t('paceThis'))} <i class="lg prev"></i>${esc(t('paceLast'))}</span></div>
      <p class="muted small" style="margin:-4px 0 6px">${esc(t('paceSub'))}</p>
      <div class="chart" id="pace">
        <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('paceTitle'))}">
          <line class="grid" x1="${L}" x2="${W - R}" y1="${Y(max / 1.08 / 2)}" y2="${Y(max / 1.08 / 2)}"/>
          <text class="axis" x="${L}" y="${Y(max / 1.08 / 2) - 4}">${esc(money(max / 1.08 / 2, true))}</text>
          <line class="base" x1="${L}" x2="${W - R}" y1="${T + ph}" y2="${T + ph}"/>
          <path class="line prev" d="${path(prev)}"/>
          <path class="line cur" d="${path(cur)}"/>
          ${nowV ? `<circle class="dot" cx="${X(today - 1)}" cy="${Y(nowV)}" r="4"/>` : ''}
          <line class="cross" id="pace-x" x1="0" x2="0" y1="${T}" y2="${T + ph}" visibility="hidden"/>
          ${ticks}
          <rect class="hit" x="${L}" y="${T}" width="${pw}" height="${ph}"/>
        </svg>
        <div class="tip" id="pace-tip" hidden></div>
      </div>
      <p class="pace-text">${esc(sentence)}</p>
    </section>`;
  }
  function attachPace() {
    const box = document.getElementById('pace');
    if (!box || !window.__pace) return;
    const { cur, prev, n } = window.__pace;
    const svg = box.querySelector('svg'), tip = document.getElementById('pace-tip'), cross = document.getElementById('pace-x');
    const show = e => {
      const r = svg.getBoundingClientRect();
      const fx = (e.clientX - r.left) / r.width;
      const i = Math.max(0, Math.min(n - 1, Math.round(((fx * 340) - 6) / 328 * (n - 1))));
      const xPx = 6 + (i / (n - 1)) * 328;
      cross.setAttribute('x1', xPx); cross.setAttribute('x2', xPx); cross.setAttribute('visibility', 'visible');
      tip.innerHTML = `<b>${i + 1}</b><br>${esc(t('paceThis'))}: ${cur[i] === null || cur[i] === undefined ? '—' : esc(money(cur[i]))}<br>${esc(t('paceLast'))}: ${prev[i] === undefined ? '—' : esc(money(prev[i]))}`;
      tip.hidden = false;
      tip.style.left = Math.min(Math.max(xPx / 340 * r.width, 70), r.width - 70) + 'px';
    };
    svg.addEventListener('pointermove', show);
    svg.addEventListener('pointerdown', show);
    svg.addEventListener('pointerleave', () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); });
  }

  // ---------- Tỷ lệ để dành ----------
  function rateOf(ym) { const l = inMonth(ym); const i = sumIn(l), o = sumOut(l); return { i, o, r: i ? (i - o) / i : null }; }
  function savingsCard(ym) {
    const c = rateOf(ym), p = rateOf(shiftMonth(ym, -1));
    if (!c.i && !c.o) return '';
    let line, ratio = 0;
    if (!c.i) line = t('saveNoIncome');
    else if (c.r >= 0) { line = t('saveKeep', { p: pct(c.r), a: money(c.i - c.o) }); ratio = c.r; }
    else line = t('saveOver', { a: money(c.o - c.i) });
    const deg = Math.max(0, Math.min(1, ratio)) * 360;
    return `<section class="card save-card">
      <div class="ring" style="--deg:${deg}deg" aria-hidden="true"><span>${c.r === null ? '—' : esc(pct(Math.max(-9.99, c.r)))}</span></div>
      <div><h3>${esc(t('saveTitle'))}</h3><p>${esc(line)}</p>${p.r !== null ? `<small class="muted">${esc(t('saveVsLast', { p: pct(p.r) }))}</small>` : ''}</div>
    </section>`;
  }

  // ---------- Ngân sách ----------
  const budgets = () => S.settings.budgets || {};
  function catSpent(ym, cat) { return inMonth(ym).filter(x => x.cat === cat && isOut(x)).reduce((s, x) => s - x.amount, 0); }
  function monthProgress(ym) { return isThisMonth(ym) ? new Date().getDate() / daysIn(ym) : 1; }
  function budgetsCard(ym) {
    const b = budgets(); const ids = Object.keys(b).filter(id => catMap()[id] && b[id] > 0);
    if (!ids.length) return '';
    const q = monthProgress(ym);
    return `<section class="card"><div class="row-between"><h3>${esc(t('budTitle'))}</h3><small class="muted">${esc(pct(q))} · ${esc(monthLabel(ym))}</small></div>
      <ul class="cat-bars">${ids.map(id => {
        const sp = catSpent(ym, id), r = sp / b[id];
        const warn = r >= 0.9 || r > q + 0.15;
        return `<li><button data-act="rp-drill" data-cat="${esc(id)}"><span class="cb-icon">${icon(id)}</span>
          <span class="cb-main"><span class="cb-top"><span class="cb-name">${esc(catText(id))}</span><span class="cb-val">${esc(money(sp))} / ${esc(money(b[id]))}</span></span>
          <span class="cb-track budget"><span class="cb-fill ${warn ? 'warn' : ''}" style="width:${Math.min(100, Math.max(2, r * 100)).toFixed(1)}%"></span><span class="cb-mark" style="left:${(q * 100).toFixed(1)}%"></span></span>
          <span class="cb-pct ${r >= 1 ? 'over' : 'muted'}">${r >= 1 ? '⚠️ ' + esc(t('budOver', { a: money(sp - b[id]) })) : esc(t('budLeft', { a: money(b[id] - sp) }))}</span></span></button></li>`;
      }).join('')}</ul></section>`;
  }
  function budgetInsights(ym) {
    const b = budgets(), q = monthProgress(ym), out = [];
    for (const id of Object.keys(b)) {
      if (!catMap()[id] || !(b[id] > 0)) continue;
      const sp = catSpent(ym, id), r = sp / b[id];
      if (r >= 1) out.push({ icon: '⚠️', text: t('budHit', { c: catText(id), a: money(sp - b[id]) }) });
      else if (isThisMonth(ym) && r > q + 0.15) out.push({ icon: '🐢', text: t('budPace', { c: catText(id), p: pct(r), q: pct(q) }) });
    }
    return out;
  }
  function openBudget(cat) {
    const cur = budgets()[cat];
    openSheet(`<h3>${icon(cat)} ${esc(t('budSetFor', { c: catText(cat) }))}</h3>
      <label class="field">${esc(t('budSet'))}<input id="bud-amt" inputmode="decimal" autocomplete="off" value="${cur ? esc(new Intl.NumberFormat(locale()).format(cur)) : ''}" placeholder="0"></label>
      <div class="chips">${[500e3, 1e6, 2e6, 3e6, 5e6].map(v => `<button class="chip" data-act="rp-bud-quick" data-v="${v}">${esc(money(v, true))}</button>`).join('')}</div>
      <div class="row-gap">${cur ? `<button class="btn danger" data-act="rp-bud-del" data-cat="${esc(cat)}">${esc(t('budRemove'))}</button>` : ''}
      <button class="btn ghost" data-act="sheet-close">${esc(t('cancel'))}</button><button class="btn primary" data-act="rp-bud-save" data-cat="${esc(cat)}">${esc(t('save'))}</button></div>`);
    setTimeout(() => document.getElementById('bud-amt')?.focus(), 250);
  }
  async function saveBudget(cat, v) {
    const b = { ...budgets() };
    if (v > 0) b[cat] = v; else delete b[cat];
    S.settings.budgets = b;
    await db.setKV('settings', S.settings);
    closeSheet(); render(); toast(t('budSaved'));
  }

  // ---------- Trang chi tiết một mục ----------
  function miniBars(series, valueFmt) {
    const W = 320, H = 110, T = 16, B = 18, ph = H - T - B, col = W / series.length, bw = Math.min(26, col * 0.55);
    const max = Math.max(1, ...series.map(s => s.v));
    return `<svg viewBox="0 0 ${W} ${H}" class="mini" role="img">${series.map((s, i) => {
      const h = (s.v / max) * ph, x = i * col + (col - bw) / 2, y = T + ph - h, r = Math.min(4, h);
      const p = h > 0 ? `<path class="mark ${s.hi ? 'hi' : ''}" d="M${x},${T + ph} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${T + ph} Z"/>` : '';
      return `${p}${s.hi && s.v ? `<text class="val" x="${x + bw / 2}" y="${y - 4}" text-anchor="middle">${esc(valueFmt(s.v))}</text>` : ''}<text class="axis" x="${x + bw / 2}" y="${H - 4}" text-anchor="middle">${esc(s.label)}</text>`;
    }).join('')}<line class="base" x1="0" x2="${W}" y1="${T + ph}" y2="${T + ph}"/></svg>`;
  }
  function openDrill(cat, ym) {
    const list = inMonth(ym).filter(x => x.cat === cat && isOut(x));
    const total = list.reduce((s, x) => s - x.amount, 0);
    const prevTotal = catSpent(shiftMonth(ym, -1), cat);
    const trend = [5, 4, 3, 2, 1, 0].map(i => { const m = shiftMonth(ym, -i); return { label: monthLabel(m, 'short'), v: catSpent(m, cat), hi: i === 0 }; });
    // Nơi chi nhiều nhất (3 tháng gần nhất cho đủ dữ liệu)
    const recent = S.txs.filter(x => x.cat === cat && isOut(x) && monthOf(x.date) > shiftMonth(ym, -3) && monthOf(x.date) <= ym);
    const byM = new Map();
    for (const x of recent) { const k = shortLabel(x.desc); const o = byM.get(k) || { k, n: 0, v: 0 }; o.n++; o.v -= x.amount; byM.set(k, o); }
    const top = [...byM.values()].sort((a, b) => b.v - a.v).slice(0, 5);
    const topMax = top.length ? top[0].v : 1;
    const biggest = [...list].sort((a, b) => a.amount - b.amount).slice(0, 3);
    const wd = new Array(7).fill(0);
    for (const x of recent) wd[wdIndex(x.date)] -= x.amount;
    const wdMax = wd.indexOf(Math.max(...wd));
    const ch = prevTotal ? total / prevTotal - 1 : null;
    const b = budgets()[cat];
    openSheet(`<div class="dd-head"><span class="dd-icon">${icon(cat)}</span><div><h3>${esc(catText(cat))}</h3><small class="muted">${esc(monthLabel(ym))}</small></div></div>
      <div class="dd-total">${esc(money(total))}</div>
      <p class="muted small">${esc(t('ddCount', { n: list.length, a: money(list.length ? total / list.length : 0) }))}${ch !== null ? ' · ' + esc(ch >= 0 ? t('vsLastMore', { p: pct(ch) }) : t('vsLastLess', { p: pct(-ch) })) : ''}</p>
      ${b ? `<p class="small">${esc(t('budSet'))}: ${esc(money(b))} · ${esc(total > b ? t('budOver', { a: money(total - b) }) : t('budLeft', { a: money(b - total) }))}</p>` : ''}
      <h4 class="dd-sec">${esc(t('ddTrend'))}</h4>${miniBars(trend, v => money(v, true))}
      ${top.length ? `<h4 class="dd-sec">${esc(t('ddTop'))}</h4><ul class="cat-bars">${top.map(m => `<li><div class="dd-row"><span class="cb-main"><span class="cb-top"><span class="cb-name">${esc(m.k)}</span><span class="cb-val">${esc(money(m.v))}</span></span>
          <span class="cb-track"><span class="cb-fill" style="width:${Math.max(3, m.v / topMax * 100).toFixed(1)}%"></span></span><span class="cb-pct muted">${esc(t('ddTimes', { n: m.n }))}</span></span></div></li>`).join('')}</ul>` : ''}
      ${biggest.length ? `<h4 class="dd-sec">${esc(t('ddBiggest'))}</h4><ul class="list">${biggest.map(x => `<li class="li"><span class="li-main"><b>${esc(shortLabel(x.desc))}</b><small class="muted">${esc(dateLabel(x.date))}</small></span><span class="li-amt">${esc(money(-x.amount))}</span></li>`).join('')}</ul>` : ''}
      ${recent.length >= 4 ? `<h4 class="dd-sec">${esc(t('ddWeekday'))}</h4>${miniBars(wd.map((v, i) => ({ label: weekdayName(i, 'narrow'), v, hi: i === wdMax })), v => money(v, true))}
        <p class="muted small">${esc(t('ddWeekdayNote', { d: weekdayName(wdMax) }))}</p>` : ''}
      <div class="row-gap"><button class="btn ghost" data-act="rp-bud" data-cat="${esc(cat)}">🎯 ${esc(t('budSet'))}</button><button class="btn primary" data-act="rp-see" data-cat="${esc(cat)}">${esc(t('ddSeeAll'))}</button></div>`);
  }

  // ---------- Tổng kết tháng dạng thẻ ----------
  function wrapMonthToShow() {
    const d = new Date();
    const cur = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    if (d.getDate() <= 10) { const p = shiftMonth(cur, -1); if (inMonth(p).length >= 10) return p; }
    if (d.getDate() >= 25 && inMonth(cur).length >= 10) return cur;
    return null;
  }
  function wrapBanner() {
    const m = wrapMonthToShow();
    return m ? `<button class="wrap-banner" data-act="rp-wrap" data-m="${m}">${esc(t('wrapOpen', { m: monthLabel(m) }))} ›</button>` : '';
  }
  function openWrapped(ym) {
    const list = inMonth(ym);
    const out = sumOut(list);
    if (list.length < 3 || !out) { toast(t('wrapNoData')); return; }
    const prevOut = sumOut(inMonth(shiftMonth(ym, -1)));
    const byCat = {};
    for (const x of list) if (isOut(x)) byCat[x.cat] = (byCat[x.cat] || 0) - x.amount;
    const topCat = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];
    const byM = new Map();
    for (const x of list) if (isOut(x)) { const k = shortLabel(x.desc); const o = byM.get(k) || { k, n: 0, v: 0 }; o.n++; o.v -= x.amount; byM.set(k, o); }
    const topM = [...byM.values()].sort((a, b) => b.n - a.n || b.v - a.v)[0];
    const byDay = {};
    for (const x of list) if (isOut(x)) byDay[x.date] = (byDay[x.date] || 0) - x.amount;
    const bigDay = Object.entries(byDay).sort((a, b) => b[1] - a[1])[0];
    const wd = new Array(7).fill(0);
    for (const x of list) if (isOut(x)) wd[wdIndex(x.date)] -= x.amount;
    const wdMax = wd.indexOf(Math.max(...wd));
    const rate = rateOf(ym);
    const b = budgets(); const bIds = Object.keys(b).filter(id => catMap()[id] && b[id] > 0);
    const okN = bIds.filter(id => catSpent(ym, id) <= b[id]).length;
    const vs = prevOut ? (out >= prevOut ? '+' : '−') + pct(Math.abs(out / prevOut - 1)) : '';
    const cards = [
      ['c1', '🗓️', t('wrapTitle', { m: monthLabel(ym) }), `<div class="w-label">${esc(t('wrapSpent'))}</div><div class="w-big">${esc(money(out))}</div>${vs ? `<div class="w-sub">${esc(t('wrapVs', { x: vs }))}</div>` : ''}`],
      topCat && ['c2', icon(topCat[0]), t('wrapTopCat'), `<div class="w-big">${esc(catText(topCat[0]))}</div><div class="w-sub">${esc(money(topCat[1]))} · ${esc(t('wrapTopShare', { p: pct(topCat[1] / out) }))}</div>`],
      topM && topM.n >= 2 && ['c3', '📍', t('wrapMerchant'), `<div class="w-big">${esc(topM.k)}</div><div class="w-sub">${esc(t('wrapMerchantN', { n: topM.n, a: money(topM.v) }))}</div>`],
      bigDay && ['c4', '💥', t('wrapDay'), `<div class="w-big">${esc(dateLabel(bigDay[0]))}</div><div class="w-sub">${esc(money(bigDay[1]))}</div>`],
      ['c5', '📆', t('wrapWeekday'), `<div class="w-big">${esc(weekdayName(wdMax))}</div><div class="w-sub">${esc(money(wd[wdMax]))}</div>`],
      rate.i > 0 && ['c6', rate.r >= 0 ? '🌱' : '🌧️', t('wrapSave'), `<div class="w-big">${esc(pct(rate.r))}</div><div class="w-sub">${esc(t('wrapSaveOf'))} · ${esc(money(rate.i - rate.o))}</div>`],
      bIds.length && ['c2', '🎯', t('wrapBudget'), `<div class="w-big">${okN}/${bIds.length}</div><div class="w-sub">${esc(t('wrapBudgetOk', { n: okN, t: bIds.length }))}</div>`],
      ['c1', '💚', t('wrapEnd'), `<div class="w-sub">${esc(t('wrapEndSub'))}</div>`],
    ].filter(Boolean);
    const el = document.getElementById('wrap');
    el.innerHTML = `<div class="wrap-top"><div class="wrap-dots">${cards.map((_, i) => `<span class="${i ? '' : 'on'}"></span>`).join('')}</div>
        <button class="icon-btn wrap-x" data-act="rp-wrap-close" aria-label="${esc(t('wrapClose'))}">✕</button></div>
      <div class="wrap-track" id="wrap-track">${cards.map(([cls, ic, title, body]) => `<section class="wrap-card ${cls}"><div class="w-icon">${ic}</div><h2>${esc(title)}</h2>${body}</section>`).join('')}</div>
      <button class="btn wrap-next" data-act="rp-wrap-next">${esc(t('wrapNext'))} ›</button>`;
    el.hidden = false;
    const track = document.getElementById('wrap-track');
    track.addEventListener('scroll', () => {
      const i = Math.round(track.scrollLeft / track.clientWidth);
      el.querySelectorAll('.wrap-dots span').forEach((s, j) => s.classList.toggle('on', j === i));
      el.querySelector('.wrap-next').textContent = i >= cards.length - 1 ? t('wrapClose') : t('wrapNext') + ' ›';
    }, { passive: true });
  }
  function wrapNext() {
    const track = document.getElementById('wrap-track');
    const i = Math.round(track.scrollLeft / track.clientWidth);
    if (i >= track.children.length - 1) return closeWrapped();
    track.scrollTo({ left: (i + 1) * track.clientWidth, behavior: 'smooth' });
  }
  function closeWrapped() { const el = document.getElementById('wrap'); el.hidden = true; el.innerHTML = ''; }

  const actions = {
    'rp-drill': el => openDrill(el.dataset.cat, S.month),
    'rp-bud': async el => { closeSheet(); await new Promise(r => setTimeout(r, 220)); openBudget(el.dataset.cat); },
    'rp-bud-quick': el => { document.getElementById('bud-amt').value = new Intl.NumberFormat(locale()).format(+el.dataset.v); },
    'rp-bud-save': el => { const v = ctx.parseAmount(document.getElementById('bud-amt').value || ''); saveBudget(el.dataset.cat, isNaN(v) ? 0 : Math.abs(v)); },
    'rp-bud-del': el => saveBudget(el.dataset.cat, 0),
    'rp-see': el => { closeSheet(); S.tab = 'tx'; S.fCat = el.dataset.cat; S.fMonth = S.month; S.q = ''; render(); window.scrollTo(0, 0); },
    'rp-wrap': el => openWrapped(el.dataset.m || S.month),
    'rp-wrap-next': wrapNext,
    'rp-wrap-close': closeWrapped,
  };
  return { paceCard, attachPace, savingsCard, budgetsCard, budgetInsights, wrapBanner, actions };
}
