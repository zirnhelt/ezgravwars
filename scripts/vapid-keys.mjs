// Generates a VAPID key pair for Web Push turn notifications.
// Usage: npm run vapid   (then paste the printed commands)

const toB64url = (buf) => Buffer.from(buf).toString("base64url");

const { publicKey, privateKey } = await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"]
);
const pub = toB64url(await crypto.subtle.exportKey("raw", publicKey));
const { d } = await crypto.subtle.exportKey("jwk", privateKey);

console.log(`VAPID_PUBLIC_KEY=${pub}`);
console.log(`VAPID_PRIVATE_KEY=${d}`);
console.log(`
Set them on the worker (the private key is a secret — don't commit it):

  echo "${pub}" | npx wrangler secret put VAPID_PUBLIC_KEY
  echo "${d}" | npx wrangler secret put VAPID_PRIVATE_KEY
  echo "mailto:you@example.com" | npx wrangler secret put VAPID_SUBJECT

For local dev, put the same three lines (KEY=value) in .dev.vars instead.`);
