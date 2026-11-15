// Phân loại giao dịch: (1) những gì người dùng đã dạy → (2) từ khóa có sẵn → (3) bỏ phiếu theo từ đã học.
// Chạy hoàn toàn trên máy. Giao dịch có độ tin cậy < REVIEW_THRESHOLD vào hàng "cần xem lại".
import { norm } from './parse.js';

export const REVIEW_THRESHOLD = 0.7;

// kind: out = chi, in = thu, neutral = không tính vào chi tiêu. lib = chỉ tạo khi lần đầu gặp giao dịch phù hợp.
export const BUILTIN_CATS = [
  { id: 'food', icon: '🍜', kind: 'out' },
  { id: 'transport', icon: '🛵', kind: 'out' },
  { id: 'shopping', icon: '🛍️', kind: 'out' },
  { id: 'bills', icon: '💡', kind: 'out' },
  { id: 'fun', icon: '🎬', kind: 'out' },
  { id: 'family', icon: '👪', kind: 'out' },
  { id: 'invest', icon: '📈', kind: 'out' },
  { id: 'transfer', icon: '↔️', kind: 'out' },
  { id: 'other', icon: '📦', kind: 'out' },
  { id: 'income', icon: '💰', kind: 'in' },
  { id: 'self', icon: '🔁', kind: 'neutral' },
  { id: 'health', icon: '🩺', kind: 'out', lib: true },
  { id: 'education', icon: '📚', kind: 'out', lib: true },
  { id: 'insurance', icon: '🛡️', kind: 'out', lib: true },
  { id: 'travel', icon: '✈️', kind: 'out', lib: true },
  { id: 'beauty', icon: '💇', kind: 'out', lib: true },
  { id: 'housing', icon: '🏠', kind: 'out', lib: true },
  { id: 'pets', icon: '🐾', kind: 'out', lib: true },
  { id: 'fees', icon: '🏦', kind: 'out', lib: true },
  { id: 'cash', icon: '💵', kind: 'out', lib: true },
  { id: 'gifts', icon: '🎁', kind: 'out', lib: true },
  { id: 'kids', icon: '🧸', kind: 'out', lib: true },
  { id: 'debtpay', icon: '🧾', kind: 'out', lib: true },
  { id: 'wallet', icon: '👛', kind: 'out', lib: true },
  { id: 'subs', icon: '🤖', kind: 'out', lib: true },
];

// Danh mục dịch vụ đăng ký phổ biến (để nhận ra trong sao kê). kind: ai | app | media
export const SUB_SERVICES = [
  { id: 'claude', name: 'Claude', icon: '🧠', kind: 'ai', kw: ['anthropic', 'claude ai', 'claude'] },
  { id: 'deepseek', name: 'DeepSeek', icon: '🐋', kind: 'ai', kw: ['deepseek'] },
  { id: 'suno', name: 'Suno', icon: '🎵', kind: 'ai', kw: ['suno', 'suno ai', 'suno inc'] },
  { id: 'chatgpt', name: 'ChatGPT', icon: '🤖', kind: 'ai', kw: ['openai', 'chatgpt'] },
  { id: 'gemini', name: 'Google One / Gemini', icon: '✨', kind: 'ai', kw: ['gemini', 'google one', 'google storage'] },
  { id: 'midjourney', name: 'Midjourney', icon: '🎨', kind: 'ai', kw: ['midjourney'] },
  { id: 'perplexity', name: 'Perplexity', icon: '🔎', kind: 'ai', kw: ['perplexity'] },
  { id: 'cursor', name: 'Cursor', icon: '⌨️', kind: 'ai', kw: ['cursor', 'anysphere'] },
  { id: 'copilot', name: 'GitHub Copilot', icon: '🐙', kind: 'ai', kw: ['github', 'copilot'] },
  { id: 'grok', name: 'Grok / X', icon: '✖️', kind: 'ai', kw: ['grok', 'x premium', 'x corp'] },
  { id: 'elevenlabs', name: 'ElevenLabs', icon: '🗣️', kind: 'ai', kw: ['elevenlabs'] },
  { id: 'notion', name: 'Notion', icon: '📓', kind: 'app', kw: ['notion'] },
  { id: 'canva', name: 'Canva', icon: '🖌️', kind: 'app', kw: ['canva'] },
  { id: 'capcut', name: 'CapCut', icon: '✂️', kind: 'app', kw: ['capcut'] },
  { id: 'apple', name: 'Apple / iCloud', icon: '☁️', kind: 'app', kw: ['icloud', 'apple com bill', 'itunes'] },
  { id: 'netflix', name: 'Netflix', icon: '🎬', kind: 'media', kw: ['netflix'] },
  { id: 'spotify', name: 'Spotify', icon: '🎧', kind: 'media', kw: ['spotify'] },
  { id: 'youtube', name: 'YouTube Premium', icon: '▶️', kind: 'media', kw: ['youtube premium', 'youtube'] },
];
export function matchService(desc) {
  const padded = ' ' + norm(desc) + ' ';
  let best = null;
  for (const sv of SUB_SERVICES) for (const k of sv.kw) if (padded.includes(' ' + k + ' ') && (!best || k.length > best.len)) best = { sv, len: k.length };
  return best ? best.sv : null;
}

