const dgram = require('dgram');
const {
  DISCOVERY_PORT,
  DEFAULT_HTTP_PORT,
  normalizeRoomCode,
  buildDiscoveryRequest,
  parseDiscoveryMessage,
  DISCOVERY_RESPONSE
} = require('./lan-pairing');

function normalizePort(port) {
  const value = Number(port || DEFAULT_HTTP_PORT);
  if (!Number.isInteger(value) || value < 1 || value > 65535) return DEFAULT_HTTP_PORT;
  return value;
}

function makeHttpError(payload, fallbackMessage, status) {
  const error = new Error(payload?.error || fallbackMessage);
  error.status = status;
  error.blocked = Boolean(payload?.blocked);
  return error;
}

function discoverOnce(roomCode, { timeoutMs = 2500, discoveryPort = DISCOVERY_PORT } = {}) {
  const normalizedRoomCode = normalizeRoomCode(roomCode);
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const request = Buffer.from(buildDiscoveryRequest(normalizedRoomCode));
    let done = false;

    const finish = (error, result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { socket.close(); } catch { /* ignore */ }
      if (error) reject(error);
      else resolve(result);
    };

    const timer = setTimeout(() => finish(new Error('ไม่พบเครื่องหลักในวง LAN เดียวกัน')), timeoutMs);

    socket.on('error', (error) => finish(error));
    socket.on('message', (message, rinfo) => {
      const parsed = parseDiscoveryMessage(message);
      if (!parsed || parsed.type !== DISCOVERY_RESPONSE) return;
      if (parsed.roomCode !== normalizedRoomCode) return;
      finish(null, {
        host: parsed.host || rinfo.address,
        port: normalizePort(parsed.port || DEFAULT_HTTP_PORT),
        name: parsed.name || 'เครื่องหลัก',
        roomCode: normalizedRoomCode,
        version: parsed.version || ''
      });
    });

    socket.bind(() => {
      socket.setBroadcast(true);
      socket.send(request, 0, request.length, discoveryPort, '255.255.255.255', (error) => {
        if (error) finish(error);
      });
    });
  });
}

async function findMainByRoomCode(roomCode, options = {}) {
  return discoverOnce(roomCode, options);
}

async function submitIntakeBatch({ host, port = DEFAULT_HTTP_PORT, roomCode, rows, printableRows, clientName, clientId, batchSize = 500 }) {
  const normalizedRoomCode = normalizeRoomCode(roomCode);
  if (!host) throw new Error('ยังไม่ได้เชื่อมต่อเครื่องหลัก');
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('ไม่มีรายการสำหรับบันทึก');

  const response = await fetch(`http://${host}:${normalizePort(port)}/api/intake-batches`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Room-Code': normalizedRoomCode,
      'X-Client-Name': encodeURIComponent(String(clientName || 'เครื่องรอง').slice(0, 80)),
      'X-Client-Id': encodeURIComponent(String(clientId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80))
    },
    body: JSON.stringify({ rows, printableRows, clientName, clientId, batchSize })
  });

  let payload = null;
  try { payload = await response.json(); } catch { payload = {}; }
  if (!response.ok || payload?.ok === false) {
    throw makeHttpError(payload, `บันทึกเข้าเครื่องหลักไม่สำเร็จ (${response.status})`, response.status);
  }
  return payload;
}

async function healthCheck({ host, port = DEFAULT_HTTP_PORT, roomCode = '', clientName = 'เครื่องรอง', clientId = '' }) {
  if (!host) throw new Error('ยังไม่ได้ระบุเครื่องหลัก');
  const headers = {};
  if (roomCode) {
    headers['X-Room-Code'] = normalizeRoomCode(roomCode);
    headers['X-Client-Name'] = encodeURIComponent(String(clientName || 'เครื่องรอง').slice(0, 80));
    headers['X-Client-Id'] = encodeURIComponent(String(clientId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80));
  }
  const response = await fetch(`http://${host}:${normalizePort(port)}/api/health`, { cache: 'no-store', headers });
  const payload = await response.json();
  if (!response.ok || payload?.ok === false) {
    throw makeHttpError(payload, 'เครื่องหลักไม่พร้อมใช้งาน', response.status);
  }
  return payload;
}

module.exports = {
  findMainByRoomCode,
  submitIntakeBatch,
  healthCheck
};
