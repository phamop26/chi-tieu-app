// Tab Tài chính: thẻ tín dụng, ví trả sau, tiết kiệm, mục tiêu, đầu tư, tài sản ròng, nhắc qua Lịch.
// Mọi số liệu do người dùng nhập tay và chỉ lưu trên máy.
import './i18n-fin.js';
import { t, locale } from './i18n.js';
import { parseAmount } from './parse.js';

const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const daysBetween = (a, b) => Math.round((b - a) / 86400000);
const lastDay = (y, m) => new Date(y, m + 1, 0).getDate();

export const TYPES = ['credit', 'paylater', 'savings', 'invest', 'bank', 'goal'];
const DEBT = ['credit', 'paylater'];
const KIND_ICON = { stock: '📊', fund: '🧺', gold: '🥇', crypto: '🪙', other: '📈' };
export function accIcon(a) {
  if (a.type === 'invest') return KIND_ICON[a.kind] || '📈';
  return { bank: '🏧', credit: '💳', paylater: '🛍️', savings: '🏦' }[a.type] || '💼';
}

// Ngày đến hạn trong tháng (y, m), tự lùi về ngày cuối tháng nếu tháng ngắn
function dueIn(y, m, day) { return new Date(y, m, Math.min(day, lastDay(y, m))); }