// Từ khóa đã bỏ dấu, chữ thường. Từ khóa dài hơn được ưu tiên (vd "grabfood" thắng "grab").
const KEYWORDS = {
  food: ['tocotoco', 'mixue', 'phe la', 'pizza 4p', 'the pizza company', 'manwah', 'pho 24', 'kingfoodmart', 'satra', 'winmart plus', 'cooky', 'loship', 'bun cha', 'com ga', 'banh cuon', 'quan nhau', 'bia', 'tra chanh', 'an vat', 'di cho', 'grabfood', 'grab food', 'shopeefood', 'shopee food', 'baemin', 'gofood', 'befood', 'be food', 'highlands', 'highland coffee', 'phuc long', 'starbucks', 'the coffee house', 'katinat', 'cong caphe', 'trung nguyen', 'cafe', 'coffee', 'ca phe', 'tra sua', 'gong cha', 'koi the', 'kfc', 'lotteria', 'jollibee', 'mcdonald', 'mcdonalds', 'pizza', 'dominos', 'texas chicken', 'popeyes', 'pho', 'bun bo', 'com tam', 'banh mi', 'nha hang', 'restaurant', 'quan an', 'an trua', 'an toi', 'an sang', 'bakery', 'tous les jours', 'paris baguette', 'bach hoa xanh', 'winmart', 'coopmart', 'co op', 'coop food', 'vinmart', 'lotte mart', 'aeon', 'emart', 'big c', 'go mart', 'circle k', 'familymart', 'gs25', 'ministop', '7 eleven', '7eleven', 'kichi', 'haidilao', 'gogi', 'sushi', 'bbq', 'lau', 'dimsum', 'boulangerie', 'carrefour', 'monoprix', 'franprix', 'leclerc', 'auchan', 'lidl', 'intermarche', 'supermarche', 'epicerie', 'brasserie', 'uber eats', 'deliveroo', 'grocery', 'supermarket'],
  transport: ['bike', 'xe om', 'grabexpress', 'giao hang', 'ahamove', 'lalamove', 'ghtk', 'giao hang tiet kiem', 'viettel post', 'j t express', 'xang', 'rua xe', 'sua xe', 'bao duong', 'grab', 'grabcar', 'grabbike', 'be group', 'xanh sm', 'gsm', 'gojek', 'taxi', 'mai linh', 'vinasun', 'uber', 'petrolimex', 'xang dau', 'do xang', 'pvoil', 'cua hang xang', 'vetc', 'epass', 'thu phi', 'gui xe', 'parking', 'vexere', 'futa', 'phuong trang', 'metro', 'xe buyt', 'sncf', 'ratp', 'navigo', 'essence', 'total energies', 'peage', 'bolt', 'lyft'],
  shopping: ['shopee', 'lazada', 'tiki', 'tiktok shop', 'sendo', 'amazon', 'uniqlo', 'zara', 'h m', 'the gioi di dong', 'tgdd', 'dien may xanh', 'fpt shop', 'cellphones', 'hoang ha mobile', 'nguyen kim', 'ikea', 'decathlon', 'muji', 'miniso', 'daiso', 'canifa', 'routine', 'yody', 'aliexpress', 'temu', 'fnac', 'darty', 'mua sam', 'shop', 'store'],
  bills: ['thue bao', 'goi cuoc', 'data 4g', 'nap the', 'mytv', 'fpt play box', 'tien dien thoai', 'tien mang', 'phi gui xe thang', 'evn', 'dien luc', 'tien dien', 'sawaco', 'cap nuoc', 'tien nuoc', 'nuoc sach', 'vnpt', 'viettel', 'mobifone', 'vinaphone', 'fpt telecom', 'internet', 'cuoc di dong', 'nap tien dien thoai', 'hoa don', 'thanh toan hoa don', 'truyen hinh', 'vtvcab', 'k plus', 'phi quan ly', 'chung cu', 'edf', 'engie', 'orange', 'free mobile', 'sfr', 'bouygues', 'facture', 'electricity', 'water bill', 'utility'],
  fun: ['tinder', 'bumble', 'gym', 'yoga', 'boi loi', 'bida', 'bowling', 've xem phim', 'galaxy play', 'nhaccuatui', 'zing mp3', 'netflix', 'spotify', 'youtube premium', 'youtube', 'apple music', 'cgv', 'galaxy cinema', 'lotte cinema', 'bhd', 'beta cinemas', 'cinestar', 'steam', 'playstation', 'nintendo', 'garena', 'ticketbox', 'karaoke', 'disney', 'fpt play', 'vieon', 'cinema', 'concert', 'game', 'xbox', 'canal plus', 'deezer'],
  family: ['cho me', 'gui me', 'bieu me', 'cho bo', 'gui bo', 'bieu bo', 'cho ba', 'gui ba', 'cho ba me', 'gui ba me', 'bieu ong ba', 'cho ong ba', 'gui gia dinh', 'gia dinh', 'cho con', 'gui con', 'tien tieu vat', 'maman', 'papa', 'famille', 'mom', 'dad', 'cho vo', 'cho chong', 'gui vo', 'gui chong'],
  invest: ['chung khoan', 'ssi', 'vndirect', 'tcbs', 'vps', 'mbs', 'hsc', 'vcbs', 'fmarket', 'dragon capital', 'vinacapital', 'ccq', 'chung chi quy', 'gui tiet kiem', 'tiet kiem', 'tich luy', 'mo so tiet kiem', 'dau tu', 'vang sjc', 'mua vang', 'savings', 'invest', 'investment', 'livret', 'assurance vie', 'boursorama', 'etoro'],
  income: ['luong', 'tra luong', 'salary', 'payroll', 'thuong', 'bonus', 'hoan tien', 'refund', 'cashback', 'lai tien gui', 'tra lai', 'interest', 'salaire', 'remboursement', 'loi tuc', 'co tuc', 'dividend'],
  health: ['benh vien', 'hospital', 'phong kham', 'clinic', 'nha thuoc', 'pharmacity', 'long chau', 'an khang', 'vinmec', 'nha khoa', 'dental', 'medlatec', 'pharmacie', 'medecin', 'doctolib', 'kham benh'],
  education: ['hoc phi', 'tuition', 'truong hoc', 'dai hoc', 'university', 'udemy', 'coursera', 'ielts', 'khoa hoc', 'fahasa', 'nha sach', 'sach', 'kindle', 'ecole', 'formation', 'school'],
  insurance: ['bao hiem', 'prudential', 'manulife', 'aia', 'dai ichi', 'bao viet', 'pvi', 'fwd', 'generali', 'insurance', 'assurance', 'mutuelle', 'bhyt', 'bhxh'],
  travel: ['vietnam airlines', 'vietjet', 'bamboo airways', 'agoda', 'booking com', 'traveloka', 'airbnb', 'klook', 'hotel', 'khach san', 'resort', 'homestay', 'air france', 'expedia', 'trip com'],
  beauty: ['spa', 'salon', 'cat toc', 'lam toc', 'nail', 'barber', 'hasaki', 'watsons', 'guardian', 'sephora', 'coiffeur', 'the face shop', 'innisfree'],
  housing: ['tien nha', 'thue nha', 'tien phong', 'tien thue', 'rent', 'loyer', 'sua nha'],
  pets: ['thu y', 'pet', 'petmart', 'pet mart', 'thuc an cho', 'thuc an meo', 'veterinaire'],
  fees: ['phi thuong nien', 'phi sms', 'sms banking', 'phi dich vu', 'phi chuyen tien', 'phi quan ly tai khoan', 'phi duy tri', 'annual fee', 'service fee', 'frais', 'commission', 'cotisation carte'],
  cash: ['rut tien mat', 'rut tien', 'atm', 'cash withdrawal', 'withdrawal', 'retrait', 'dab'],
  gifts: ['tu thien', 'quyen gop', 'ung ho', 'donation', 'mung cuoi', 'dam cuoi', 'tien mung', 'qua tang', 'gift', 'li xi', 'mung tho'],
  kids: ['bim', 'sua bot', 'kids', 'tre em', 'do choi', 'mam non', 'concung', 'con cung', 'bibo mart', 'kids plaza'],
  debtpay: ['spaylater', 'shopee paylater', 'spay later', 'tra gop', 'home credit', 'fe credit', 'kredivo', 'fundiin', 'tra no vay', 'tra no khoan vay', 'mcredit', 'loan repayment', 'echeance pret'],
  self: ['chuyen tien noi bo', 'tu tai khoan cua toi', 'own account', 'between accounts', 'virement interne', 'tat toan', 'thanh toan the tin dung', 'tt the tin dung', 'thanh toan du no the', 'tra no the tin dung', 'tra the tin dung', 'credit card payment', 'card payment received', 'payment received', 'payment thank you', 'remboursement carte'],
  wallet: ['nap tien vi', 'nap vi', 'nap tien momo', 'nap momo', 'nap tien zalopay', 'nap zalopay', 'nap shopeepay', 'nap tien shopeepay', 'nap tien vnpay', 'top up', 'topup', 'nap tien dien tu'],
  subs: ['anthropic', 'claude ai', 'claude', 'deepseek', 'suno', 'suno ai', 'openai', 'chatgpt', 'gemini', 'google one', 'google storage', 'midjourney', 'perplexity', 'cursor', 'anysphere', 'github', 'copilot', 'grok', 'elevenlabs', 'notion', 'canva', 'capcut', 'icloud', 'apple com bill', 'itunes'],
  transfer: ['chuyen tien', 'chuyen khoan', 'ck', 'transfer', 'ibft', 'napas', 'virement', 'qr', 'momo', 'zalopay', 'vnpay', 'paypal'],
};

