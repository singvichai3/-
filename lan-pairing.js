const os = require('os');

const APP_ID = 'rab-lem-rot-tro';
const DISCOVERY_PORT = 39731;
const DEFAULT_HTTP_PORT = 39730;
const DISCOVERY_REQUEST = 'DISCOVER_MAIN';
const DISCOVERY_RESPONSE = 'MAIN_HERE';

function normalizeRoomCode(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!/^\d{6}$/.test(digits)) {
    throw new Error('รหัสห้องต้องเป็นตัวเลข 6 หลัก');
  }
  return digits;
}

function generateRoomCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function isPrivateIpv4(address) {
  const text = String(address || '').trim();
  return /^10\./.test(text)
    || /^192\.168\./.test(text)
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(text);
}

function getPrivateIpv4Addresses(networkInterfaces = os.networkInterfaces()) {
  const addresses = [];
  Object.entries(networkInterfaces || {}).forEach(([name, items]) => {
    (items || []).forEach((item) => {
      if (!item || item.internal) return;
      if (item.family !== 'IPv4') return;
      const address = String(item.address || '').trim();
      if (!address) return;
      addresses.push({
        name,
        address,
        recommended: isPrivateIpv4(address)
      });
    });
  });
  return addresses.sort((left, right) => Number(right.recommended) - Number(left.recommended));
}

function buildDiscoveryRequest(roomCode) {
  return JSON.stringify({
    app: APP_ID,
    type: DISCOVERY_REQUEST,
    roomCode: normalizeRoomCode(roomCode)
  });
}

function buildDiscoveryResponse({ roomCode, port = DEFAULT_HTTP_PORT, host = '', name = os.hostname(), version = '' }) {
  return JSON.stringify({
    app: APP_ID,
    type: DISCOVERY_RESPONSE,
    roomCode: normalizeRoomCode(roomCode),
    host: String(host || ''),
    port: Number(port || DEFAULT_HTTP_PORT),
    name: String(name || os.hostname()),
    version: String(version || '')
  });
}

function parseDiscoveryMessage(buffer) {
  let parsed;
  try {
    parsed = JSON.parse(Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer || ''));
  } catch {
    return null;
  }

  if (!parsed || parsed.app !== APP_ID) return null;
  if (![DISCOVERY_REQUEST, DISCOVERY_RESPONSE].includes(parsed.type)) return null;

  try {
    parsed.roomCode = normalizeRoomCode(parsed.roomCode);
  } catch {
    return null;
  }

  if (parsed.type === DISCOVERY_RESPONSE) {
    parsed.port = Number(parsed.port || DEFAULT_HTTP_PORT);
    parsed.host = String(parsed.host || '');
    parsed.name = String(parsed.name || '');
    parsed.version = String(parsed.version || '');
  }

  return parsed;
}

module.exports = {
  APP_ID,
  DISCOVERY_PORT,
  DEFAULT_HTTP_PORT,
  DISCOVERY_REQUEST,
  DISCOVERY_RESPONSE,
  normalizeRoomCode,
  generateRoomCode,
  isPrivateIpv4,
  getPrivateIpv4Addresses,
  buildDiscoveryRequest,
  buildDiscoveryResponse,
  parseDiscoveryMessage
};
