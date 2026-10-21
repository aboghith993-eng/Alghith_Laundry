/* PWA installability. Private business records are never cached by this worker. */
self.addEventListener('install', event => { self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => new Response(
      '<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>غير متصل</title><body style="font-family:Tahoma,Arial;padding:2rem;line-height:1.8"><h2>لا يوجد اتصال بالإنترنت</h2><p>يحتاج نظام المغسلة إلى الاتصال بالخادم للوصول إلى السجلات المشتركة. أعد الاتصال ثم حدّث الصفحة.</p></body></html>',
      {status: 503, headers: {'Content-Type': 'text/html; charset=utf-8'}}
    )));
    return;
  }
  if (url.pathname.startsWith('/static/')) {
    event.respondWith(fetch(request).catch(() => new Response('', {status: 503})));
  }
});