export function initFinance(ctx) {
  const { S, db, esc, money, pct, openSheet, closeSheet, toast, render, download } = ctx;
  const accById = id => S.accounts.find(a => a.id === id);
  const shortDate = d => d.toLocaleDateString(locale(), { day: 'numeric', month: 'short' });

  // ---------- Dữ liệu ----------
  async function saveAcc(a) { await db.put('accounts', a); }
  function setBalance(a, v) {
    a.balance = v;
    const today = ymd(new Date());
    a.updatedAt = today;
    a.history = a.history || [];
    const last = a.history[a.history.length - 1];
    if (last && last.d === today) last.v = v; else a.history.push({ d: today, v });
    if (a.history.length > 400) a.history.shift();
  }
  const signedValue = a => (DEBT.includes(a.type) ? -(a.balance || 0) : (a.balance || 0));

  function totals() {
    let assets = 0, debts = 0;
    for (const a of S.accounts) { if (DEBT.includes(a.type)) debts += a.balance || 0; else assets += a.balance || 0; }
    return { assets, debts, net: assets - debts };
  }
  function valueAt(a, dateStr) {
    let v = null;
    for (const h of a.history || []) if (h.d <= dateStr) v = h.v;
    if (v === null) return 0;
    return DEBT.includes(a.type) ? -v : v;
  }
  function netWorthMonths(n = 6) {
    const res = [];
    const now = new Date();
    for (let i = n - 1; i >= 0; i--) {
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
      const key = ymd(i === 0 ? now : end);
      const hasData = S.accounts.some(a => (a.history || []).some(h => h.d <= key));
      if (!hasData) continue;
      res.push({ ym: key.slice(0, 7), v: S.accounts.reduce((s, a) => s + valueAt(a, key), 0) });
    }
    return res;
  }

  function goalCurrent(g) { const a = g.link && accById(g.link); return a ? (a.balance || 0) : (g.saved || 0); }
  function goalPlan(g) {
    const cur = goalCurrent(g);
    const now = new Date();
    const [y, m] = (g.deadline || '').split('-').map(Number);
    const months = y ? Math.max(1, (y - now.getFullYear()) * 12 + (m - 1 - now.getMonth()) + 1) : 12;
    const left = Math.max(0, (g.target || 0) - cur);
    return { cur, months, perMonth: left / months, done: cur >= (g.target || 0) && g.target > 0 };
  }

  // Trạng thái hạn trả của một khoản nợ
  function debtDue(a) {
    if (!a.dueDay) return null;
    const today = startOfToday();
    const thisDue = dueIn(today.getFullYear(), today.getMonth(), a.dueDay);
    const paidThisCycle = a.paidAt && parseYmd(a.paidAt) >= new Date(thisDue.getTime() - 28 * 86400000);
    // Chỉ coi là quá hạn khi số dư được nhập TRƯỚC ngày đến hạn mà chưa bấm "Đã trả".
    // Số dư nhập sau ngày đến hạn được hiểu là của kỳ mới.
    const knownBeforeDue = a.updatedAt && parseYmd(a.updatedAt) < thisDue;
    if (today > thisDue && !paidThisCycle && knownBeforeDue && (a.balance || 0) > 0 && daysBetween(thisDue, today) <= 20) {
      return { overdue: true, days: daysBetween(thisDue, today), date: thisDue };
    }
    const next = today <= thisDue && !paidThisCycle && !(a.updatedAt && parseYmd(a.updatedAt) > thisDue) ? thisDue : dueIn(today.getFullYear(), today.getMonth() + 1, a.dueDay);
    return { overdue: false, days: daysBetween(today, next), date: next };
  }

  function upcoming() {
    const items = [];
    const today = startOfToday();
    for (const a of S.accounts) {
      if (DEBT.includes(a.type) && (a.balance || 0) > 0) {
        const d = debtDue(a);
        if (!d) continue;
        if (d.overdue) items.push({ k: -100 + d.days, icon: '⚠️', text: t('fOverdue', { name: a.name, d: d.days, a: money(a.balance) }), urgent: true });
        else if (d.days === 0) items.push({ k: 0, icon: '⏰', text: t('fDueToday', { name: a.name, a: money(a.balance) }), urgent: true });
        else if (d.days <= 10) items.push({ k: d.days, icon: accIcon(a), text: t('fDueIn', { name: a.name, a: money(a.balance), date: shortDate(d.date), d: d.days }) });
      }
      if (a.type === 'savings' && a.maturity) {
        const days = daysBetween(today, parseYmd(a.maturity));
        if (days >= 0 && days <= 14) items.push({ k: days + 0.5, icon: '🏦', text: t('fMatureIn', { name: a.name, date: shortDate(parseYmd(a.maturity)), d: days }) });
      }
    }
    for (const g of S.goals) {
      const p = goalPlan(g);
      if (!p.done && p.perMonth > 0) items.push({ k: 50, icon: '🎯', text: t('fGoalNeed', { name: g.name, a: money(p.perMonth) }) });
    }
    return items.sort((a, b) => a.k - b.k);
  }

  // ---------- Giao diện ----------
  function upcomingCard(compact = false) {
    const list = upcoming();
    if (!list.length) return compact ? '' : `<section class="card"><h3>${esc(t('fUpcoming'))}</h3><p class="muted">${esc(t('fNothingDue'))}</p></section>`;
    return `<section class="card"><h3>${esc(t('fUpcoming'))}</h3><ul class="insights">${list.map(i => `<li class="${i.urgent ? 'urgent' : ''}"><span class="ins-icon">${i.icon}</span><span>${esc(i.text)}</span></li>`).join('')}</ul>
      ${compact ? `<button class="btn ghost small" data-act="tab" data-tab="finance">${esc(t('tabFinance'))} ›</button>` : ''}</section>`;
  }

  const bar = (ratio, warn) => `<span class="cb-track"><span class="cb-fill ${warn ? 'warn' : ''}" style="width:${Math.min(100, Math.max(2, ratio * 100)).toFixed(1)}%"></span></span>`;
  const updatedNote = (a, hasSub) => {
    if (!a.updatedAt) return '';
    const sep = hasSub ? ' · ' : '';
    const stale = daysBetween(parseYmd(a.updatedAt), startOfToday()) > 35;
    return stale ? `${sep}<span class="pill">${esc(t('fStale'))}</span>` : `${sep}${esc(t('fUpdated', { d: shortDate(parseYmd(a.updatedAt)) }))}`;
  };

  function itemHtml(a) {
    let sub = '', extra = '';
    if (DEBT.includes(a.type)) {
      const d = debtDue(a);
      if (d && (a.balance || 0) > 0) sub = d.overdue ? t('fOverdueShort', { d: d.days }) : t('fDueShort', { date: shortDate(d.date), d: d.days });
      if (a.limit) { const r = (a.balance || 0) / a.limit; extra = bar(r, r > 0.7) + `<small class="muted">${esc(t('fUsed', { p: pct(r) }))}</small>`; }
    } else if (a.type === 'savings') {
      sub = [a.rate ? `${new Intl.NumberFormat(locale()).format(a.rate)}%/${t('perYear').replace('/', '')}` : '', a.maturity ? shortDate(parseYmd(a.maturity)) : ''].filter(Boolean).join(' · ');
    } else if (a.type === 'invest') {
      const pl = (a.balance || 0) - (a.invested || 0);
      sub = `${t('fKind_' + (a.kind || 'other'))}` + (a.invested ? ' · ' + t('fPL', { a: (pl >= 0 ? '+' : '−') + money(Math.abs(pl)), p: pct(a.invested ? pl / a.invested : 0) }) : '');
    }
    return `<li class="fin-item"><button class="li" data-act="fin-edit" data-id="${esc(a.id)}">
      <span class="li-icon">${accIcon(a)}</span>
      <span class="li-main"><b>${esc(a.name)}</b><small class="muted">${esc(sub)}${updatedNote(a, !!sub)}</small>${extra}</span>
      <span class="li-amt">${esc(money(a.balance || 0))}</span></button>
      ${DEBT.includes(a.type) && (a.balance || 0) > 0 ? `<button class="btn small primary paid-btn" data-act="fin-paid" data-id="${esc(a.id)}">${esc(t('fPaid'))}</button>` : ''}</li>`;
  }

  function goalHtml(g) {
    const p = goalPlan(g);
    return `<li><button class="li" data-act="fin-goal-edit" data-id="${esc(g.id)}">
      <span class="li-icon">${esc(g.icon || '🎯')}</span>
      <span class="li-main"><b>${esc(g.name)}</b>
        <small class="muted">${esc(money(p.cur))} / ${esc(money(g.target || 0))} · ${esc(p.done ? t('fGoalDone') : t('fPerMonth', { a: money(p.perMonth) }) + ' · ' + t('fMonthsLeft', { n: p.months }))}</small>
        ${bar(g.target ? p.cur / g.target : 0)}</span>
      <span class="li-amt">${esc(pct(g.target ? Math.min(1, p.cur / g.target) : 0))}</span></button></li>`;
  }

  function section(title, items) {
    if (!items.length) return '';
    return `<h4 class="sec-title">${esc(title)}</h4><ul class="list card">${items.join('')}</ul>`;
  }

  function view() {
    const tot = totals();
    const hist = netWorthMonths(6);
    const prev = hist.length >= 2 ? hist[hist.length - 2].v : null;
    const empty = !S.accounts.length && !S.goals.length;
    const by = type => S.accounts.filter(a => a.type === type);
    return `
    <header class="top"><span class="brand">${esc(t('tabFinance'))}</span><button class="btn small primary" data-act="fin-add">＋ ${esc(t('fAdd'))}</button></header>
    ${empty ? `<section class="welcome"><div class="welcome-art">🧭</div><p>${esc(t('fEmpty'))}</p><button class="btn primary big" data-act="fin-add">＋ ${esc(t('fAdd'))}</button></section>` : `
    <section class="hero card">
      <div class="hero-label">${esc(t('fNetWorth'))}</div>
      <div class="hero-value">${esc(money(tot.net))}</div>
      <div class="hero-cmp">${prev !== null ? esc(t('fVsLast', { a: (tot.net - prev >= 0 ? '+' : '−') + money(Math.abs(tot.net - prev)) })) : esc(t('fNwHint'))}</div>
      <div class="hero-row two">
        <div><span class="muted">${esc(t('fAssets'))}</span><b>${esc(money(tot.assets))}</b></div>
        <div><span class="muted">${esc(t('fDebts'))}</span><b>${esc(money(tot.debts))}</b></div>
      </div>
    </section>
    <div class="row-gap left">
      <button class="btn small" data-act="fin-update-all">✏️ ${esc(t('fUpdateAll'))}</button>
      <button class="btn small" data-act="fin-cal">📅 ${esc(t('fAddCal'))}</button>
    </div>
    ${upcomingCard()}
    ${section(t('fDebtSec'), [...by('credit'), ...by('paylater')].map(itemHtml))}
    ${section(t('fGoalSec'), S.goals.map(goalHtml))}
    ${section(t('fSavingSec'), by('savings').map(itemHtml))}
    ${section(t('fInvestSec'), by('invest').map(itemHtml))}
    ${by('invest').length ? `<p class="muted small">${esc(t('fNoAdvice'))}</p>` : ''}
    ${section(t('fBankSec'), by('bank').map(itemHtml))}
    ${hist.length >= 2 ? `<details class="card table-view"><summary>${esc(t('fNwHistory'))}</summary><table><tbody>${hist.map((h, i) => `<tr><td>${esc(ctx.monthLabel(h.ym))}</td><td class="num">${esc(money(h.v))}</td><td class="num muted">${i ? esc((h.v - hist[i - 1].v >= 0 ? '+' : '−') + money(Math.abs(h.v - hist[i - 1].v))) : ''}</td></tr>`).join('')}</tbody></table></details>` : ''}
    `}`;
  }

  // ---------- Form ----------
  const numStr = v => (v || v === 0 ? new Intl.NumberFormat(locale(), { maximumFractionDigits: 2 }).format(v) : '');
  const moneyField = (id, label, v) => `<label class="field">${esc(label)}<input id="${id}" inputmode="decimal" autocomplete="off" value="${esc(numStr(v))}"></label>`;
  const readMoney = id => { const v = parseAmount(document.getElementById(id)?.value || ''); return isNaN(v) ? 0 : Math.abs(v); };

  function openAdd() {
    openSheet(`<h3>${esc(t('fAddWhat'))}</h3><div class="type-grid">${TYPES.map(ty => `<button class="type-btn" data-act="fin-new" data-type="${ty}"><span>${ty === 'goal' ? '🎯' : accIcon({ type: ty, kind: 'other' })}</span>${esc(t('fType_' + ty))}</button>`).join('')}</div>
      <button class="btn ghost wide" data-act="sheet-close">${esc(t('cancel'))}</button>`);
  }

  function openAccForm(type, a) {
    a = a || { type, name: type === 'paylater' ? 'SPayLater' : '', kind: 'crypto' };
    const isDebt = DEBT.includes(type);
    let fields = `<label class="field">${esc(t('fName'))}<input id="ff-name" maxlength="40" value="${esc(a.name)}"></label>`;
    if (type === 'invest') {
      fields += `<label class="field">${esc(t('fKind'))}<select id="ff-kind">${Object.keys(KIND_ICON).map(k => `<option value="${k}" ${a.kind === k ? 'selected' : ''}>${KIND_ICON[k]} ${esc(t('fKind_' + k))}</option>`).join('')}</select></label>`;
      fields += moneyField('ff-invested', t('fInvested'), a.invested) + moneyField('ff-balance', t('fValue'), a.balance);
    } else {
      fields += moneyField('ff-balance', isDebt ? t('fOwed') : t('fBalance'), a.balance);
    }
    if (type === 'credit') fields += moneyField('ff-limit', t('fLimit'), a.limit);
    if (isDebt) fields += `<label class="field">${esc(t('fDueDay'))}<input id="ff-due" type="number" inputmode="numeric" min="1" max="31" value="${esc(a.dueDay || '')}"></label>`;
    if (type === 'savings') {
      fields += `<label class="field">${esc(t('fRate'))}<input id="ff-rate" inputmode="decimal" value="${esc(a.rate || '')}"></label>`;
      fields += `<label class="field">${esc(t('fMaturity'))}<input id="ff-maturity" type="date" value="${esc(a.maturity || '')}"></label>`;
    }
    openSheet(`<h3>${accIcon(a)} ${esc(t('fType_' + type))}</h3>${fields}
      <div class="row-gap">${a.id ? `<button class="btn danger" data-act="fin-del" data-id="${esc(a.id)}">${esc(t('delete'))}</button>` : ''}
      <button class="btn ghost" data-act="sheet-close">${esc(t('cancel'))}</button>
      <button class="btn primary" data-act="fin-save" data-type="${type}" data-id="${esc(a.id || '')}">${esc(t('save'))}</button></div>`);
    setTimeout(() => { const n = document.getElementById('ff-name'); if (n && !n.value) n.focus(); }, 250);
  }

  async function saveAccForm(type, id) {
    const name = document.getElementById('ff-name').value.trim();
    if (!name) { document.getElementById('ff-name').focus(); return; }
    let a = id ? accById(id) : null;
    const isNew = !a;
    if (isNew) { a = { id: 'a_' + Date.now().toString(36), type, history: [] }; S.accounts.push(a); }
    a.name = name;
    if (type === 'invest') { a.kind = document.getElementById('ff-kind').value; a.invested = readMoney('ff-invested'); }
    if (type === 'credit') a.limit = readMoney('ff-limit');
    if (DEBT.includes(type)) {
      const d = parseInt(document.getElementById('ff-due').value, 10);
      a.dueDay = d >= 1 && d <= 31 ? d : null;
    }
    if (type === 'savings') {
      const r = parseFloat(String(document.getElementById('ff-rate').value).replace(',', '.'));
      a.rate = isNaN(r) ? null : r;
      a.maturity = document.getElementById('ff-maturity').value || null;
    }
    const bal = readMoney('ff-balance');
    if (isNew || bal !== a.balance) setBalance(a, bal);
    await saveAcc(a);
    closeSheet(); render();
  }

  function openGoalForm(g) {
    g = g || { name: '', icon: '🎯' };
    const linkable = S.accounts.filter(a => a.type === 'savings' || a.type === 'bank' || a.type === 'invest');
    openSheet(`<h3>🎯 ${esc(t('fType_goal'))}</h3>
      <label class="field">${esc(t('fName'))}<input id="fg-name" maxlength="40" value="${esc(g.name)}"></label>
      ${moneyField('fg-target', t('fTarget'), g.target)}
      <label class="field">${esc(t('fDeadline'))}<input id="fg-deadline" type="month" value="${esc(g.deadline || '')}"></label>
      <label class="field">${esc(t('fLinkAcc'))}<select id="fg-link"><option value="">${esc(t('fNoLink'))}</option>${linkable.map(a => `<option value="${esc(a.id)}" ${g.link === a.id ? 'selected' : ''}>${accIcon(a)} ${esc(a.name)}</option>`).join('')}</select></label>
      ${moneyField('fg-saved', t('fSaved'), g.saved)}
      <div class="row-gap">${g.id ? `<button class="btn danger" data-act="fin-goal-del" data-id="${esc(g.id)}">${esc(t('delete'))}</button>` : ''}
      <button class="btn ghost" data-act="sheet-close">${esc(t('cancel'))}</button>
      <button class="btn primary" data-act="fin-goal-save" data-id="${esc(g.id || '')}">${esc(t('save'))}</button></div>`);
  }
  async function saveGoalForm(id) {
    const name = document.getElementById('fg-name').value.trim();
    if (!name) { document.getElementById('fg-name').focus(); return; }
    let g = id ? S.goals.find(x => x.id === id) : null;
    if (!g) { g = { id: 'g_' + Date.now().toString(36), icon: '🎯' }; S.goals.push(g); }
    g.name = name;
    g.target = readMoney('fg-target');
    g.deadline = document.getElementById('fg-deadline').value || null;
    g.link = document.getElementById('fg-link').value || null;
    g.saved = readMoney('fg-saved');
    await db.put('goals', g);
    closeSheet(); render();
  }

  function openUpdateAll() {
    if (!S.accounts.length) return openAdd();
    openSheet(`<h3>✏️ ${esc(t('fUpdateAll'))}</h3><p class="muted small">${esc(t('fUpdateAllHint'))}</p>
      ${S.accounts.map(a => moneyField('fu-' + a.id, `${accIcon(a)} ${a.name} — ${DEBT.includes(a.type) ? t('fOwed') : a.type === 'invest' ? t('fValue') : t('fBalance')}`, a.balance)).join('')}
      <div class="row-gap"><button class="btn ghost" data-act="sheet-close">${esc(t('cancel'))}</button><button class="btn primary" data-act="fin-update-save">${esc(t('save'))}</button></div>`);
  }
  async function saveUpdateAll() {
    const changed = [];
    for (const a of S.accounts) {
      const el = document.getElementById('fu-' + a.id);
      if (!el) continue;
      const v = readMoney('fu-' + a.id);
      if (v !== (a.balance || 0)) { setBalance(a, v); changed.push(a); }
    }
    if (changed.length) await db.putMany('accounts', changed);
    closeSheet(); render();
  }

  function openPaid(a) {
    openSheet(`<h3>${accIcon(a)} ${esc(a.name)}</h3>${moneyField('fp-amount', t('fPaidHow'), a.balance)}
      <div class="row-gap"><button class="btn ghost" data-act="sheet-close">${esc(t('cancel'))}</button><button class="btn primary" data-act="fin-paid-save" data-id="${esc(a.id)}">${esc(t('save'))}</button></div>`);
  }
  async function savePaid(a) {
    const paid = readMoney('fp-amount');
    setBalance(a, Math.max(0, (a.balance || 0) - paid));
    a.paidAt = ymd(new Date());
    await saveAcc(a);
    closeSheet(); render();
  }

  // ---------- Lịch (.ics) ----------
  function icsText() {
    const esc2 = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
    const dstr = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const enc = new TextEncoder();
    const fold = line => { // dòng iCalendar tối đa 75 byte
      const out = []; let cur = '';
      for (const ch of line) {
        if (enc.encode(cur + ch).length > (out.length ? 74 : 75)) { out.push(cur); cur = ch; } else cur += ch;
      }
      out.push(cur);
      return out.join('\r\n ');
    };
    const monthDay = day => (day <= 28 ? day : day === 31 ? -1 : 28);
    const events = [];
    const ev = ({ uid, start, summary, desc, monthly, alarms }) => {
      const end = new Date(start); end.setDate(end.getDate() + 1);
      const l = ['BEGIN:VEVENT', `UID:${uid}@chi-tieu-app`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${dstr(start)}`, `DTEND;VALUE=DATE:${dstr(end)}`];
      if (monthly) l.push(`RRULE:FREQ=MONTHLY;BYMONTHDAY=${monthDay(monthly)}`);
      l.push(`SUMMARY:${esc2(summary)}`);
      if (desc) l.push(`DESCRIPTION:${esc2(desc)}`);
      l.push('TRANSP:TRANSPARENT');
      for (const a of alarms) l.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc2(summary)}`, `TRIGGER:${a}`, 'END:VALARM');
      l.push('END:VEVENT');
      events.push(...l);
    };
    const today = startOfToday();
    const nextDay = day => { const d = dueIn(today.getFullYear(), today.getMonth(), day); return d >= today ? d : dueIn(today.getFullYear(), today.getMonth() + 1, day); };
    for (const a of S.accounts) {
      if (DEBT.includes(a.type) && a.dueDay) ev({ uid: 'pay-' + a.id, start: nextDay(a.dueDay), monthly: a.dueDay, summary: t('calPay', { name: a.name }), desc: t('calPayDesc'), alarms: ['-P2DT15H', 'PT9H'] });
      if (a.type === 'savings' && a.maturity && parseYmd(a.maturity) >= today) ev({ uid: 'mat-' + a.id, start: parseYmd(a.maturity), summary: t('calMature', { name: a.name }), alarms: ['-P2DT15H', 'PT9H'] });
    }
    const ci = S.settings.checkinDay || 1, sd = S.settings.saveDay || 6;
    ev({ uid: 'checkin', start: nextDay(ci), monthly: ci, summary: t('calCheckin'), alarms: ['PT20H'] });
    if (S.goals.length) ev({ uid: 'save', start: nextDay(sd), monthly: sd, summary: t('calSave'), desc: t('calSaveDesc'), alarms: ['PT9H'] });
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Chi Tieu//Personal//VI', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', ...events, 'END:VCALENDAR'].map(fold).join('\r\n') + '\r\n';
  }

  function openCal() {
    const s = S.settings;
    openSheet(`<h3>📅 ${esc(t('fAddCal'))}</h3><p class="muted small">${esc(t('fCalHint'))}</p>
      <label class="field">${esc(t('fCalCheckin'))}<input id="fc-checkin" type="number" inputmode="numeric" min="1" max="28" value="${s.checkinDay || 1}"></label>
      ${S.goals.length ? `<label class="field">${esc(t('fCalSave'))}<input id="fc-save" type="number" inputmode="numeric" min="1" max="28" value="${s.saveDay || 6}"></label>` : ''}
      <p class="muted small">${esc(t('fCalDup'))}</p>
      <div class="row-gap"><button class="btn ghost" data-act="sheet-close">${esc(t('cancel'))}</button><button class="btn primary" data-act="fin-cal-make">${esc(t('fCalMake'))}</button></div>`);
  }
  async function makeCal() {
    const clampDay = (id, def) => { const el = document.getElementById(id); const v = el ? parseInt(el.value, 10) : def; return v >= 1 && v <= 28 ? v : def; };
    S.settings.checkinDay = clampDay('fc-checkin', 1);
    S.settings.saveDay = clampDay('fc-save', S.settings.saveDay || 6);
    await db.setKV('settings', S.settings);
    const text = icsText();
    closeSheet();
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    // iPhone: mở file .ics từ chính app (qua service worker) → iOS hiện bảng "Thêm vào Lịch"
    if (isIOS && navigator.serviceWorker && navigator.serviceWorker.controller && window.caches) {
      const c = await caches.open('gen');
      await c.put(new URL('Chi-Tieu-nhac.ics', location.href).href, new Response(text, { headers: { 'Content-Type': 'text/calendar; charset=utf-8' } }));
      toast(t('fCalOpened'), 8000);
      location.href = 'Chi-Tieu-nhac.ics?' + Date.now();
      return;
    }
    download('Chi-Tieu-nhac.ics', text, 'text/calendar');
    toast(t('fCalOpened'), 8000);
  }

  // ---------- Hành động ----------
  const actions = {
    'fin-add': openAdd,
    'fin-new': async el => { const ty = el.dataset.type; closeSheet(); await new Promise(r => setTimeout(r, 220)); ty === 'goal' ? openGoalForm() : openAccForm(ty); },
    'fin-edit': el => { const a = accById(el.dataset.id); if (a) openAccForm(a.type, a); },
    'fin-save': el => saveAccForm(el.dataset.type, el.dataset.id),
    'fin-del': async el => {
      const a = accById(el.dataset.id);
      if (!a || !confirm(t('fDeleteConfirm', { name: a.name }))) return;
      S.accounts = S.accounts.filter(x => x !== a);
      for (const g of S.goals) if (g.link === a.id) { g.saved = a.balance || 0; g.link = null; await db.put('goals', g); }
      await db.remove('accounts', a.id); closeSheet(); render();
    },
    'fin-goal-edit': el => openGoalForm(S.goals.find(g => g.id === el.dataset.id)),
    'fin-goal-save': el => saveGoalForm(el.dataset.id),
    'fin-goal-del': async el => {
      const g = S.goals.find(x => x.id === el.dataset.id);
      if (!g || !confirm(t('fDeleteConfirm', { name: g.name }))) return;
      S.goals = S.goals.filter(x => x !== g); await db.remove('goals', g.id); closeSheet(); render();
    },
    'fin-update-all': openUpdateAll,
    'fin-update-save': saveUpdateAll,
    'fin-paid': (el, e) => { e.stopPropagation(); const a = accById(el.dataset.id); if (a) openPaid(a); },
    'fin-paid-save': el => savePaid(accById(el.dataset.id)),
    'fin-cal': openCal,
    'fin-cal-make': makeCal,
  };

  // Chọn tài khoản cho sao kê vừa nhập
  function chooseAccount() {
    const list = S.accounts.filter(a => a.type === 'bank' || DEBT.includes(a.type));
    if (!list.length) return Promise.resolve(null);
    return new Promise(resolve => {
      openSheet(`<h3>${esc(t('fWhichAccount'))}</h3><p class="muted small">${esc(t('fWhichHint'))}</p>
        <div class="type-grid">${list.map(a => `<button class="type-btn" data-act="fin-pick-acc" data-id="${esc(a.id)}"><span>${accIcon(a)}</span>${esc(a.name)}</button>`).join('')}
        <button class="type-btn" data-act="fin-pick-acc" data-id=""><span>➖</span>${esc(t('fNoAccount'))}</button></div>`, v => resolve(v || null));
    });
  }
  actions['fin-pick-acc'] = el => closeSheet(el.dataset.id ? accById(el.dataset.id) : null);

  return { view, upcomingCard, actions, chooseAccount, isDebt: a => !!a && DEBT.includes(a.type), icsText };
}
