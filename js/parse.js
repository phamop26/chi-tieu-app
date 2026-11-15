// Đọc sao kê CSV / Excel / PDF thành danh sách giao dịch — chạy hoàn toàn trên máy.

const LIBS = {
  xlsx: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  pdf: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  pdfWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
};
export const LIB_URLS = Object.values(LIBS);

function loadScript(src, globalName) {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true; s.crossOrigin = 'anonymous';
    s.onload = () => resolve(window[globalName]);
    s.onerror = () => reject(new Error('offline / library not available'));
    document.head.appendChild(s);
  });
}

export const loadXLSX = () => loadScript(LIBS.xlsx, 'XLSX');

// ---------- Chuẩn hóa chữ ----------
export function norm(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Che số tài khoản / số thẻ / mã tham chiếu: dãy ≥ 6 chữ số chỉ giữ 4 số cuối.
export function maskSensitive(text) {
  let s = String(text ?? '');
  // số thẻ dạng 1234 5678 9012 3456 hoặc 1234-5678-...
  s = s.replace(/\b(?:\d{4}[ -]){2,3}\d{2,4}\b/g, m => '••••' + m.replace(/\D/g, '').slice(-4));
  // IBAN (FR76 3000 ...)
  s = s.replace(/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}\b/g, m => '••••' + m.replace(/\s/g, '').slice(-4));
  // dãy số dài
  s = s.replace(/\d{6,}/g, m => '••••' + m.slice(-4));
  // email
  s = s.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '•••@•••');
  return s.replace(/\s+/g, ' ').trim();
}

// ---------- Số tiền ----------
export function parseAmount(v) {
  if (v === null || v === undefined || v === '') return NaN;
  if (typeof v === 'number') return v;
  let s = String(v).trim();
  if (!s) return NaN;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/-\s*$/.test(s)) { neg = true; s = s.replace(/-\s*$/, ''); }
  if (/^\s*-/.test(s) || /^\s*[^\d+]*-/.test(s)) neg = true;
  s = s.replace(/[\s  ']/g, '').replace(/[^\d.,]/g, '');
  if (!s || !/\d/.test(s)) return NaN;
  const hasDot = s.includes('.'), hasComma = s.includes(',');
  if (hasDot && hasComma) {
    const dec = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
    const thou = dec === '.' ? ',' : '.';
    s = s.split(thou).join('').replace(dec, '.');
  } else if (hasDot || hasComma) {
    const sep = hasDot ? '.' : ',';
    const parts = s.split(sep);
    const thousandsLike = parts.length > 2 || (parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3 && parts[0] !== '0');
    s = thousandsLike ? parts.join('') : parts.join('.');
  }
  const n = parseFloat(s);
  return isNaN(n) ? NaN : (neg ? -n : n);
}


// Ô nhập tiền do người dùng gõ: hiểu "500k", "1.5tr", "2 triệu", "3m" (k = nghìn, tr/triệu/m = triệu)
export function parseMoneyInput(str) {
  const raw = String(str || '').trim().toLowerCase().replace(/\s+/g, '');
  const m = raw.match(/^([\d.,]+)(k|nghin|nghìn|tr|trieu|triệu|m|ty|tỷ)?$/);
  if (!m) return parseAmount(raw);
  const mul = { k: 1e3, nghin: 1e3, 'nghìn': 1e3, tr: 1e6, trieu: 1e6, 'triệu': 1e6, m: 1e6, ty: 1e9, 'tỷ': 1e9 }[m[2]] || 1;
  // "1.5tr" / "1,5tr": dấu là phần thập phân khi có hậu tố
  const num = m[2] && /^\d+[.,]\d{1,2}$/.test(m[1]) ? parseFloat(m[1].replace(',', '.')) : parseAmount(m[1]);
  return isNaN(num) ? NaN : num * mul;
}

// ---------- Ngày ----------
const MONTHS = {
  jan: 1, janv: 1, janvier: 1, january: 1, feb: 2, fev: 2, fevr: 2, fevrier: 2, february: 2,
  mar: 3, mars: 3, march: 3, apr: 4, avr: 4, avril: 4, april: 4, may: 5, mai: 5,
  jun: 6, juin: 6, june: 6, jul: 7, juil: 7, juillet: 7, july: 7, aug: 8, aou: 8, aout: 8, august: 8,
  sep: 9, sept: 9, septembre: 9, september: 9, oct: 10, octobre: 10, october: 10,
  nov: 11, novembre: 11, november: 11, dec: 12, decembre: 12, december: 12,
};
const pad = n => String(n).padStart(2, '0');
function ymd(y, m, d) {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

// order: 'dmy' (mặc định VN/FR) hoặc 'mdy'
export function parseDate(v, order = 'dmy') {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date && !isNaN(v)) return ymd(v.getFullYear(), v.getMonth() + 1, v.getDate());
  if (typeof v === 'number') {
    if (v > 20000 && v < 80000) { // số seri ngày của Excel
      const d = new Date(Math.round((v - 25569) * 86400000));
      return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
    return null;
  }
  const s = String(v).trim();
  let m = s.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = s.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    let a = +m[1], b = +m[2];
    const y = +m[3];
    if (order === 'mdy' && b <= 31 && a <= 12) [a, b] = [b, a];
    if (a <= 12 && b > 12) [a, b] = [b, a]; // rõ ràng là tháng/ngày
    return ymd(y, b, a);
  }
  m = norm(s).match(/(\d{1,2}) ([a-z]+) (\d{2,4})/);
  if (m && MONTHS[m[2]]) return ymd(+m[3], MONTHS[m[2]], +m[1]);
  m = norm(s).match(/([a-z]+) (\d{1,2}) (\d{4})/);
  if (m && MONTHS[m[1]]) return ymd(+m[3], MONTHS[m[1]], +m[2]);
  return null;
}

function detectDateOrder(values) {
  let dmy = 0, mdy = 0;
  for (const v of values) {
    if (typeof v !== 'string') continue;
    const m = v.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
    if (!m) continue;
    if (+m[1] > 12) dmy++;
    if (+m[2] > 12) mdy++;
  }
  return mdy > dmy ? 'mdy' : 'dmy';
}

// ---------- CSV ----------
export function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const firstLines = text.split(/\r?\n/).slice(0, 20).join('\n');
  const cands = [',', ';', '\t', '|'];
  const delim = cands.map(d => [d, (firstLines.match(new RegExp(d === '|' ? '\\|' : d, 'g')) || []).length])
    .sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim() !== ''));
}