// Từ không mang ý nghĩa nhận diện (để rút "khóa" của người nhận/cửa hàng)
const STOP = new Set('thanh toan tt chuyen tien khoan ck ft ma gd giao dich qr pos tai den tu ref trace so tk tai khoan mbvcb ibft napas vcb tcb acb mb bidv vietinbank vpbank tpbank ct nd noi dung payment pay to from for the de du la visa mastercard master card debit credit vnd ngay luc qua app web online ecom sang via va and of tren mua hang tai cua hang ltd co jsc cty cong ty tnhh vn vietnam hcm hn ho chi minh ha noi sg paris cb carte achat prlv sepa vir inst ecom www com'.split(' '));

// Từ xuất hiện ở quá nhiều giao dịch (thường là tên chủ tài khoản, tên ngân hàng) → bỏ qua khi nhận diện.
// Nếu không, mọi khoản chuyển tiền có tên của chính bạn sẽ bị coi là "cùng một người nhận".
let dynStop = new Set();
export function setCorpus(descs) {
  dynStop = new Set();
  if (descs.length < 20) return;
  const df = new Map();
  for (const d of descs) for (const w of new Set(norm(d).split(' '))) if (w.length > 1 && !/\d/.test(w)) df.set(w, (df.get(w) || 0) + 1);
  const kw = new Set(Object.values(KEYWORDS).flat().flatMap(k => k.split(' ')));
  for (const [w, n] of df) if (n / descs.length > 0.25 && !kw.has(w)) dynStop.add(w); // giữ lại từ là tên cửa hàng/dịch vụ
}
const isStop = w => STOP.has(w) || dynStop.has(w);

