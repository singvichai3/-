const crypto = require('crypto');
const { normalizeRoomCode } = require('./lan-pairing');

const HMAC_VERSION = 'v1';
const HMAC_SALT_HEX = 'e7f3a1c9b2d8045e9b3f10c6a724d2ab';
const HMAC_INFO = 'rab-lem-rot-tro-lan-hmac-v1';
const HMAC_TIMESTAMP_WINDOW_MS = 60 * 1000;
const HMAC_NONCE_TTL_MS = 90 * 1000;
const HMAC_NONCE_MAX_ITEMS = 1000;

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function deriveLanHmacKey(roomCode) {
  const normalizedRoomCode = normalizeRoomCode(roomCode);
  return crypto.pbkdf2Sync(
    `${HMAC_INFO}:${normalizedRoomCode}`,
    Buffer.from(HMAC_SALT_HEX, 'hex'),
    100000,
    32,
    'sha256'
  );
}

function normalizeHmacPath(pathname) {
  const raw = String(pathname || '/').trim() || '/';
  return raw.split('?')[0] || '/';
}

function buildLanHmacCanonicalString({ method, path, bodyHash, timestamp, nonce, roomCode, clientId }) {
  return [
    String(method || 'GET').toUpperCase(),
    normalizeHmacPath(path),
    String(bodyHash || '').toLowerCase(),
    String(timestamp || ''),
    String(nonce || ''),
    `room:${normalizeRoomCode(roomCode)}`,
    `client:${String(clientId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80)}`,
    `version:${HMAC_VERSION}`
  ].join('\n');
}

function timingSafeEqualHex(left, right) {
  const leftText = String(left || '').toLowerCase();
  const rightText = String(right || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(leftText) || !/^[a-f0-9]{64}$/.test(rightText)) return false;
  const leftBuffer = Buffer.from(leftText, 'hex');
  const rightBuffer = Buffer.from(rightText, 'hex');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function signLanRequest({ method, path, body = '', roomCode, clientId = '', now = new Date(), nonce }) {
  const normalizedRoomCode = normalizeRoomCode(roomCode);
  const timestamp = now instanceof Date ? now.toISOString() : String(now || new Date().toISOString());
  const requestNonce = nonce || crypto.randomBytes(16).toString('hex');
  const bodyHash = sha256Hex(body);
  const canonical = buildLanHmacCanonicalString({
    method,
    path,
    bodyHash,
    timestamp,
    nonce: requestNonce,
    roomCode: normalizedRoomCode,
    clientId
  });
  const signature = crypto.createHmac('sha256', deriveLanHmacKey(normalizedRoomCode)).update(canonical, 'utf8').digest('hex');
  return {
    'X-LAN-HMAC-Version': HMAC_VERSION,
    'X-Request-Timestamp': timestamp,
    'X-Request-Nonce': requestNonce,
    'X-Body-SHA256': bodyHash,
    'X-LAN-HMAC': signature
  };
}

function hasLanHmacHeaders(headers = {}) {
  return Boolean(headers['x-lan-hmac'] || headers['X-LAN-HMAC']);
}

function createNonceReplayCache({ ttlMs = HMAC_NONCE_TTL_MS, maxItems = HMAC_NONCE_MAX_ITEMS } = {}) {
  const seen = new Map();
  function prune(now = Date.now()) {
    for (const [nonce, seenAt] of seen.entries()) {
      if (now - seenAt > ttlMs) seen.delete(nonce);
    }
    while (seen.size > maxItems) {
      const firstKey = seen.keys().next().value;
      if (!firstKey) break;
      seen.delete(firstKey);
    }
  }
  return {
    has(nonce, now = Date.now()) {
      prune(now);
      return seen.has(nonce);
    },
    add(nonce, now = Date.now()) {
      prune(now);
      seen.set(String(nonce || ''), now);
    },
    size() { prune(); return seen.size; },
    prune
  };
}

function verifyLanHmacRequest({ method, path, headers = {}, rawBody = '', roomCode, clientId = '', nonceCache, now = Date.now(), requireHmac = false }) {
  if (!hasLanHmacHeaders(headers)) {
    if (requireHmac) return { ok: false, statusCode: 401, error: 'ต้องใช้ลายเซ็น HMAC สำหรับคำขอนี้' };
    return { ok: true, legacy: true };
  }

  const version = String(headers['x-lan-hmac-version'] || headers['X-LAN-HMAC-Version'] || '').trim();
  const timestamp = String(headers['x-request-timestamp'] || headers['X-Request-Timestamp'] || '').trim();
  const nonce = String(headers['x-request-nonce'] || headers['X-Request-Nonce'] || '').trim();
  const providedBodyHash = String(headers['x-body-sha256'] || headers['X-Body-SHA256'] || '').trim().toLowerCase();
  const providedSignature = String(headers['x-lan-hmac'] || headers['X-LAN-HMAC'] || '').trim().toLowerCase();

  if (version !== HMAC_VERSION) return { ok: false, statusCode: 401, error: 'เวอร์ชัน HMAC ไม่รองรับ' };
  if (!/^\d{4}-\d{2}-\d{2}T/.test(timestamp) || !Number.isFinite(Date.parse(timestamp))) {
    return { ok: false, statusCode: 401, error: 'เวลาในคำขอไม่ถูกต้อง' };
  }
  if (Math.abs(now - Date.parse(timestamp)) > HMAC_TIMESTAMP_WINDOW_MS) {
    return { ok: false, statusCode: 401, error: 'คำขอหมดอายุ กรุณาตรวจเวลาเครื่อง' };
  }
  if (!/^[a-f0-9]{24,64}$/i.test(nonce)) return { ok: false, statusCode: 401, error: 'nonce ในคำขอไม่ถูกต้อง' };
  if (nonceCache?.has(nonce, now)) return { ok: false, statusCode: 401, error: 'คำขอนี้ถูกใช้ซ้ำแล้ว' };

  const actualBodyHash = sha256Hex(rawBody);
  if (!timingSafeEqualHex(actualBodyHash, providedBodyHash)) {
    return { ok: false, statusCode: 401, error: 'ข้อมูลในคำขอไม่ตรงกับลายเซ็น' };
  }

  let normalizedRoomCode;
  try { normalizedRoomCode = normalizeRoomCode(roomCode); } catch { return { ok: false, statusCode: 403, error: 'รหัสห้องไม่ถูกต้อง' }; }
  const canonical = buildLanHmacCanonicalString({
    method,
    path,
    bodyHash: actualBodyHash,
    timestamp,
    nonce,
    roomCode: normalizedRoomCode,
    clientId
  });
  const expectedSignature = crypto.createHmac('sha256', deriveLanHmacKey(normalizedRoomCode)).update(canonical, 'utf8').digest('hex');
  if (!timingSafeEqualHex(expectedSignature, providedSignature)) {
    return { ok: false, statusCode: 401, error: 'ลายเซ็น HMAC ไม่ถูกต้อง' };
  }
  nonceCache?.add(nonce, now);
  return { ok: true, legacy: false };
}

module.exports = {
  HMAC_VERSION,
  HMAC_TIMESTAMP_WINDOW_MS,
  HMAC_NONCE_TTL_MS,
  sha256Hex,
  deriveLanHmacKey,
  buildLanHmacCanonicalString,
  signLanRequest,
  hasLanHmacHeaders,
  verifyLanHmacRequest,
  createNonceReplayCache
};
