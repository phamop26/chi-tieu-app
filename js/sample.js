// Tạo sao kê mẫu (dữ liệu giả) theo định dạng ngân hàng Việt Nam — để thử app mà không cần dữ liệu thật.
export function sampleCSV() {
  let seed = 42;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const between = (a, b) => Math.round((a + rnd() * (b - a)) / 1000) * 1000;
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  const now = new Date();
  const rows = [];
  const add = (y, m, d, amount, desc) => {
    const dt = new Date(y, m - 1, d);
    if (dt > now) return;
    rows.push({ dt, amount, desc });
  };
  for (let back = 5; back >= 0; back--) {
    const base = new Date(now.getFullYear(), now.getMonth() - back, 1);
    const y = base.getFullYear(), m = base.getMonth() + 1;
    const mm = String(m).padStart(2, '0');
    add(y, m, 1, -6500000, `CK tien nha thang ${mm} cho NGUYEN VAN HUNG`);
    add(y, m, 5, 25000000, `CTY TNHH ABC TRA LUONG T${mm}/${y} FT${y}${mm}05123456`);
    add(y, m, 6, -3000000, `CK cho me thang ${mm}`);
    add(y, m, 7, -5000000, 'MO SO TIET KIEM ONLINE 0021000123456');
    add(y, m, 9, -59000, 'SPOTIFY P2B4C8 STOCKHOLM');
    add(y, m, 12, -between(550000, 950000), `THANH TOAN HOA DON EVN HCMC PE0${400000 + m}`);
    add(y, m, 15, -220000, 'VIETTEL THANH TOAN CUOC INTERNET FTTH');
    add(y, m, 20, -260000, 'NETFLIX.COM SINGAPORE');
    add(y, m, 25, between(15000, 40000), 'TRA LAI TIEN GUI KHONG KY HAN');
    for (let i = 0; i < 10; i++) add(y, m, 1 + Math.floor(rnd() * 28), -between(32000, 125000), `GRAB*A-${Math.floor(rnd() * 9e5)} HCMC`);
    for (let i = 0; i < 8; i++) add(y, m, 1 + Math.floor(rnd() * 28), -between(60000, 190000), pick(['SHOPEEFOOD HCM', 'GRABFOOD*CHI NHANH Q3', 'BAEMIN VN ORDER']));
    for (let i = 0; i < 8; i++) add(y, m, 1 + Math.floor(rnd() * 28), -between(45000, 79000), pick(['HIGHLANDS COFFEE NGUYEN HUE', 'PHUC LONG COFFEE AND TEA', 'KATINAT SAI GON CAFE']));
    for (let i = 0; i < 4; i++) add(y, m, 1 + Math.floor(rnd() * 28), -between(180000, 650000), pick(['BACH HOA XANH 1234', 'WINMART Q1 HCM', 'CO OP XTRA']));
    for (let i = 0; i < 3; i++) add(y, m, 1 + Math.floor(rnd() * 28), -between(99000, 850000), 'SHOPEEPAY*SHOPEE VN');
    for (let i = 0; i < 2; i++) add(y, m, 1 + Math.floor(rnd() * 28), -between(150000, 500000), pick(['CK den TRAN THI MAI', 'CK den LE MINH TUAN an trua']));
    add(y, m, 3 + Math.floor(rnd() * 20), -between(120000, 400000), 'POS 4123 4567 8901 2345 CTY TNHH MINH ANH');
    if (back === 3) add(y, m, 18, -385000, 'NHA THUOC LONG CHAU 245');
    if (back === 2) add(y, m, 22, -2000000, 'RUT TIEN ATM VCB 00123');
    if (back === 1) add(y, m, 14, -12990000, 'THE GIOI DI DONG IPHONE');
    if (back === 1 || back === 0) add(y, m, 8, -179000, 'YOUTUBE PREMIUM GOOGLE');
    if (back === 0) { add(y, m, 3, -89000, 'CIRCLE K 3 THANG 2'); add(y, m, 3, -89000, 'CIRCLE K 3 THANG 2'); }
  }
  rows.sort((a, b) => a.dt - b.dt);
  let bal = 18500000;
  const fmt = n => Math.abs(n).toLocaleString('en-US');
  const d2 = dt => `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
  const lines = [
    'NGAN HANG TMCP MAU - SAO KE TAI KHOAN',
    'So tai khoan: 0071000987654,Chu tai khoan: NGUOI DUNG MAU',
    '',
    'Ngày giao dịch,Nội dung,Ghi nợ,Ghi có,Số dư',
  ];
  for (const r of rows) {
    bal += r.amount;
    lines.push([d2(r.dt), `"${r.desc}"`, r.amount < 0 ? `"${fmt(r.amount)}"` : '', r.amount > 0 ? `"${fmt(r.amount)}"` : '', `"${fmt(bal)}"`].join(','));
  }
  return lines.join('\n');
}