async function decodeText(buf) {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  if (!utf8.includes('�')) return utf8;
  try { return new TextDecoder('windows-1258').decode(buf); } catch (e) { return utf8; }
}

// ---------- Nhận diện cột ----------
const ROLE_KEYS = {
  date: ['ngay giao dich', 'ngay gd', 'transaction date', 'date operation', 'date de l operation', 'posting date', 'booking date', 'ngay', 'date', 'thoi gian giao dich', 'thoi gian', 'ngay hach toan', 'value date', 'date valeur'],
  desc: ['noi dung giao dich', 'noi dung', 'dien giai', 'mo ta giao dich', 'mo ta', 'chi tiet giao dich', 'chi tiet', 'description', 'transaction details', 'details', 'narrative', 'libelle', 'libelle operation', 'remark', 'memo', 'particulars', 'giao dich'],
  balance: ['so du cuoi', 'so du', 'balance', 'solde', 'running balance'],
  debit: ['so tien ghi no', 'ghi no', 'phat sinh no', 'tien ra', 'so tien chi', 'debit amount', 'debit', 'withdrawal', 'withdrawals', 'money out', 'paid out', 'debit eur', 'sortie', '=no', '=chi', '=rut'],
  credit: ['so tien ghi co', 'ghi co', 'phat sinh co', 'tien vao', 'so tien thu', 'credit amount', 'credit', 'deposit', 'deposits', 'money in', 'paid in', 'entree', '=co', '=thu'],
  amount: ['so tien giao dich', 'so tien', 'amount', 'montant', 'transaction amount', 'gia tri', 'value'],
  type: ['loai giao dich', 'no co', 'd c', 'dr cr', 'sens', '=type', '=loai'],
};
const ROLE_ORDER = ['date', 'desc', 'balance', 'debit', 'credit', 'amount', 'type'];

function headerMatch(cell, key) {
  const h = norm(cell);
  if (!h) return false;
  if (key.startsWith('=')) return h === key.slice(1);
  return h === key || (' ' + h + ' ').includes(' ' + key + ' ');
}

