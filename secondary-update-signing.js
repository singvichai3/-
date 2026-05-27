const crypto = require('crypto');
const SECONDARY_UPDATE_APP_ID = 'com.tro.rablemrot.secondary';
const SECONDARY_UPDATE_CHANNEL = 'stable';
const SECONDARY_UPDATE_SIGNATURE_ALG = 'ed25519';
const SECONDARY_UPDATE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA5FXmvSI3VW8sPZmuuHdPrTBS2QmuvEfqY5RL3YbzAdA=
-----END PUBLIC KEY-----
`;

function canonicalizeForSignature(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalizeForSignature).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalizeForSignature(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizeManifestForSignature(manifest = {}) {
  const payload = {};
  for (const [key, value] of Object.entries(manifest || {})) {
    if (['signature', 'signatureAlg'].includes(key)) continue;
    if (value !== undefined) payload[key] = value;
  }
  payload.appId = String(payload.appId || SECONDARY_UPDATE_APP_ID);
  payload.channel = String(payload.channel || SECONDARY_UPDATE_CHANNEL);
  return payload;
}

function verifySecondaryUpdateManifestSignature(manifest, publicKey = SECONDARY_UPDATE_PUBLIC_KEY) {
  if (!manifest || typeof manifest !== 'object') throw new Error('ไฟล์อัปเดตเครื่องรองไม่ถูกต้อง');
  const signature = String(manifest.signature || '').trim();
  const signatureAlg = String(manifest.signatureAlg || '').trim().toLowerCase();
  if (signatureAlg !== SECONDARY_UPDATE_SIGNATURE_ALG) {
    throw new Error('ไฟล์อัปเดตเครื่องรองใช้ชนิดลายเซ็นที่ไม่รองรับ');
  }
  if (!/^[a-zA-Z0-9+/=]+$/.test(signature)) {
    throw new Error('ไฟล์อัปเดตเครื่องรองไม่มีลายเซ็นที่ถูกต้อง');
  }
  const payload = normalizeManifestForSignature(manifest);
  const canonical = canonicalizeForSignature(payload);
  const ok = crypto.verify(null, Buffer.from(canonical, 'utf8'), publicKey, Buffer.from(signature, 'base64'));
  if (!ok) throw new Error('ลายเซ็นอัปเดตเครื่องรองไม่ถูกต้อง — อาจถูกแก้ไขหรือปลอมแปลง');
  return { ok: true, payload, canonical };
}

function signSecondaryUpdateManifest(manifest, privateKey) {
  const payload = normalizeManifestForSignature(manifest);
  const canonical = canonicalizeForSignature(payload);
  const signature = crypto.sign(null, Buffer.from(canonical, 'utf8'), privateKey).toString('base64');
  return { ...payload, signatureAlg: SECONDARY_UPDATE_SIGNATURE_ALG, signature };
}

module.exports = {
  SECONDARY_UPDATE_APP_ID,
  SECONDARY_UPDATE_CHANNEL,
  SECONDARY_UPDATE_SIGNATURE_ALG,
  SECONDARY_UPDATE_PUBLIC_KEY,
  canonicalizeForSignature,
  normalizeManifestForSignature,
  verifySecondaryUpdateManifestSignature,
  signSecondaryUpdateManifest
};
