// Browser side of turn notifications: service worker + Push API.

import { getPushKey } from "./net/client.js";

export const pushSupported = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

export const isIos = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js").catch((e) => console.warn("Service worker registration failed:", e));
}

function keyBytes(b64url) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (b64url.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

const sameKey = (a, b) => {
  if (!a || !b) return false;
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
};

// What the bell button should offer on this device.
//   "unavailable" server has no VAPID keys · "unsupported" browser can't
//   "ios-install" iPhone/iPad needs Home Screen install first · "denied" blocked
//   "ready" can subscribe
export async function notifyCapability() {
  if (!pushSupported()) return isIos() && !isStandalone() ? "ios-install" : "unsupported";
  if (Notification.permission === "denied") return "denied";
  return (await getPushKey()) ? "ready" : "unavailable";
}

// Asks permission (must run from a click) and returns a subscription JSON.
export async function subscribeToPush() {
  const publicKey = await getPushKey();
  if (!publicKey) throw new Error("Notifications aren't set up on this server");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Notifications were not allowed");
  const reg = await navigator.serviceWorker.ready;
  const key = keyBytes(publicKey);
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub.options?.applicationServerKey, key)) {
    await sub.unsubscribe(); // server keys were rotated
    sub = null;
  }
  sub = sub || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
  return sub.toJSON();
}

export async function currentEndpoint() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub?.endpoint ?? null;
}
