// Chạy trước app (viết kiểu cũ để máy đời cũ cũng chạy được).
// Nếu app không khởi động được, hiện lỗi ra màn hình thay vì để trắng trang.
(function () {
  var errors = [];
  function iosVersion() {
    var m = navigator.userAgent.match(/OS (\d+)_(\d+)/);
    return m ? 'iOS ' + m[1] + '.' + m[2] : '';
  }
  function show(reason, force) {
    if (window.__started && !force) return;
    var box = document.getElementById('boot') || document.getElementById('view');
    if (!box) return;
    document.body.className = '';
    var lang = (navigator.language || 'vi').slice(0, 2);
    var txt = lang === 'fr'
      ? { t: 'L\'appli n\'a pas pu démarrer', r: 'Réessayer', c: 'Vider le cache de l\'appli (garde vos données)', s: 'Envoyez une capture de cet écran pour obtenir de l\'aide.' }
      : lang === 'en'
        ? { t: 'The app could not start', r: 'Try again', c: 'Clear app cache (keeps your data)', s: 'Send a screenshot of this screen to get help.' }
        : { t: 'App chưa khởi động được', r: 'Thử lại', c: 'Xóa bộ nhớ đệm của app (giữ nguyên dữ liệu)', s: 'Chụp màn hình này gửi người hỗ trợ nhé.' };
    var info = [reason].concat(errors).concat([iosVersion(), 'standalone=' + (!!navigator.standalone), 'idb=' + (!!window.indexedDB), 'sw=' + ('serviceWorker' in navigator)]).filter(Boolean);
    box.innerHTML = '<div class="boot-err"><div style="font-size:2.5rem">😵</div><h2></h2><p class="small"></p>' +
      '<pre></pre><button class="btn primary wide" id="boot-retry"></button><button class="btn ghost wide" id="boot-clear"></button></div>';
    box.querySelector('h2').textContent = txt.t;
    box.querySelector('p').textContent = txt.s;
    box.querySelector('pre').textContent = info.join('\n');
    box.querySelector('#boot-retry').textContent = txt.r;
    box.querySelector('#boot-clear').textContent = txt.c;
    box.querySelector('#boot-retry').onclick = function () { location.reload(); };
    box.querySelector('#boot-clear').onclick = function () {
      var jobs = [];
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
        jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) { return Promise.all(rs.map(function (r) { return r.unregister(); })); }));
      }
      if (window.caches) jobs.push(caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); }));
      Promise.all(jobs).then(function () { location.reload(); }, function () { location.reload(); });
    };
  }
  window.addEventListener('error', function (e) {
    if (e.target && e.target.tagName && e.target.tagName !== 'SCRIPT') return; // ảnh/biểu tượng lỗi thì bỏ qua
    errors.push('error: ' + (e.message || (e.target && e.target.src) || 'resource') + (e.filename ? ' @' + e.filename.split('/').pop() + ':' + e.lineno : ''));
    if (!window.__started) show('');
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    errors.push('promise: ' + (e.reason && (e.reason.message || e.reason)));
    if (!window.__started) show('');
  });
  window.__bootFail = function (err) { errors.push('start: ' + (err && (err.message || err))); show('', true); };
  // Không khởi động được sau 8 giây → hiện thông tin
  setTimeout(function () { if (!window.__started) show('timeout 8s'); }, 8000);
  // Trình duyệt quá cũ, không chạy được module
  var s = document.createElement('script');
  if (!('noModule' in s)) setTimeout(function () { show('browser too old (no ES modules)'); }, 0);
})();
