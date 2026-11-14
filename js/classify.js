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
];

// Từ khóa đã bỏ dấu, chữ thường. Từ khóa dài hơn được ưu tiên (vd "grabfood" thắng "grab").
const KEYWORDS = {
  food: ['grabfood', 'grab food', 'shopeefood', 'shopee food', 'baemin', 'gofood', 'befood', 'be food', 'highlands', 'highland coffee', 'phuc long', 'starbucks', 'the coffee house', 'katinat', 'cong caphe', 'trung nguyen', 'cafe', 'coffee', 'ca phe', 'tra sua', 'gong cha', 'koi the', 'kfc', 'lotteria', 'jollibee', 'mcdonald', 'mcdonalds', 'pizza', 'dominos', 'texas chicken', 'popeyes', 'pho', 'bun bo', 'com tam', 'banh mi', 'nha hang', 'restaurant', 'quan an', 'an trua', 'an toi', 'an sang', 'bakery', 'tous les jours', 'paris baguette', 'bach hoa xanh', 'winmart', 'coopmart', 'co op', 'coop food', 'vinmart', 'lotte mart', 'aeon', 'emart', 'big c', 'go mart', 'circle k', 'familymart', 'gs25', 'ministop', '7 eleven', '7eleven', 'kichi', 'haidilao', 'gogi', 'sushi', 'bbq', 'lau', 'dimsum', 'boulangerie', 'carrefour', 'monoprix', 'franprix', 'leclerc', 'auchan', 'lidl', 'intermarche', 'supermarche', 'epicerie', 'brasserie', 'uber eats', 'deliveroo', 'grocery', 'supermarket'],
  transport: ['grab', 'grabcar', 'grabbike', 'be group', 'xanh sm', 'gsm', 'gojek', 'taxi', 'mai linh', 'vinasun', 'uber', 'petrolimex', 'xang dau', 'do xang', 'pvoil', 'cua hang xang', 'vetc', 'epass', 'thu phi', 'gui xe', 'parking', 'vexere', 'futa', 'phuong trang', 'metro', 'xe buyt', 'sncf', 'ratp', 'navigo', 'essence', 'total energies', 'peage', 'bolt', 'lyft'],
  shopping: ['shopee', 'lazada', 'tiki', 'tiktok shop', 'sendo', 'amazon', 'uniqlo', 'zara', 'h m', 'the gioi di dong', 'tgdd', 'dien may xanh', 'fpt shop', 'cellphones', 'hoang ha mobile', 'nguyen kim', 'ikea', 'decathlon', 'muji', 'miniso', 'daiso', 'canifa', 'routine', 'yody', 'aliexpress', 'temu', 'fnac', 'darty', 'mua sam', 'shop', 'store'],
  bills: ['evn', 'dien luc', 'tien dien', 'sawaco', 'cap nuoc', 'tien nuoc', 'nuoc sach', 'vnpt', 'viettel', 'mobifone', 'vinaphone', 'fpt telecom', 'internet', 'cuoc di dong', 'nap tien dien thoai', 'hoa don', 'thanh toan hoa don', 'truyen hinh', 'vtvcab', 'k plus', 'phi quan ly', 'chung cu', 'edf', 'engie', 'orange', 'free mobile', 'sfr', 'bouygues', 'facture', 'electricity', 'water bill', 'utility'],
  fun: ['netflix', 'spotify', 'youtube premium', 'youtube', 'apple music', 'cgv', 'galaxy cinema', 'lotte cinema', 'bhd', 'beta cinemas', 'cinestar', 'steam', 'playstation', 'nintendo', 'garena', 'ticketbox', 'karaoke', 'disney', 'fpt play', 'vieon', 'cinema', 'concert', 'game', 'xbox', 'canal plus', 'deezer'],
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
  self: ['chuyen tien noi bo', 'tu tai khoan cua toi', 'own account', 'between accounts', 'virement interne', 'tat toan'],
  transfer: ['chuyen tien', 'chuyen khoan', 'ck', 'transfer', 'ibft', 'napas', 'virement', 'qr', 'momo', 'zalopay', 'vnpay', 'paypal'],
};

// Từ không mang ý nghĩa nhận diện (để rút "khóa" của người nhận/cửa hàng)
const STOP = new Set('thanh toan tt chuyen tien khoan ck ft ma gd giao dich qr pos tai den tu ref trace so tk tai khoan mbvcb ibft napas vcb tcb acb mb bidv vietinbank vpbank tpbank ct nd noi dung payment pay to from for the de du la visa mastercard master card debit credit vnd ngay luc qua app web online ecom sang via va and of tren mua hang tai cua hang ltd co jsc cty cong ty tnhh vn vietnam hcm hn ho chi minh ha noi sg paris cb carte achat prlv sepa vir inst ecom www com'.split(' '));

export function merchantKey(desc) {
  const toks = norm(desc).split(' ').filter(w => w && !STOP.has(w) && !/\d/.test(w) && w.length > 1);
  return toks.slice(0, 4).join(' ');
}
function tokens(desc) {
  return [...new Set(norm(desc).split(' ').filter(w => w.length > 1 && !STOP.has(w) && !/\d/.test(w)))];
}

export function emptyModel() { return { merchants: {}, tokens: {} }; }

function keywordMatch(text, amount) {
  const padded = ' ' + text + ' ';
  const hits = [];
  for (const [cat, list] of Object.entries(KEYWORDS)) {
    if (cat === 'income' && amount < 0) continue;
    for (const k of list) if (padded.includes(' ' + k + ' ')) hits.push({ cat, len: k.length });
  }
  hits.sort((a, b) => b.len - a.len);
  return hits;
}

function topOf(counts) {
  let best = null, total = 0;
  for (const [c, n] of Object.entries(counts)) { total += n; if (!best || n > best.n) best = { cat: c, n }; }
  return best ? { cat: best.cat, n: best.n, share: best.n / total, total } : null;
}

// Trả về { cat, conf, alts: [catId,...] }
export function classify(tx, model, catExists) {
  const text = norm(tx.desc);
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
    if (best.cat === 'self') conf = 0.6;
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
    const m = (model.merchants[sign + ':' + key] ||= {});
    // lựa chọn mới nhất được ưu tiên: làm mờ phiếu cũ của mục khác
    for (const c of Object.keys(m)) if (c !== cat) m[c] = Math.floor(m[c] / 2);
    m[cat] = (m[cat] || 0) + 1;
  }
  for (const w of tokens(tx.desc)) {
    const c = (model.tokens[sign + ':' + w] ||= {});
    c[cat] = (c[cat] || 0) + 1;
  }
}
export function forgetCategory(model, cat) {
  for (const group of [model.merchants, model.tokens]) for (const k of Object.keys(group)) delete group[k][cat];
}
