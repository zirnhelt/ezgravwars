// Web Push (RFC 8030) from a Worker using only WebCrypto — no dependencies.
//   Payload encryption: RFC 8291 (aes128gcm content coding, RFC 8188)
//   Sender auth:        RFC 8292 (VAPID, ES256 JWT)
//
// Configure with worker secrets VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (base64url,
// from `npm run vapid`) and VAPID_SUBJECT (e.g. mailto:you@example.com).
// Without them, push is simply disabled.

const enc = new TextEncoder();

export function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function bytesToB64url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concat(...parts) {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function hmac(key, data) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

// RFC 8291 §3.4 + RFC 8188. `salt` and `asKeyPair` are only passed by tests
// (to reproduce the RFC's worked example); normally both are fresh per message.
export async function encryptPayload(uaPublicB64, authSecretB64, plaintext, { salt, asKeyPair } = {}) {
  const uaPublic = b64urlToBytes(uaPublicB64);
  const authSecret = b64urlToBytes(authSecretB64);
  salt = salt ?? crypto.getRandomValues(new Uint8Array(16));
  const as = asKeyPair ?? (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]));
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey));

  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256));

  // HKDF (single-block expand, since every output here is <= 32 bytes)
  const prkKey = await hmac(authSecret, ecdhSecret);
  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hmac(prkKey, concat(keyInfo, [1]));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode("Content-Encoding: aes128gcm\0"), [1]))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode("Content-Encoding: nonce\0"), [1]))).slice(0, 12);

  const data = typeof plaintext === "string" ? enc.encode(plaintext) : plaintext;
  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, concat(data, [2])) // 0x02 = last record
  );

  const header = new Uint8Array(21 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096); // record size
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, ciphertext);
}

let signingKey = null; // cached per isolate

async function vapidKey(publicKey, privateKey) {
  if (signingKey?.publicKey === publicKey) return signingKey.key;
  const pub = b64urlToBytes(publicKey);
  const jwk = {
    kty: "EC",
    crv: "P-256",
    d: privateKey,
    x: bytesToB64url(pub.slice(1, 33)),
    y: bytesToB64url(pub.slice(33, 65)),
    ext: true,
  };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  signingKey = { publicKey, key };
  return key;
}

// RFC 8292: `Authorization: vapid t=<jwt>, k=<public key>`
export async function vapidAuthorization(endpoint, { publicKey, privateKey, subject }, now = Date.now()) {
  const b64json = (o) => bytesToB64url(enc.encode(JSON.stringify(o)));
  const unsigned = `${b64json({ typ: "JWT", alg: "ES256" })}.${b64json({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + 12 * 3600,
    sub: subject,
  })}`;
  const key = await vapidKey(publicKey, privateKey);
  // WebCrypto ECDSA signatures are already raw r||s, which is what JWS wants.
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(unsigned)));
  return `vapid t=${unsigned}.${bytesToB64url(sig)}, k=${publicKey}`;
}

// Only talk to real push services (plus an optional prefix for local testing),
// so a stored "subscription" can't make the room fetch arbitrary URLs.
const PUSH_HOST_SUFFIXES = ["fcm.googleapis.com", "push.services.mozilla.com", "push.apple.com", "notify.windows.com"];

export function isAllowedEndpoint(endpoint, env) {
  if (typeof endpoint !== "string" || endpoint.length > 1024) return false;
  if (env?.PUSH_TEST_ENDPOINT_PREFIX && endpoint.startsWith(env.PUSH_TEST_ENDPOINT_PREFIX)) return true;
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && PUSH_HOST_SUFFIXES.some((s) => u.hostname === s || u.hostname.endsWith(`.${s}`));
  } catch {
    return false;
  }
}

export function pushConfigured(env) {
  return !!(env?.VAPID_PUBLIC_KEY && env?.VAPID_PRIVATE_KEY);
}

// Returns { ok, gone } — `gone` means the subscription is dead and should be dropped.
export async function sendPush(subscription, payload, env, { ttl = 86400, topic } = {}) {
  if (!pushConfigured(env) || !isAllowedEndpoint(subscription?.endpoint, env)) return { ok: false, gone: false };
  try {
    const body = await encryptPayload(subscription.keys.p256dh, subscription.keys.auth, JSON.stringify(payload));
    const headers = {
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(ttl),
      Urgency: "high",
      Authorization: await vapidAuthorization(subscription.endpoint, {
        publicKey: env.VAPID_PUBLIC_KEY,
        privateKey: env.VAPID_PRIVATE_KEY,
        subject: env.VAPID_SUBJECT || "mailto:gravity-wars@example.com",
      }),
    };
    if (topic) headers.Topic = topic; // newer message with the same topic replaces an undelivered one
    const res = await fetch(subscription.endpoint, { method: "POST", headers, body });
    return { ok: res.ok, gone: res.status === 404 || res.status === 410 };
  } catch (e) {
    console.error("[push] send failed:", e?.message);
    return { ok: false, gone: false };
  }
}
