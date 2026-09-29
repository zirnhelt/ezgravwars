// Gravity Wars service worker: turn notifications only (no offline caching).

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data?.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Gravity Wars", {
      body: data.body || "It's your move.",
      tag: data.tag, // one notification per match; newer replaces older
      renotify: !!data.tag,
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      data: { url: data.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const exact = wins.find((w) => w.url === url);
      if (exact) return exact.focus();
      const ours = wins.find((w) => new URL(w.url).origin === self.location.origin);
      if (ours && "navigate" in ours) {
        await ours.navigate(url);
        return ours.focus();
      }
      return self.clients.openWindow(url);
    })()
  );
});