// Làm sạch nội dung theo định dạng sao kê ngân hàng VN: bỏ mã tham chiếu, phần "CT tu ... toi ... tai ..."
export function cleanText(desc) {
  let s = ' ' + norm(desc) + ' ';
  s = s.replace(/ (mbvcb|ibft|ft|tt|pos|ref|trace|ma gd|so gd) \d+/g, ' ');
  s = s.replace(/ ct tu .*$/, ' ').replace(/ tu tk .*$/, ' ').replace(/ trace .*$/, ' ');
  return s.replace(/\s+/g, ' ').trim();
}
// Tên người nhận trong khoản chuyển tiền (nếu có)
function recipient(desc) {
  const n = ' ' + norm(desc) + ' ';
  const m = n.match(/ toi (?:\d+ )?([a-z]+(?: [a-z]+){1,4}) tai /) || n.match(/ (?:ck|chuyen tien|chuyen khoan) (?:den|cho|toi) ([a-z]+(?: [a-z]+){1,4})/);
  if (!m) return '';
  const name = m[1].split(' ').filter(w => !isStop(w)).slice(0, 4).join(' ');
  return name.split(' ').length >= 2 ? name : '';
}

export function merchantKey(desc) {
  const r = recipient(desc);
  if (r) return 'to ' + r;
  const toks = cleanText(desc).split(' ').filter(w => w && !isStop(w) && !/\d/.test(w) && w.length > 1);
  return toks.slice(0, 4).join(' ');
}
function tokens(desc) {
  return [...new Set(cleanText(desc).split(' ').filter(w => w.length > 1 && !isStop(w) && !/\d/.test(w)))];
}