export function detectColumns(rows) {
  let best = null;
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const row = rows[r];
    const map = {}; const used = new Set();
    for (const role of ROLE_ORDER) {
      for (const key of ROLE_KEYS[role]) {
        const idx = row.findIndex((c, i) => !used.has(i) && headerMatch(c, key));
        if (idx >= 0) { map[role] = idx; used.add(idx); break; }
      }
    }
    const score = Object.keys(map).length;
    const ok = map.date !== undefined && (map.amount !== undefined || map.debit !== undefined || map.credit !== undefined);
    if (ok && (!best || score > best.score)) best = { headerRow: r, map, score };
  }
  return best;
}

export function rowsToTransactions(rows, headerRow, map) {
  const body = rows.slice(headerRow + 1);
  const order = detectDateOrder(body.map(r => r[map.date]));
  const out = [];
  for (const r of body) {
    const date = parseDate(r[map.date], order);
    if (!date) continue;
    let amount;
    let hasSign = true;
    if (map.debit !== undefined || map.credit !== undefined) {
      const d = map.debit !== undefined ? Math.abs(parseAmount(r[map.debit]) || 0) : 0;
      const c = map.credit !== undefined ? Math.abs(parseAmount(r[map.credit]) || 0) : 0;
      amount = c - d;
    } else {
      amount = parseAmount(r[map.amount]);
      if (map.type !== undefined) {
        const ty = norm(r[map.type]);
        if (/^(d|dr|no|debit|chi|rut|withdrawal|debit card)$/.test(ty) || /\b(debit|ghi no|chi)\b/.test(ty)) amount = -Math.abs(amount);
        else if (ty) amount = Math.abs(amount);
      } else if (amount > 0) hasSign = false;
    }
    if (!amount || isNaN(amount)) continue;
    let desc = map.desc !== undefined ? String(r[map.desc] ?? '') : '';
    if (!desc.trim()) {
      desc = r.filter((c, i) => !Object.values(map).includes(i) && typeof c === 'string' && /[a-zA-Z]/.test(c)).join(' ');
    }
    const balance = map.balance !== undefined ? parseAmount(r[map.balance]) : NaN;
    out.push({ date, amount, desc, balance, hasSign });
  }
  return fixSigns(out);
}

// Khi file chỉ có số dương: suy ra chiều tiền từ biến động số dư, nếu không có thì coi là chi.
function fixSigns(list) {
  if (!list.length || list.some(x => x.hasSign)) return list.map(clean);
  const withBal = list.filter(x => !isNaN(x.balance)).length;
  if (withBal >= list.length * 0.8 && list.length > 1) {
    const asc = list[0].date <= list[list.length - 1].date;
    for (let i = 0; i < list.length; i++) {
      const prev = asc ? list[i - 1] : list[i + 1];
      const cur = list[i];
      if (prev && !isNaN(prev.balance)) {
        const diff = cur.balance - prev.balance;
        if (Math.abs(Math.abs(diff) - Math.abs(cur.amount)) < 1) cur.amount = Math.sign(diff) * Math.abs(cur.amount);
        else cur.amount = -Math.abs(cur.amount);
      } else {
        cur.amount = /\b(luong|salary|nhan tien|received|credit|hoan tien|refund|virement recu)\b/.test(norm(cur.desc)) ? Math.abs(cur.amount) : -Math.abs(cur.amount);
      }
    }
  } else {
    for (const x of list) {
      x.amount = /\b(luong|salary|nhan tien|nhan ck|received|hoan tien|refund|lai|interest|virement recu)\b/.test(norm(x.desc)) ? Math.abs(x.amount) : -Math.abs(x.amount);
    }
  }
  return list.map(clean);
}
const clean = x => ({ date: x.date, amount: Math.round(x.amount * 100) / 100, desc: x.desc });

// ---------- PDF ----------
const MONEY_RE = /[-+]?\(?\d{1,3}(?:[.,   ]\d{3})+(?:[.,]\d{1,2})?\)?(?:\s?(?:vnd|đ|d|eur|€|usd|\$))?|[-+]?\d+[.,]\d{2}\b/gi;
const DATE_RE = /\b(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{4}-\d{2}-\d{2})\b/;

