// Đọc số tiền / ngày / nội dung từ ảnh (hóa đơn, ảnh chụp màn hình chuyển khoản).
// Chạy hoàn toàn trên máy bằng Tesseract (WebAssembly). Ảnh không được lưu hay gửi đi.
import { parseAmount, parseDate, norm, maskSensitive } from './parse.js';

const V = '5.1.1';
const TESS = {
  script: `https://cdn.jsdelivr.net/npm/tesseract.js@${V}/dist/tesseract.min.js`,
  workerPath: `https://cdn.jsdelivr.net/npm/tesseract.js@${V}/dist/worker.min.js`,
  corePath: `https://cdn.jsdelivr.net/npm/tesseract.js-core@${V}`,
  langPath: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/vie@1.0.0/4.0.0_best_int',
};

function loadScript(src) {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true; s.crossOrigin = 'anonymous';
    s.onload = () => resolve(window.Tesseract);
    s.onerror = () => reject(new Error('offline'));
    document.head.appendChild(s);
  });
}

// Thu nhỏ ảnh lớn (ảnh camera 12MP) để đọc nhanh hơn
async function shrink(file, max = 2000) {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (k === 1) return file;
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise(res => c.toBlob(b => res(b || file), 'image/jpeg', 0.9));
  } catch (e) { return file; }
}

let workerPromise = null;
async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const T = await loadScript(TESS.script);
      return T.createWorker('vie', 1, { workerPath: TESS.workerPath, corePath: TESS.corePath, langPath: TESS.langPath, workerBlobURL: true });
    })().catch(e => { workerPromise = null; throw e; });
  }
  return workerPromise;
}

export async function readImage(file) {
  const worker = await getWorker();
  const img = await shrink(file);
  const { data } = await worker.recognize(img);
  return extract(data.text || '');
}

const MONEY = /[-+]?\d{1,3}(?:[.,\s]\d{3})+(?:[.,]\d{1,2})?|[-+]?\d{4,9}(?:[.,]\d{1,2})?/g;
const AMOUNT_WORDS = /(tong cong|tong tien|tong thanh toan|thanh tien|can thanh toan|so tien|amount|total|tong|thanh toan|da thanh toan|grand total|montant|a payer)/;
const DESC_WORDS = /^(noi dung( chuyen khoan)?|loi nhan|dien giai|description|message|memo|remark|libelle)\b/;
const TO_WORDS = /^(nguoi nhan|ten nguoi nhan|den|toi|to|beneficiary|recipient|merchant|cua hang|ten don vi)\b/;

// Rút số tiền, ngày, nội dung từ chữ đọc được
export function extract(text) {
  const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
  let best = null;
  lines.forEach((line, i) => {
    const n = norm(line);
    if (/\d{1,2}[:h]\d{2}/.test(line) && !/(vnd|đ|₫)/i.test(line) && !AMOUNT_WORDS.test(n)) return; // dòng giờ
    for (const m of line.matchAll(MONEY)) {
      const raw = m[0];
      const digits = raw.replace(/\D/g, '');
      if (/[-/]\d{1,2}[-/]/.test(line.slice(Math.max(0, m.index - 3), m.index + raw.length + 3)) && !/(vnd|đ|₫)/i.test(line)) continue; // ngày tháng
      if (digits.length >= 10 && !/[.,\s]/.test(raw)) continue; // số tài khoản / mã giao dịch
      const v = Math.abs(parseAmount(raw));
      if (!v || v < 1000 && !/[.,]\d{2}$/.test(raw)) continue;
      let score = 0;
      if (AMOUNT_WORDS.test(n) || (i > 0 && AMOUNT_WORDS.test(norm(lines[i - 1])))) score += 4;
      if (/(vnd|đ|₫|\bd\b|eur|€|usd|\$)/i.test(line)) score += 3;
      if (/[.,\s]\d{3}/.test(raw)) score += 1;
      if (/^[-+]/.test(raw.trim())) score += 1;
      if (!best || score > best.score || (score === best.score && v > best.v)) best = { v, score, raw, line: n };
    }
  });

  let date = null;
  for (const l of lines) { const d = parseDate(l); if (d) { date = d; break; } }

  let desc = '';
  for (let i = 0; i < lines.length && !desc; i++) {
    const n = norm(lines[i]);
    if (DESC_WORDS.test(n)) {
      const after = lines[i].split(/[:：]/).slice(1).join(':').trim();
      desc = after || lines[i + 1] || '';
    }
  }
  if (!desc) for (let i = 0; i < lines.length && !desc; i++) {
    if (TO_WORDS.test(norm(lines[i]))) { const after = lines[i].split(/[:：]/).slice(1).join(':').trim(); desc = after || lines[i + 1] || ''; }
  }
  if (!desc) desc = lines.find(l => /[a-zA-ZÀ-ỹ]{3,}/.test(l) && !/\d{3}/.test(l) && !/(thanh cong|successful|giao dich|transaction|hoa don|receipt|invoice)/i.test(norm(l))) || '';

  const all = norm(text);
  const incoming = /(nhan tien|da nhan|tien vao|received|credited|\+\s?\d)/.test(all) && !/(chuyen tien thanh cong|da chuyen|transfer successful)/.test(all);
  return {
    amount: best ? best.v : null,
    date,
    desc: maskSensitive(desc).slice(0, 80),
    incoming,
  };
}