export function emptyModel() { return { merchants: {}, tokens: {} }; }

function keywordMatch(text, amount) {
  const padded = ' ' + text + ' ';
  const hits = [];
  for (const [cat, list] of Object.entries(KEYWORDS)) {
    if (cat === 'income' && amount < 0) continue;
    for (const k of list) if (padded.includes(' ' + k + ' ')) hits.push({ cat, len: k.length });
  }
  // "chuyển tiền / chuyển khoản" chỉ là từ chung → luôn xếp sau từ khóa cụ thể (vd "cho me")
  hits.sort((a, b) => (a.cat === 'transfer') - (b.cat === 'transfer') || b.len - a.len);
  return hits;
}

function topOf(counts) {
  let best = null, total = 0;
  for (const [c, n] of Object.entries(counts)) { total += n; if (!best || n > best.n) best = { cat: c, n }; }
  return best ? { cat: best.cat, n: best.n, share: best.n / total, total } : null;
}

// Trả về { cat, conf, alts: [catId,...] }
export function classify(tx, model, catExists) {
  const text = cleanText(tx.desc);
  const key = merchantKey(tx.desc);
  const alts = [];
  const sign = tx.amount < 0 ? 'out' : 'in';

  // 1) người dùng đã dạy chính người nhận/cửa hàng này
  const m = key && model.merchants[sign + ':' + key];
  if (m) {
    const top = topOf(m);
    if (top && catExists(top.cat)) {
      const conf = top.share >= 0.8 ? Math.min(0.97, 0.8 + 0.06 * top.n) : 0.55;
      return { cat: top.cat, conf, alts: Object.keys(m).filter(c => c !== top.cat) };
    }
  }

  // 2) từ khóa
  const hits = keywordMatch(text, tx.amount);
  // 3) bỏ phiếu theo từ đã học
  const votes = {};
  for (const w of tokens(tx.desc)) {
    const c = model.tokens[sign + ':' + w];
    if (!c) continue;
    const top = topOf(c);
    if (top.total >= 2) votes[top.cat] = (votes[top.cat] || 0) + top.share * Math.min(1, top.total / 4);
  }
  const vote = topOf(votes);

  if (sign === 'in') {
    const h = hits.find(h => h.cat === 'income' || h.cat === 'self' || h.cat === 'invest' || h.cat === 'family');
    if (vote && vote.share > 0.7 && vote.n >= 0.8) return { cat: vote.cat, conf: 0.8, alts: ['income', 'self'] };
    if (h) return { cat: h.cat, conf: h.cat === 'income' ? 0.85 : 0.75, alts: ['income', 'self'] };
    return { cat: 'income', conf: 0.72, alts: ['self', 'family', 'other'] };
  }

  const outHits = hits.filter(h => h.cat !== 'income');
  if (outHits.length) {
    const best = outHits[0];
    const others = [...new Set(outHits.map(h => h.cat))].filter(c => c !== best.cat);
    alts.push(...others);
    let conf;
    if (best.cat === 'transfer') conf = 0.4;            // chuyển cho ai? → hỏi người dùng
    else if (!others.length || (others.length === 1 && others[0] === 'transfer')) conf = 0.82;
    else conf = outHits[1].len < best.len - 2 ? 0.72 : 0.55;
    if (best.cat === 'self') conf = best.len >= 12 ? 0.85 : 0.6; // cụm dài (vd "thanh toan the tin dung") là chắc chắn
    if (vote && vote.cat === best.cat) conf = Math.min(0.95, conf + 0.12);
    else if (vote && vote.share > 0.75 && vote.n >= 1) return { cat: vote.cat, conf: 0.75, alts: [best.cat, ...alts] };
    return { cat: best.cat, conf, alts };
  }
  if (vote) {
    const conf = vote.share > 0.75 && vote.n >= 1 ? 0.75 : 0.5;
    return { cat: vote.cat, conf, alts: Object.keys(votes).filter(c => c !== vote.cat) };
  }
  return { cat: 'other', conf: 0.2, alts: ['transfer', 'shopping', 'food'] };
}