async function pdfToLines(buf) {
  const pdfjs = await loadScript(LIBS.pdf, 'pdfjsLib');
  pdfjs.GlobalWorkerOptions.workerSrc = LIBS.pdfWorker;
  const doc = await pdfjs.getDocument({ data: buf, isEvalSupported: false }).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const rows = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const x = it.transform[4], y = it.transform[5];
      let row = rows.find(r => Math.abs(r.y - y) < 3);
      if (!row) { row = { y, items: [] }; rows.push(row); }
      row.items.push({ x, s: it.str });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const r of rows) lines.push(r.items.sort((a, b) => a.x - b.x).map(i => i.s).join('  ').replace(/\s{3,}/g, '  '));
  }
  return lines;
}

export function linesToTransactions(lines) {
  const order = detectDateOrder(lines.map(l => (l.match(DATE_RE) || [])[0]).filter(Boolean));
  const items = [];
  let last = null;
  for (const raw of lines) {
    const line = raw.trim();
    const dm = line.match(DATE_RE);
    const date = dm ? parseDate(dm[1], order) : null;
    if (date && dm.index < 25) {
      let rest = line.slice(dm.index + dm[0].length);
      rest = rest.replace(new RegExp('^\\s*' + DATE_RE.source), ''); // ngày hiệu lực thứ hai
      const nums = [...rest.matchAll(MONEY_RE)];
      if (!nums.length) { last = null; continue; }
      const values = nums.map(n => ({ v: parseAmount(n[0].replace(/[a-z€$đ]/gi, '')), raw: n[0], idx: n.index }));
      const firstIdx = values[0].idx;
      const desc = rest.slice(0, firstIdx).trim();
      let amount = values[0].v, balance = NaN, hasSign = /^[-+(]/.test(values[0].raw.trim());
      if (values.length >= 2) balance = values[values.length - 1].v;
      if (values.length >= 3) { // nợ | có | số dư
        const d = values[0].v, c = values[1].v;
        amount = (c && !d) ? Math.abs(c) : -Math.abs(d || c); hasSign = true;
      }
      last = { date, amount, desc, balance, hasSign, plus: values.length < 3 && /^\+/.test(values[0].raw.trim()) };
      items.push(last);
    } else if (last && line && !DATE_RE.test(line) && line.length < 120 && !/^(trang|page|tong|total|so du|balance|solde)/i.test(norm(line))) {
      last.desc = (last.desc + ' ' + line).trim();
    } else {
      last = null;
    }
  }
  const filtered = items.filter(x => x.amount && !isNaN(x.amount));
  // Nếu sao kê ghi dấu "-" cho tiền ra thì số không dấu là tiền vào (và ngược lại với dấu "+").
  if (filtered.some(x => x.amount < 0)) filtered.forEach(x => { x.hasSign = true; });
  else if (filtered.some(x => x.plus)) filtered.forEach(x => { if (!x.plus && !x.hasSign) x.amount = -Math.abs(x.amount); x.hasSign = true; });
  return fixSigns(filtered);
}

// ---------- Điểm vào ----------
// Trả về { ok: true, txs } hoặc { needsMapping: true, rows }
export async function readStatement(file) {
  const name = (file.name || '').toLowerCase();
  const type = file.type || '';
  const buf = await file.arrayBuffer();
  let rows;
  if (name.endsWith('.pdf') || type === 'application/pdf') {
    const lines = await pdfToLines(buf);
    return { ok: true, txs: linesToTransactions(lines) };
  }
  if (/\.(xlsx|xls|xlsm|ods)$/.test(name) || /sheet|excel/.test(type)) {
    const XLSX = await loadScript(LIBS.xlsx, 'XLSX');
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    rows = [];
    for (const sn of wb.SheetNames) {
      const r = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: '' });
      if (r.length > rows.length) rows = r;
    }
  } else {
    rows = parseCSV(await decodeText(buf));
  }
  rows = rows.map(r => r.map(c => (typeof c === 'string' ? c.trim() : c)));
  const det = detectColumns(rows);
  if (det) {
    const txs = rowsToTransactions(rows, det.headerRow, det.map);
    if (txs.length) return { ok: true, txs };
  }
  return { needsMapping: true, rows };
}
