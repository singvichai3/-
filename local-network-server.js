const http = require('http');
const dgram = require('dgram');
const os = require('os');
const { URL } = require('url');
const { verifyLanHmacRequest, createNonceReplayCache } = require('./lan-security');
const {
  APP_ID,
  DISCOVERY_PORT,
  DEFAULT_HTTP_PORT,
  DISCOVERY_REQUEST,
  DISCOVERY_RESPONSE,
  normalizeRoomCode,
  generateRoomCode,
  getPrivateIpv4Addresses,
  buildDiscoveryResponse,
  parseDiscoveryMessage
} = require('./lan-pairing');

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Room-Code, X-Client-Name, X-Client-Id, X-LAN-HMAC-Version, X-Request-Timestamp, X-Request-Nonce, X-Body-SHA256, X-LAN-HMAC'
  });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req, limitBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    let rejected = false;
    const fail = (message, statusCode = 400) => {
      if (rejected) return;
      rejected = true;
      const error = new Error(message);
      error.statusCode = statusCode;
      reject(error);
    };
    req.on('data', (chunk) => {
      if (rejected) return;
      body += chunk.toString('utf8');
      if (Buffer.byteLength(body, 'utf8') > limitBytes) {
        fail('ข้อมูลที่ส่งมาใหญ่เกินไป', 413);
        req.resume();
      }
    });
    req.on('end', () => {
      if (rejected) return;
      try {
        const payload = body.trim() ? JSON.parse(body) : {};
        Object.defineProperty(payload, '__rawBody', { value: body, enumerable: false });
        resolve(payload);
      } catch {
        fail('รูปแบบ JSON ไม่ถูกต้อง', 400);
      }
    });
    req.on('error', (error) => fail(error.message || 'อ่านข้อมูลที่ส่งมาไม่ได้', 400));
  });
}

function sanitizeRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => ({
      id: row?.id,
      plate: String(row?.plate || '').trim(),
      province: String(row?.province || '').trim(),
      type: row?.type === 'จยย' ? 'จยย' : 'รย',
      brand: String(row?.brand || '').trim(),
      name: String(row?.name || '').trim(),
      phone: String(row?.phone || '').trim(),
      status: row?.status || 'pending',
      importedAt: String(row?.importedAt || row?.dateOnly || '').trim(),
      receivedAt: row?.receivedAt || null,
      completedAt: row?.completedAt || null,
      returnedAt: row?.returnedAt || null
    }))
    .filter((row) => row.plate);
}

