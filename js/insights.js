// Tính tổng quan tháng, xu hướng, khoản lặp lại và khoản bất thường.
import { merchantKey } from './classify.js';

export const monthOf = d => d.slice(0, 7);
export function shiftMonth(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
const median = arr => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };

// kindOf(catId) → 'out' | 'in' | 'neutral'
export function monthSummary(txs, ym, kindOf, uptoDay = 31) {
  let out = 0, inc = 0, count = 0, unsure = 0;
  const byCat = {};
  for (const t of txs) {
    if (monthOf(t.date) !== ym || +t.date.slice(8, 10) > uptoDay) continue;
    count++;
    if (t.status === 'review') unsure++;
    const kind = kindOf(t.cat);
    if (kind === 'neutral') continue;
    if (t.amount < 0) {
      out += -t.amount;
      byCat[t.cat] = (byCat[t.cat] || 0) - t.amount;
    } else inc += t.amount;
  }
  const cats = Object.entries(byCat).map(([cat, v]) => ({ cat, v })).sort((a, b) => b.v - a.v);
  return { out, inc, count, unsure, cats, byCat };
}

export function monthlySeries(txs, endYm, n, kindOf, catFilter) {
  const res = [];
  for (let i = n - 1; i >= 0; i--) {
    const ym = shiftMonth(endYm, -i);
    let v = 0;
    for (const t of txs) {
      if (t.amount >= 0 || monthOf(t.date) !== ym || kindOf(t.cat) === 'neutral') continue;
      if (catFilter && t.cat !== catFilter) continue;
      v += -t.amount;
    }
    res.push({ ym, v });
  }
  return res;
}

// Khoản lặp lại: cùng người nhận, khoảng cách đều (tuần / tháng / năm), số tiền gần giống nhau.
export function findRecurring(txs, kindOf) {
  const groups = {};
  for (const t of txs) {
    if (t.amount >= 0 || kindOf(t.cat) === 'neutral') continue;
    const k = merchantKey(t.desc);
    if (!k) continue;
    (groups[k] = groups[k] || []).push(t);
  }
  const res = [];
  const latest = txs.reduce((m, t) => (t.date > m ? t.date : m), '0000');
  for (const [key, list] of Object.entries(groups)) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.date.localeCompare(b.date));
    const amts = list.map(t => -t.amount);
    const med = median(amts);
    const similar = list.filter(t => Math.abs(-t.amount - med) <= med * 0.2);
    if (similar.length < 2) continue;
    const gaps = [];
    for (let i = 1; i < similar.length; i++) gaps.push(daysBetween(similar[i - 1].date, similar[i].date));
    const g = median(gaps);
    let period = null;
    if (g >= 26 && g <= 35 && similar.length >= 2) period = 'month';
    else if (g >= 6 && g <= 8 && similar.length >= 4) period = 'week';
    else if (g >= 350 && g <= 380) period = 'year';
    if (!period) continue;
    const regular = gaps.filter(x => Math.abs(x - g) <= (period === 'week' ? 2 : 6)).length >= Math.max(1, gaps.length * 0.6);
    if (!regular) continue;
    const last = similar[similar.length - 1];
    if (daysBetween(last.date, latest) > g * 1.8) continue; // đã ngừng
    const next = new Date(last.date); next.setDate(next.getDate() + Math.round(g));
    const monthly = period === 'month' ? med : period === 'week' ? med * 52 / 12 : med / 12;
    res.push({
      key, desc: last.desc, cat: last.cat, amount: med, period, monthly,
      count: similar.length, last: last.date, next: next.toISOString().slice(0, 10),
      isNew: daysBetween(similar[0].date, latest) <= 75,
    });
  }
  return res.sort((a, b) => b.monthly - a.monthly);
}

