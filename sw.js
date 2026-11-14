// Service worker: cho app chạy khi không có mạng + nhận file được chia sẻ (Android).
// Không gửi bất kỳ dữ liệu nào đi đâu.
const VERSION = 'v1.0.0';
const SHELL = `shell-${VERSION}`;
const LIBS = 'libs-v1';
const SHELL_FILES = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest',
  'js/app.js', 'js/i18n.js', 'js/db.js', 'js/parse.js', 'js/classify.js', 'js/insights.js', 'js/lock.js', 'js/sample.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];
const LIB_FILES = [
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    await (await caches.open(SHELL)).addAll(SHELL_FILES);
    // Thư viện đọc Excel/PDF: tải trước để dùng offline (không bắt buộc thành công)
    try { const c = await caches.open(LIBS); await Promise.all(LIB_FILES.map(u => c.match(u).then(m => m || c.add(new Request(u, { mode: 'cors' }))))); } catch (err) { /* offline */ }
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('shell-') && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Nhận file chia sẻ từ app ngân hàng / trình quản lý file
  if (e.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith((async () => {
      try {
        const form = await e.request.formData();
        const cache = await caches.open('shared');
        let i = 0;
        for (const f of form.getAll('file')) {
          if (!(f instanceof File)) continue;
          await cache.put(`shared-${Date.now()}-${i++}`, new Response(f, { headers: { 'content-type': f.type || 'application/octet-stream', 'x-name': encodeURIComponent(f.name) } }));
        }
      } catch (err) { /* ignore */ }
      return Response.redirect(new URL('./?shared=1', self.registration.scope).href, 303);
    })());
    return;
  }
  if (e.request.method !== 'GET') return;

  if (url.origin === 'https://cdnjs.cloudflare.com') {
    e.respondWith((async () => {
      const c = await caches.open(LIBS);
      const hit = await c.match(e.request.url);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request.url, res.clone());
      return res;
    })());
    return;
  }
  if (url.origin !== self.location.origin) return;

  // App shell: ưu tiên mạng (để nhận bản mới), rớt mạng thì dùng bản đã lưu
  e.respondWith((async () => {
    try {
      const res = await fetch(e.request);
      if (res.ok) (await caches.open(SHELL)).put(e.request, res.clone());
      return res;
    } catch (err) {
      return (await caches.match(e.request, { ignoreSearch: true })) || (await caches.match('index.html'));
    }
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window' });
    if (all.length) return all[0].focus();
    return self.clients.openWindow('./');
  })());
});