// Tên ngắn dễ đọc cho một giao dịch (vd "Netflix", "EVN", "Tran Thi Mai").
export function shortLabel(desc) {
  const hits = keywordMatch(norm(desc), -1).filter(h => h.cat !== 'transfer');
  let s = '';
  if (hits.length) {
    const padded = ' ' + norm(desc) + ' ';
    s = KEYWORDS[hits[0].cat].filter(k => padded.includes(' ' + k + ' ')).sort((a, b) => b.length - a.length)[0];
  }
  if (!s) s = merchantKey(desc).split(' ').slice(0, 3).join(' ');
  if (!s) return String(desc).slice(0, 24);
  return s.length <= 4 && !s.includes(' ') ? s.toUpperCase() : s.replace(/\b\w/g, c => c.toUpperCase());
}

// Ghi nhớ lựa chọn của người dùng.
export function learn(model, tx, cat) {
  const sign = tx.amount < 0 ? 'out' : 'in';
  const key = merchantKey(tx.desc);
  if (key) {
    const mk = sign + ':' + key; if (!model.merchants[mk]) model.merchants[mk] = {}; const m = model.merchants[mk];
    // lựa chọn mới nhất được ưu tiên: làm mờ phiếu cũ của mục khác
    for (const c of Object.keys(m)) if (c !== cat) m[c] = Math.floor(m[c] / 2);
    m[cat] = (m[cat] || 0) + 1;
  }
  for (const w of tokens(tx.desc)) {
    const tk = sign + ':' + w; if (!model.tokens[tk]) model.tokens[tk] = {}; const c = model.tokens[tk];
    c[cat] = (c[cat] || 0) + 1;
  }
}
export function forgetCategory(model, cat) {
  for (const group of [model.merchants, model.tokens]) for (const k of Object.keys(group)) delete group[k][cat];
}
