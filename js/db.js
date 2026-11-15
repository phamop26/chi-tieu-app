// Lưu trữ trên máy bằng IndexedDB — không có máy chủ.
const DB_NAME = 'chitieu';
const VERSION = 2;
let dbPromise = null;

// Safari đôi khi "treo" lần mở IndexedDB đầu tiên: gọi nhẹ indexedDB.databases() cho đến khi nó trả lời.
function safariWake() {
  if (!window.indexedDB) return Promise.reject(new Error('IndexedDB not available'));
  if (!indexedDB.databases) return Promise.resolve();
  return new Promise(resolve => {
    let n = 0, timer = null, finished = false;
    const finish = () => { if (!finished) { finished = true; clearTimeout(timer); resolve(); } };
    const tick = () => {
      indexedDB.databases().then(finish, finish);
      if (++n < 30) timer = setTimeout(tick, 100); else finish();
    };
    tick();
  });
}

function open() {
  if (!dbPromise) {
    dbPromise = safariWake().then(() => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('IndexedDB timeout')), 6000);
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        // v1: giao dịch, mục, lần nhập, cài đặt · v2: tài khoản (thẻ, ví trả sau, tiết kiệm, đầu tư) và mục tiêu
        for (const [name, key] of [['tx', 'id'], ['cats', 'id'], ['imports', 'id'], ['kv', 'k'], ['accounts', 'id'], ['goals', 'id']]) {
          if (!d.objectStoreNames.contains(name)) d.createObjectStore(name, { keyPath: key });
        }
      };
      req.onsuccess = () => { clearTimeout(timer); resolve(req.result); };
      req.onerror = () => { clearTimeout(timer); reject(req.error || new Error('IndexedDB error')); };
    })).catch(err => { dbPromise = null; throw err; });
  }
  return dbPromise;
}

function run(store, mode, fn) {
  return open().then(d => new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req && typeof req === 'object' && 'readyState' in req ? req.result : undefined);
    t.onerror = t.onabort = () => reject(t.error);
  }));
}

export const getAll = store => run(store, 'readonly', s => s.getAll());
export const put = (store, item) => run(store, 'readwrite', s => { s.put(item); });
export const putMany = (store, items) => run(store, 'readwrite', s => { for (const i of items) s.put(i); });
export const remove = (store, key) => run(store, 'readwrite', s => { s.delete(key); });
export const removeMany = (store, keys) => run(store, 'readwrite', s => { for (const k of keys) s.delete(k); });
export const clear = store => run(store, 'readwrite', s => { s.clear(); });

export async function getKV(k, fallback) {
  const r = await run('kv', 'readonly', s => s.get(k));
  return r === undefined ? fallback : r.v;
}
export const setKV = (k, v) => put('kv', { k, v });

// Xóa sạch: cơ sở dữ liệu, bộ nhớ đệm, localStorage.
export async function wipeEverything() {
  try { const d = await open(); d.close(); } catch (e) { /* ignore */ }
  dbPromise = null;
  await new Promise(res => {
    const r = indexedDB.deleteDatabase(DB_NAME);
    r.onsuccess = r.onerror = r.onblocked = () => res();
  });
  try { if (window.caches) for (const k of await caches.keys()) if (k.startsWith('shared') || k === 'gen') await caches.delete(k); } catch (e) { /* ignore */ }
  try { localStorage.clear(); sessionStorage.clear(); } catch (e) { /* ignore */ }
}