// Khoản bất thường trong tháng ym
export function findAnomalies(txs, ym, kindOf) {
  const res = [];
  const outs = txs.filter(t => t.amount < 0 && kindOf(t.cat) !== 'neutral');
  // 1) giao dịch lớn hơn hẳn thường lệ của cùng mục
  const byCat = {};
  for (const t of outs) (byCat[t.cat] = byCat[t.cat] || []).push(t);
  for (const t of outs) {
    if (monthOf(t.date) !== ym) continue;
    const hist = byCat[t.cat].filter(o => o.id !== t.id && o.date < t.date && o.date >= shiftMonth(ym, -6));
    if (hist.length < 4) continue;
    const med = median(hist.map(o => -o.amount));
    const ratio = -t.amount / med;
    if (med > 0 && ratio >= 3) res.push({ type: 'big', tx: t, ratio: Math.round(ratio) });
  }
  // 2) mục tăng vọt so với trung bình 3 tháng trước
  const monthCat = {};
  for (const t of outs) { const k = monthOf(t.date) + '|' + t.cat; monthCat[k] = (monthCat[k] || 0) - t.amount; }
  const monthTotal = outs.filter(t => monthOf(t.date) === ym).reduce((s, t) => s - t.amount, 0);
  for (const cat of Object.keys(byCat)) {
    const cur = monthCat[ym + '|' + cat] || 0;
    const prev = [1, 2, 3].map(i => monthCat[shiftMonth(ym, -i) + '|' + cat] || 0);
    if (prev.filter(v => v > 0).length < 2) continue;
    const avg = prev.reduce((a, b) => a + b, 0) / 3;
    if (avg > 0 && cur > avg * 1.6 && cur - avg > monthTotal * 0.05) res.push({ type: 'spike', cat, cur, avg, pct: cur / avg - 1 });
  }
  // 3) có thể bị trừ hai lần
  const monthOuts = outs.filter(t => monthOf(t.date) === ym).sort((a, b) => a.date.localeCompare(b.date));
  const seen = new Set();
  for (let i = 0; i < monthOuts.length; i++) {
    for (let j = i + 1; j < monthOuts.length; j++) {
      const a = monthOuts[i], b = monthOuts[j];
      if (daysBetween(a.date, b.date) > 2) break;
      if (a.amount === b.amount && merchantKey(a.desc) && merchantKey(a.desc) === merchantKey(b.desc) && !seen.has(a.id)) {
        if (/grab|be |xanh sm|gojek|taxi|xe|parking|gui xe/i.test(a.desc)) continue; // đi xe 2 lần/ngày là bình thường
        seen.add(a.id); seen.add(b.id);
        res.push({ type: 'dup', tx: b, other: a });
      }
    }
  }
  return res;
}

// Nhận xét ngắn, trung tính — trả về danh sách {icon, key, params}
export function buildInsights(txs, ym, kindOf, recurring) {
  const [y, m] = ym.split('-').map(Number);
  const today = new Date();
  const isThisMonth = today.getFullYear() === y && today.getMonth() + 1 === m;
  const cur = monthSummary(txs, ym, kindOf);
  // Tháng đang dở: so với cùng kỳ tháng trước (ngày 1 → hôm nay) cho công bằng.
  const prev = monthSummary(txs, shiftMonth(ym, -1), kindOf, isThisMonth ? today.getDate() : 31);
  prev.partial = isThisMonth;
  const list = [];
  if (!cur.count) return { cur, prev, list };
  const hasPrev = prev.out > 0;
  if (hasPrev) {
    const ch = cur.out / prev.out - 1;
    if (Math.abs(ch) < 0.03) list.push({ icon: '🧾', key: 'insTotalSame', p: { a: { money: cur.out } } });
    else list.push({ icon: '🧾', key: ch > 0 ? 'insTotalMore' : 'insTotalLess', p: { a: { money: cur.out }, d: { pct: Math.abs(ch) } } });
  } else list.push({ icon: '🧾', key: 'insTotalFirst', p: { a: { money: cur.out } } });

  if (cur.cats.length && cur.out > 0) list.push({ icon: '🥧', key: 'insTop', p: { c: { cat: cur.cats[0].cat }, p: { pct: cur.cats[0].v / cur.out } } });

  if (hasPrev) {
    const changes = [];
    const cats = new Set([...Object.keys(cur.byCat), ...Object.keys(prev.byCat)]);
    for (const c of cats) {
      const a = cur.byCat[c] || 0, b = prev.byCat[c] || 0;
      if (b <= 0 || a <= 0) continue;
      const diff = a - b;
      if (Math.abs(diff) < Math.max(cur.out, prev.out) * 0.05) continue;
      if (Math.abs(diff / b) < 0.2) continue;
      changes.push({ c, diff, pct: Math.abs(diff / b) });
    }
    changes.sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff));
    const up = changes.find(x => x.diff > 0), down = changes.find(x => x.diff < 0);
    if (up) list.push({ icon: '↗️', key: 'insUp', p: { c: { cat: up.c }, d: { pct: up.pct } } });
    if (down) list.push({ icon: '↘️', key: 'insDown', p: { c: { cat: down.c }, d: { pct: down.pct } } });
  }
  if (recurring && recurring.length) {
    const tot = recurring.reduce((s, r) => s + r.monthly, 0);
    list.push({ icon: '🔄', key: 'insRecurring', p: { list: { names: recurring.slice(0, 3).map(r => r.desc) }, a: { money: tot } } });
  }
  const days = isThisMonth ? today.getDate() : new Date(y, m, 0).getDate();
  if (cur.out > 0) list.push({ icon: '📅', key: 'insDaily', p: { a: { money: cur.out / days } } });
  if (cur.unsure) list.push({ icon: '🤔', key: 'insUnsure', p: { n: { num: cur.unsure } } });
  return { cur, prev, list };
}
