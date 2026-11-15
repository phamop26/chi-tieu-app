// Gói đăng ký (subscription): tự tìm trong sao kê, tổng chi phí, nhắc trước ngày gia hạn / hết dùng thử.
// Lưu trên máy (kv "subs"). Không gửi gì ra ngoài.
import './i18n-v8.js';
import { t, locale } from './i18n.js';
import { SUB_SERVICES, matchService } from './classify.js';
import { parseMoneyInput } from './parse.js';

const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const today0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const days = (a, b) => Math.round((b - a) / 86400000);
function addPeriod(dateStr, cycle) {
  const d = parseYmd(dateStr);
  const day = d.getDate();
  const n = new Date(d.getFullYear() + (cycle === 'year' ? 1 : 0), d.getMonth() + (cycle === 'year' ? 0 : 1), 1);
  n.setDate(Math.min(day, new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate()));
  return ymd(n);
}

export function initSubs(ctx) {
  const { S, db, esc, money, openSheet, closeSheet, toast, render } = ctx;
  const list = () => S.subs || (S.subs = []);
  const active = () => list().filter(x => !x.paused);
  const save = () => db.setKV('subs', list());
  const rates = () => ({ VND: 1, USD: 25700, EUR: 28400, ...((S.settings.fx || {}).rates || {}) });
  const toVnd = (v, cur) => (v || 0) * (rates()[cur || 'VND'] || 1);
  const moneyIn = (v, cur) => (!cur || cur === 'VND' ? money(v) : new Intl.NumberFormat(locale(), { style: 'currency', currency: cur, maximumFractionDigits: 2 }).format(v));
  const shortDate = s => parseYmd(s).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
  const svc = id => SUB_SERVICES.find(x => x.id === id);
  const lastChargeOf = s => S.txs.filter(x => x.amount < 0 && s.service && matchService(x.desc)?.id === s.service).reduce((m, x) => (!m || x.date > m ? x.date : m), null);

  // Đẩy ngày gia hạn đã qua lên kỳ tiếp theo
  function rollForward(sub) {
    if (sub.cycle === 'topup' || !sub.next) return false;
    let changed = false; const t0 = ymd(today0());
    while (sub.next < t0) { sub.next = addPeriod(sub.next, sub.cycle); changed = true; }
    return changed;
  }
  function tick() { let ch = false; for (const s of list()) ch = rollForward(s) || ch; if (ch) save(); }

  const monthlyVnd = s => s.cycle === 'year' ? toVnd(s.amount, s.currency) / 12 : s.cycle === 'topup' ? topupMonthly(s) : toVnd(s.amount, s.currency);
  // Gói nạp trước: ước tính chi mỗi tháng theo 3 tháng gần nhất trong sao kê
  function topupMonthly(s) {
    const since = new Date(); since.setMonth(since.getMonth() - 3);
    const from = ymd(since);
    const tot = S.txs.filter(x => x.amount < 0 && x.date >= from && matchService(x.desc)?.id === s.service).reduce((a, x) => a - x.amount, 0);
    return tot ? tot / 3 : toVnd(s.amount, s.currency) / 3;
  }

  // Tìm gói trong sao kê mà chưa theo dõi
  function detect() {
    const tracked = new Set(list().map(s => s.service).filter(Boolean));
    const found = new Map();
    for (const x of S.txs) {
      if (x.amount >= 0) continue;
      const sv = matchService(x.desc);
      if (!sv || tracked.has(sv.id)) continue;
      const f = found.get(sv.id) || { sv, n: 0, last: null };
      f.n++;
      if (!f.last || x.date > f.last.date) f.last = x;
      found.set(sv.id, f);
    }
    return [...found.values()].sort((a, b) => (b.sv.kind === 'ai') - (a.sv.kind === 'ai') || b.last.date.localeCompare(a.last.date));
  }

  // ---------- Giao diện ----------
  function section() {
    tick();
    const subs = active().sort((a, b) => (a.cycle === 'topup') - (b.cycle === 'topup') || (a.next || '9').localeCompare(b.next || '9'));
    const m = subs.reduce((a, s) => a + monthlyVnd(s), 0);
    const ai = subs.filter(s => s.ai).reduce((a, s) => a + monthlyVnd(s), 0);
    const found = detect();
    const t0 = today0();
    return `<div class="row-between sec-row"><h4 class="sec-title">${esc(t('subsSec'))}</h4><button class="btn small ghost" data-act="sub-add">＋ ${esc(t('subsAdd'))}</button></div>
      <section class="card subs">
        ${subs.length ? `<div class="subs-sum"><b>${esc(t('subsSum', { m: money(m), y: money(m * 12) }))}</b>${ai ? `<small class="muted">🤖 ${esc(t('subsSumAI', { m: money(ai) }))}</small>` : ''}</div>
        <ul class="list">${subs.map(s => {
          const d = s.next ? days(t0, parseYmd(s.next)) : null;
          const trial = s.trialEnd && s.trialEnd >= ymd(t0) ? days(t0, parseYmd(s.trialEnd)) : null;
          const lc = s.cycle === 'topup' ? lastChargeOf(s) : null;
          const when = s.cycle === 'topup' ? (lc ? t('subsTopupLast', { date: shortDate(lc) }) : t('cycTopup'))
            : trial !== null ? `⏳ ${shortDate(s.trialEnd)}` : s.next ? `${shortDate(s.next)} · ${d === 0 ? '⏰' : d + 'd'}` : '';
          const soon = (d !== null && d <= 3 && s.cycle !== 'topup') || (trial !== null && trial <= 3);
          return `<li><button class="li" data-act="sub-edit" data-id="${esc(s.id)}">
            <span class="li-icon">${esc(s.icon || '🔁')}</span>
            <span class="li-main"><b>${esc(s.name)}${s.ai ? ' <span class="pill">AI</span>' : ''}</b><small class="${soon ? 'warn-text' : 'muted'}">${esc(when)}</small></span>
            <span class="li-amt">${esc(moneyIn(s.amount, s.currency))}<small class="muted">${esc(s.cycle === 'year' ? '/' + t('cycYear').toLowerCase() : s.cycle === 'topup' ? '' : t('subsPerMonth', { a: '' }).trim())}</small></span></button></li>`;
        }).join('')}</ul>` : `<p class="muted small">${esc(t('subsEmpty'))}</p>`}
        ${found.length ? `<div class="subs-found"><small class="muted">${esc(t('subsFound'))}</small>${found.map(f => `<div class="set-row"><span>${f.sv.icon} <b>${esc(f.sv.name)}</b> <small class="muted">${esc(t('subsLastCharge', { date: shortDate(f.last.date), a: money(-f.last.amount) }))}</small></span>
          <button class="btn small primary" data-act="sub-from" data-svc="${f.sv.id}">${esc(t('subsFoundAdd'))}</button></div>`).join('')}</div>` : ''}
      </section>`;
  }

  function openForm(sub) {
    sub = sub || { name: '', amount: '', currency: 'USD', cycle: 'month', next: ymd(today0()), ai: false, icon: '🔁' };
    const num = v => (v || v === 0 ? new Intl.NumberFormat(locale(), { maximumFractionDigits: 2 }).format(v) : '');
    openSheet(`<h3>${esc(sub.icon || '🔁')} ${esc(sub.name || t('subsAdd'))}</h3>
      <label class="field">${esc(t('subsName'))}<input id="sb-name" maxlength="40" value="${esc(sub.name)}" list="sb-names" autocomplete="off"></label>
      <datalist id="sb-names">${SUB_SERVICES.map(x => `<option value="${esc(x.name)}">`).join('')}</datalist>
      <div class="two-col"><label class="field">${esc(t('subsAmount'))}<input id="sb-amount" inputmode="decimal" value="${esc(num(sub.amount))}" placeholder="20"></label>
        <label class="field">${esc(t('fCurrency'))}<select id="sb-cur">${['USD', 'VND', 'EUR'].map(c => `<option ${sub.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label></div>
      <label class="field">${esc(t('subsCycle'))}<select id="sb-cycle">${[['month', 'cycMonth'], ['year', 'cycYear'], ['topup', 'cycTopup']].map(([v, k]) => `<option value="${v}" ${sub.cycle === v ? 'selected' : ''}>${esc(t(k))}</option>`).join('')}</select></label>
      <label class="field">${esc(t('subsNext'))}<input id="sb-next" type="date" value="${esc(sub.next || '')}"></label>
      <label class="field">${esc(t('subsTrial'))}<input id="sb-trial" type="date" value="${esc(sub.trialEnd || '')}"></label>
      <label class="set-row"><span>🤖 ${esc(t('subsAI'))}</span><input type="checkbox" class="switch" id="sb-ai" ${sub.ai ? 'checked' : ''}></label>
      ${sub.id ? `<label class="set-row"><span>⏸️ ${esc(t('subsPaused'))}</span><input type="checkbox" class="switch" id="sb-paused" ${sub.paused ? 'checked' : ''}></label>` : ''}
      <div class="row-gap">${sub.id ? `<button class="btn danger" data-act="sub-del" data-id="${esc(sub.id)}">${esc(t('delete'))}</button>` : ''}
        <button class="btn ghost" data-act="sheet-close">${esc(t('cancel'))}</button><button class="btn primary" data-act="sub-save" data-id="${esc(sub.id || '')}" data-svc="${esc(sub.service || '')}">${esc(t('save'))}</button></div>`);
  }
  async function saveForm(id, service) {
    const name = document.getElementById('sb-name').value.trim();
    if (!name) { document.getElementById('sb-name').focus(); return; }
    const amount = Math.abs(parseMoneyInput(document.getElementById('sb-amount').value)) || 0;
    let s = id && list().find(x => x.id === id);
    if (!s) { s = { id: 's_' + Date.now().toString(36) }; list().push(s); }
    const known = SUB_SERVICES.find(x => x.name.toLowerCase() === name.toLowerCase()) || (service && svc(service));
    Object.assign(s, {
      name, amount, currency: document.getElementById('sb-cur').value, cycle: document.getElementById('sb-cycle').value,
      next: document.getElementById('sb-next').value || null, trialEnd: document.getElementById('sb-trial').value || null,
      ai: document.getElementById('sb-ai').checked, paused: !!document.getElementById('sb-paused')?.checked,
      service: known ? known.id : (s.service || null), icon: known ? known.icon : (s.icon || '🔁'),
    });
    rollForward(s);
    await save(); closeSheet(); render();
  }
  // Theo dõi một gói tìm được trong sao kê: điền sẵn tên, giá (VND theo sao kê), ngày gia hạn dự kiến
  function fromFound(id) {
    const f = detect().find(x => x.sv.id === id);
    if (!f) return;
    const isTopup = f.sv.id === 'deepseek';
    openForm({ name: f.sv.name, icon: f.sv.icon, ai: f.sv.kind === 'ai', service: f.sv.id, amount: -f.last.amount, currency: 'VND',
      cycle: isTopup ? 'topup' : 'month', next: isTopup ? null : addPeriod(f.last.date, 'month'), lastCharge: f.last.date });
  }

  // ---------- Nhắc ----------
  function upcomingItems() {
    tick();
    const out = [], t0 = today0();
    for (const s of active()) {
      if (s.trialEnd && s.trialEnd >= ymd(t0)) {
        const d = days(t0, parseYmd(s.trialEnd));
        if (d <= 3) out.push({ k: d - 0.5, icon: '⏳', urgent: d <= 1, text: t('subsTrialIn', { n: s.name, date: shortDate(s.trialEnd), d }) });
        continue;
      }
      if (s.cycle === 'topup' || !s.next) continue;
      const d = days(t0, parseYmd(s.next));
      const a = moneyIn(s.amount, s.currency) + (s.currency !== 'VND' ? ` ≈ ${money(toVnd(s.amount, s.currency))}` : '');
      if (d === 0) out.push({ k: 0, icon: s.icon || '🔁', urgent: true, text: t('subsRenewToday', { n: s.name, a }) });
      else if (d <= 3) out.push({ k: d, icon: s.icon || '🔁', text: t('subsRenewIn', { n: s.name, date: shortDate(s.next), a, d }) });
    }
    return out;
  }
  // Sự kiện cho file Lịch (.ics): gia hạn (báo trước 3 ngày và đúng ngày), hết dùng thử
  function icsEvents(ev) {
    tick();
    for (const s of active()) {
      if (s.trialEnd && s.trialEnd >= ymd(today0())) ev({ uid: 'trial-' + s.id, start: parseYmd(s.trialEnd), summary: t('calTrial', { name: s.name }), desc: t('calRenewDesc'), alarms: ['-P2DT15H', 'PT9H'] });
      if (s.cycle === 'topup' || !s.next) continue;
      const start = parseYmd(s.next);
      ev({ uid: 'sub-' + s.id, start, monthly: s.cycle === 'month' ? start.getDate() : null, yearly: s.cycle === 'year', summary: t('calRenew', { name: s.name }), desc: t('calRenewDesc'), alarms: ['-P2DT15H', 'PT9H'] });
    }
  }

  const actions = {
    'sub-add': () => openForm(),
    'sub-edit': el => openForm(list().find(x => x.id === el.dataset.id)),
    'sub-save': el => saveForm(el.dataset.id, el.dataset.svc),
    'sub-del': async el => { S.subs = list().filter(x => x.id !== el.dataset.id); await save(); closeSheet(); render(); },
    'sub-from': el => fromFound(el.dataset.svc),
  };
  return { section, upcomingItems, icsEvents, actions };
}