function createLocalNetworkServer(options) {
  const {
    port = DEFAULT_HTTP_PORT,
    discoveryPort = DISCOVERY_PORT,
    version = '',
    sendToWorker,
    broadcastRefresh = () => {},
    logger = console,
    requireHmac = false
  } = options || {};

  if (typeof sendToWorker !== 'function') {
    throw new Error('sendToWorker callback is required');
  }

  let roomCode = normalizeRoomCode(options?.roomCode || generateRoomCode());
  let httpServer = null;
  let udpSocket = null;
  let actualPort = port;
  let actualDiscoveryPort = discoveryPort;
  const clients = new Map();
  const blockedClients = new Map();
  const activeHttpSockets = new Set();
  const hmacNonceCache = createNonceReplayCache();

  function decodeHeaderText(value) {
    try { return decodeURIComponent(String(value || '')); } catch { return String(value || ''); }
  }

  function sanitizeClientKeyPart(value) {
    return String(value || '')
      .trim()
      .replace(/[^\p{L}\p{N}_ -]/gu, '')
      .replace(/\s+/g, ' ')
      .slice(0, 80) || 'unknown';
  }

  function getClientIdentity(req, payload = {}) {
    const remoteAddress = String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
    const clientName = String(
      payload.clientName
      || decodeHeaderText(req.headers['x-client-name'])
      || 'เครื่องรอง'
    ).trim().slice(0, 80) || 'เครื่องรอง';
    const clientId = String(
      payload.clientId
      || decodeHeaderText(req.headers['x-client-id'])
      || ''
    ).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
    return {
      key: clientId ? `client:${clientId}` : `name:${sanitizeClientKeyPart(clientName)}`,
      clientId,
      name: clientName,
      address: remoteAddress || ''
    };
  }

  function isBlockedClient(identity) {
    return Boolean(identity?.key && blockedClients.has(identity.key));
  }


  function verifyAuthenticatedRequest(req, { rawBody = '', clientId = '', requireForEndpoint = false } = {}) {
    const verification = verifyLanHmacRequest({
      method: req.method,
      path: new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname,
      headers: req.headers,
      rawBody,
      roomCode,
      clientId,
      nonceCache: hmacNonceCache,
      requireHmac: Boolean(requireHmac || requireForEndpoint)
    });
    if (!verification.ok) {
      const error = new Error(verification.error || 'การยืนยันตัวตนไม่ผ่าน');
      error.statusCode = verification.statusCode || 401;
      throw error;
    }
    return verification;
  }

  function touchClient(req, payload = {}) {
    const identity = getClientIdentity(req, payload);
    const previous = clients.get(identity.key) || {};
    const blocked = blockedClients.get(identity.key);
    const now = new Date().toISOString();
    clients.set(identity.key, {
      key: identity.key,
      clientId: identity.clientId || previous.clientId || '',
      name: identity.name,
      address: identity.address || previous.address || '',
      firstSeenAt: previous.firstSeenAt || now,
      lastSeenAt: now,
      lastAction: payload.action || previous.lastAction || 'health',
      lastBatchId: payload.batchId || previous.lastBatchId || '',
      lastImported: Number.isFinite(payload.imported) ? payload.imported : previous.lastImported,
      lastSkipped: Number.isFinite(payload.skipped) ? payload.skipped : previous.lastSkipped,
      blocked: Boolean(blocked),
      blockedAt: blocked?.blockedAt || previous.blockedAt || '',
      blockedReason: blocked?.reason || previous.blockedReason || ''
    });
    return clients.get(identity.key);
  }

  function pruneClients(maxAgeMs = 5 * 60 * 1000) {
    const cutoff = Date.now() - maxAgeMs;
    for (const [key, client] of clients.entries()) {
      const seenAt = Date.parse(client.lastSeenAt || '');
      if (!Number.isFinite(seenAt) || seenAt < cutoff) clients.delete(key);
    }
  }

  function identity() {
    pruneClients();
    const addresses = getPrivateIpv4Addresses();
    return {
      app: APP_ID,
      role: 'main',
      name: os.hostname(),
      roomCode,
      port: actualPort,
      discoveryPort: actualDiscoveryPort,
      version,
      addresses,
      recommendedAddress: addresses.find(item => item.recommended)?.address || addresses[0]?.address || '127.0.0.1',
      started: Boolean(httpServer),
      clientCount: clients.size,
      blockedCount: blockedClients.size,
      clients: Array.from(clients.values())
        .map(client => ({
          ...client,
          blocked: Boolean(blockedClients.get(client.key) || client.blocked),
          blockedAt: blockedClients.get(client.key)?.blockedAt || client.blockedAt || '',
          blockedReason: blockedClients.get(client.key)?.reason || client.blockedReason || '',
          connectionType: 'LAN HTTP heartbeat',
          allowedActions: blockedClients.has(client.key) ? ['allow'] : ['disconnect']
        }))
        .sort((left, right) => String(right.lastSeenAt).localeCompare(String(left.lastSeenAt)))
        .slice(0, 20)
    };
  }

  async function handleSubmitBatch(req, res) {
    const headerRoomCode = req.headers['x-room-code'];
    let normalizedHeaderRoomCode = '';
    try {
      normalizedHeaderRoomCode = normalizeRoomCode(headerRoomCode || '');
    } catch {
      normalizedHeaderRoomCode = '';
    }
    if (normalizedHeaderRoomCode !== roomCode) {
      sendJson(res, 403, { ok: false, error: 'รหัสห้องไม่ถูกต้อง' });
      return;
    }

    const payload = await readJsonBody(req);
    const rawBody = payload?.__rawBody || '';
    verifyAuthenticatedRequest(req, {
      rawBody,
      clientId: payload?.clientId || decodeHeaderText(req.headers['x-client-id']) || '',
      requireForEndpoint: false
    });
    const clientIdentity = getClientIdentity(req, payload || {});
    if (isBlockedClient(clientIdentity)) {
      touchClient(req, { ...payload, action: 'blocked-submit' });
      sendJson(res, 403, { ok: false, blocked: true, error: 'เครื่องนี้ถูกตัดการเชื่อมต่อจากเครื่องหลัก' });
      return;
    }
    const rows = sanitizeRows(payload?.records || payload?.rows || []);
    if (rows.length === 0) {
      sendJson(res, 400, { ok: false, error: 'ไม่มีรายการสำหรับบันทึก' });
      return;
    }

    const batchId = `ROOM-${roomCode}-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
    const clientName = String(payload?.clientName || decodeHeaderText(req.headers['x-client-name']) || '').trim();
    const clientId = String(payload?.clientId || decodeHeaderText(req.headers['x-client-id']) || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
    const result = await sendToWorker('importBatch', {
      records: rows,
      batchSize: Math.max(1, Number(payload?.batchSize || 500)),
      source: {
        batchId,
        clientName,
        clientId,
        roomCode
      }
    }, 0, 120000);
    const imported = Number(result?.data?.imported ?? result?.imported ?? 0);
    const skipped = Number(result?.data?.skipped ?? result?.skipped ?? 0);
    touchClient(req, { clientName, clientId, action: 'submit', batchId, imported, skipped });
    sendJson(res, 200, {
      ok: true,
      batchId,
      imported,
      skipped,
      receivedRows: rows.length,
      printableRows: payload?.printableRows || []
    });
    setImmediate(() => {
      try { broadcastRefresh(null); } catch (error) { logger.warn?.('⚠️ refresh broadcast failed:', error.message); }
    });
  }

  function startHttp() {
    httpServer = http.createServer(async (req, res) => {
      try {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Room-Code, X-Client-Name, X-Client-Id, X-LAN-HMAC-Version, X-Request-Timestamp, X-Request-Nonce, X-Body-SHA256, X-LAN-HMAC');
        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
        if (req.method === 'GET' && url.pathname === '/api/health') {
          let authenticated = false;
          try {
            const headerRoomCode = normalizeRoomCode(req.headers['x-room-code'] || url.searchParams.get('roomCode') || '');
            if (headerRoomCode === roomCode) {
              const clientIdentity = getClientIdentity(req, {});
              verifyAuthenticatedRequest(req, { rawBody: '', clientId: clientIdentity.clientId || '', requireForEndpoint: false });
              if (isBlockedClient(clientIdentity)) {
                touchClient(req, { action: 'blocked-health' });
                sendJson(res, 403, { ok: false, blocked: true, error: 'เครื่องนี้ถูกตัดการเชื่อมต่อจากเครื่องหลัก', ...clientIdentity });
                return;
              }
              touchClient(req, { action: 'health' });
              authenticated = true;
            }
          } catch (error) {
            if (req.headers['x-room-code']) {
              sendJson(res, error.statusCode || 401, { ok: false, error: error.message || 'การยืนยันตัวตนไม่ผ่าน' });
              return;
            }
          }
          sendJson(res, 200, authenticated ? { ok: true, ...identity() } : { ok: true, app: APP_ID, role: 'main', version, started: Boolean(httpServer) });
          return;
        }
        if (req.method === 'POST' && url.pathname === '/api/intake-batches') {
          await handleSubmitBatch(req, res);
          return;
        }
        sendJson(res, 404, { ok: false, error: 'ไม่พบ endpoint นี้' });
      } catch (error) {
        sendJson(res, error.statusCode || 500, { ok: false, error: error.message || 'เกิดข้อผิดพลาด' });
      }
    });

    httpServer.on('connection', (socket) => {
      activeHttpSockets.add(socket);
      socket.on('close', () => activeHttpSockets.delete(socket));
    });
    if (typeof httpServer.unref === 'function') httpServer.unref();

    return new Promise((resolve, reject) => {
      let fallbackTried = false;
      const listenOn = (targetPort) => {
        httpServer.once('error', onError);
        httpServer.listen(targetPort, '0.0.0.0', () => {
          actualPort = httpServer.address()?.port || targetPort;
          httpServer.off('error', onError);
          resolve(actualPort);
        });
      };
      const onError = (error) => {
        httpServer.off('error', onError);
        if (!fallbackTried && Number(port) !== 0 && error?.code === 'EADDRINUSE') {
          fallbackTried = true;
          logger.warn?.(`⚠️ port ${port} ถูกใช้อยู่แล้ว จะเลื่อนไปพอร์ตว่างอัตโนมัติ`);
          listenOn(0);
          return;
        }
        reject(error);
      };
      listenOn(port);
    });
  }

  function startUdp() {
    udpSocket = dgram.createSocket('udp4');
    udpSocket.on('message', (message, rinfo) => {
      const parsed = parseDiscoveryMessage(message);
      if (!parsed || parsed.type !== DISCOVERY_REQUEST || parsed.roomCode !== roomCode) return;
      const response = buildDiscoveryResponse({
        roomCode,
        port: actualPort,
        // Let the secondary app use the UDP packet source address. That source
        // is the interface Windows actually used to reply, which is more
        // reliable than guessing among VPN/Docker/Hyper-V/LAN addresses.
        host: '',
        name: os.hostname(),
        version
      });
      udpSocket.send(Buffer.from(response), rinfo.port, rinfo.address, (error) => {
        if (error) logger.warn?.('⚠️ discovery reply failed:', error.message);
      });
    });

    return new Promise((resolve, reject) => {
      udpSocket.once('error', reject);
      udpSocket.bind(discoveryPort, () => {
        actualDiscoveryPort = udpSocket.address()?.port || discoveryPort;
        udpSocket.setBroadcast(true);
        if (typeof udpSocket.unref === 'function') udpSocket.unref();
        udpSocket.off('error', reject);
        resolve(actualDiscoveryPort);
      });
    });
  }

  return {
    async start() {
      await startHttp();
      await startUdp();
      logger.log?.(`🔗 LAN room ${roomCode} ready on ${actualPort}/${actualDiscoveryPort}`);
      return identity();
    },
    stop() {
      if (udpSocket) {
        try { udpSocket.close(); } catch { /* ignore */ }
        udpSocket = null;
      }
      if (httpServer) {
        try {
          if (typeof httpServer.closeAllConnections === 'function') httpServer.closeAllConnections();
          for (const socket of activeHttpSockets) {
            try { socket.destroy(); } catch { /* ignore */ }
          }
          activeHttpSockets.clear();
          httpServer.close();
        } catch { /* ignore */ }
        httpServer = null;
      }
    },
    getStatus: identity,
    disconnectClient(clientKey, reason = 'ตัดจากหน้ามอนิเตอร์') {
      const key = String(clientKey || '').trim();
      if (!key) throw new Error('ไม่พบรหัสเครื่องลูก');
      const previous = clients.get(key);
      if (!previous && !blockedClients.has(key)) throw new Error('ไม่พบเครื่องลูกนี้ในมอนิเตอร์');
      const blocked = { blockedAt: new Date().toISOString(), reason: String(reason || '').slice(0, 160) || 'ตัดจากหน้ามอนิเตอร์' };
      blockedClients.set(key, blocked);
      clients.set(key, { ...previous, key, blocked: true, blockedAt: blocked.blockedAt, blockedReason: blocked.reason, lastAction: 'disconnected-by-main' });
      return identity();
    },
    allowClient(clientKey) {
      const key = String(clientKey || '').trim();
      if (!key) throw new Error('ไม่พบรหัสเครื่องลูก');
      blockedClients.delete(key);
      const previous = clients.get(key);
      if (previous) clients.set(key, { ...previous, blocked: false, blockedAt: '', blockedReason: '', lastAction: 'allowed-by-main' });
      return identity();
    },
    setRoomCode(nextRoomCode) {
      roomCode = normalizeRoomCode(nextRoomCode);
      return identity();
    },
    regenerateRoomCode() {
      roomCode = generateRoomCode();
      return identity();
    }
  };
}

module.exports = {
  createLocalNetworkServer,
  startLocalNetworkServer: (options) => {
    const server = createLocalNetworkServer(options);
    return server.start().then(() => server);
  },
  sanitizeRows
};
