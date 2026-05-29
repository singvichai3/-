const DEFAULT_TRANSPORT_CAR_SERVICE_RATE = 20;
const DEFAULT_TRANSPORT_MOTO_SERVICE_RATE = 20;
const DEFAULT_SHOP_CAR_SERVICE_RATE = 50;
const DEFAULT_SHOP_MOTO_SERVICE_RATE = 40;
const DEFAULT_SECONDARY_UPDATE_MANIFEST_URL = 'https://raw.githubusercontent.com/singvichai3/-/main/update-secondary.json';
const SECONDARY_EXCEL_AUTO_BACKUP_DEBOUNCE_MS = 60 * 1000;
const SECONDARY_EXCEL_AUTO_BACKUP_INTERVAL_MS = 5 * 60 * 1000;

const State = {
  manualEntries: [],
  tableMeta: { stationName: '', documentDate: '', appointmentDate: '', addCount: 10, deleteCount: 1, printLayout: 'auto', printStyle: { mainTitleFontPx: 9, headerLabelFontPx: 9, headerValueFontPx: 9, subTitleFontPx: 10, tableBodyFontPx: 8, summaryFontPx: 8, tableWidthPct: 100, verticalScalePct: 100 } },
  tableLastValidation: null,
  connection: { host: '', port: 39730, roomCode: '', name: '', clientId: '', connected: false },
  settings: { shopName: 'รับเล่มรถ ตรอ.', province: '', backupDir: '', transportCarRate: DEFAULT_TRANSPORT_CAR_SERVICE_RATE, transportMotoRate: DEFAULT_TRANSPORT_MOTO_SERVICE_RATE, shopCarRate: DEFAULT_SHOP_CAR_SERVICE_RATE, shopMotoRate: DEFAULT_SHOP_MOTO_SERVICE_RATE },
  isSavingTableDraft: false,
  settingsLoaded: false,
  settingsLoadPromise: null,
  settingsSaveTimer: null,
  connectionMonitor: { timer: null, busy: false, lastOkAt: '', lastError: '', consecutiveFailures: 0 },
  hasAutoCheckedUpdates: false,
  updateBusy: false,
  tableSelectedRows: new Set(),
  tableSearchQuery: '',
  tableSearchTimer: null,
  currentView: 'table',
  troImportPreview: null,
  excelAutoBackup: { dirty: false, timer: null, interval: null, busy: false, lastSignature: '', lastSuccessAt: '', lastError: '' }
};

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}

function parseMoney(value) {
  const n = Number(String(value || '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

function formatCurrency(value) {
  return Number(value || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function normalizeServiceRate(value, fallback) {
  const text = String(value ?? '').replace(/,/g, '').trim();
  if (!text) return fallback;
  const number = Number(text);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Math.min(99999, Math.round(number * 100) / 100);
}

function getSecondaryServiceRates() {
  return {
    transportCarRate: normalizeServiceRate(State.settings.transportCarRate, DEFAULT_TRANSPORT_CAR_SERVICE_RATE),
    transportMotoRate: normalizeServiceRate(State.settings.transportMotoRate, DEFAULT_TRANSPORT_MOTO_SERVICE_RATE),
    shopCarRate: normalizeServiceRate(State.settings.shopCarRate, DEFAULT_SHOP_CAR_SERVICE_RATE),
    shopMotoRate: normalizeServiceRate(State.settings.shopMotoRate, DEFAULT_SHOP_MOTO_SERVICE_RATE)
  };
}

function applySecondaryServiceRates(raw = {}) {
  State.settings.transportCarRate = normalizeServiceRate(raw.transportCarRate, DEFAULT_TRANSPORT_CAR_SERVICE_RATE);
  State.settings.transportMotoRate = normalizeServiceRate(raw.transportMotoRate, DEFAULT_TRANSPORT_MOTO_SERVICE_RATE);
  State.settings.shopCarRate = normalizeServiceRate(raw.shopCarRate, DEFAULT_SHOP_CAR_SERVICE_RATE);
  State.settings.shopMotoRate = normalizeServiceRate(raw.shopMotoRate, DEFAULT_SHOP_MOTO_SERVICE_RATE);
}

function getSecondarySettingsPayload(extra = {}) {
  return {
    ...State.connection,
    clientName: document.getElementById('client-name-input')?.value || 'โต๊ะพิมพ์ข้อมูล',
    stationName: State.tableMeta.stationName || State.settings.shopName || 'รับเล่มรถ ตรอ.',
    province: State.settings.province || '',
    backupDir: State.settings.backupDir || '',
    ...getSecondaryServiceRates(),
    printLayout: State.tableMeta.printLayout,
    printStyle: State.tableMeta.printStyle,
    ...extra
  };
}

function scheduleSecondarySettingsPersist(extra = {}) {
  if (State.settingsSaveTimer) clearTimeout(State.settingsSaveTimer);
  State.settingsSaveTimer = setTimeout(() => {
    State.settingsSaveTimer = null;
    persistSecondaryUiSettings(extra).catch((error) => {
      showNotification(`⚠️ บันทึกตั้งค่าอัตโนมัติไม่สำเร็จ: ${error.message}`, 'warning', 5000);
    });
  }, 450);
}

function buildSecondaryExcelPayload() {
  return {
    rows: State.manualEntries,
    tableMeta: State.tableMeta,
    settings: {
      stationName: State.settings.shopName || State.tableMeta.stationName,
      transportCarRate: State.settings.transportCarRate,
      transportMotoRate: State.settings.transportMotoRate,
      shopCarRate: State.settings.shopCarRate,
      shopMotoRate: State.settings.shopMotoRate,
      backupDir: State.settings.backupDir || '',
      province: State.settings.province
    }
  };
}

function hasSecondaryTableData() {
  return State.manualEntries.some(row => String(row?.plate || '').trim().length > 0);
}

async function autoBackupSecondaryTable(reason = 'manual') {
  if (typeof api.autoBackupSecondaryExcel !== 'function') return { success: false, skipped: true, error: 'ไม่มีระบบสำรอง Excel' };
  if (!hasSecondaryTableData()) return { success: false, skipped: true, error: 'ไม่มีข้อมูลในตาราง' };
  const result = await api.autoBackupSecondaryExcel({ ...buildSecondaryExcelPayload(), reason });
  if (!result?.success) throw new Error(result?.error || 'สำรอง Excel ไม่สำเร็จ');
  State.excelAutoBackup.lastSignature = getSecondaryExcelBackupSignature();
  State.excelAutoBackup.lastSuccessAt = new Date().toISOString();
  State.excelAutoBackup.lastError = '';
  State.excelAutoBackup.dirty = false;
  return result;
}

function getSecondaryExcelBackupSignature() {
  const rows = State.manualEntries
    .filter(row => String(row?.plate || '').trim().length > 0)
    .map(row => ({
      plate: String(row.plate || '').trim(),
      type: row.type === 'จยย' ? 'จยย' : 'รย',
      taxAmount: String(row.taxAmount || '').trim(),
      note: String(row.note || '').trim(),
      brand: String(row.brand || '').trim(),
      province: String(row.province || '').trim()
    }));
  return JSON.stringify({
    rows,
    stationName: State.tableMeta.stationName || '',
    documentDate: State.tableMeta.documentDate || '',
    appointmentDate: State.tableMeta.appointmentDate || '',
    rates: getSecondaryServiceRates()
  });
}

function clearSecondaryExcelAutoBackupTimer() {
  if (State.excelAutoBackup.timer) {
    clearTimeout(State.excelAutoBackup.timer);
    State.excelAutoBackup.timer = null;
  }
}

function resetSecondaryExcelAutoBackupDirtyState() {
  clearSecondaryExcelAutoBackupTimer();
  State.excelAutoBackup.dirty = false;
  State.excelAutoBackup.lastSignature = hasSecondaryTableData() ? getSecondaryExcelBackupSignature() : '';
}

function markSecondaryTableDirtyForAutoBackup(reason = 'table-edit') {
  State.excelAutoBackup.dirty = true;
  clearSecondaryExcelAutoBackupTimer();
  State.excelAutoBackup.timer = setTimeout(() => {
    State.excelAutoBackup.timer = null;
    runSecondaryExcelAutoBackupIfNeeded(reason).catch(() => {});
  }, SECONDARY_EXCEL_AUTO_BACKUP_DEBOUNCE_MS);
}

async function runSecondaryExcelAutoBackupIfNeeded(reason = 'timer') {
  if (State.excelAutoBackup.busy || !State.excelAutoBackup.dirty || !hasSecondaryTableData()) return { skipped: true };
  const signature = getSecondaryExcelBackupSignature();
  if (!signature || signature === State.excelAutoBackup.lastSignature) {
    State.excelAutoBackup.dirty = false;
    return { skipped: true };
  }
  State.excelAutoBackup.busy = true;
  try {
    return await autoBackupSecondaryTable(`auto-${reason}`);
  } catch (error) {
    State.excelAutoBackup.lastError = error.message;
    showNotification(`⚠️ สำรอง Excel อัตโนมัติไม่สำเร็จ: ${error.message}`, 'warning', 7000);
    throw error;
  } finally {
    State.excelAutoBackup.busy = false;
  }
}

function startSecondaryExcelAutoBackupTimer() {
  if (State.excelAutoBackup.interval) return;
  State.excelAutoBackup.interval = setInterval(() => {
    runSecondaryExcelAutoBackupIfNeeded('5min').catch(() => {});
  }, SECONDARY_EXCEL_AUTO_BACKUP_INTERVAL_MS);
}


function normalizePortValue(value, fallback = 39730) {
  const port = Number(String(value || '').replace(/\D/g, ''));
  if (!Number.isInteger(port) || port < 1 || port > 65535) return fallback;
  return port;
}

function getManualMainPort(fallback = 39730) {
  const value = document.getElementById('main-port-input')?.value || '';
  if (!String(value).trim()) return null;
  return normalizePortValue(value, fallback);
}

function formatDate(value) {
  if (!value) return '-';
  try {
    return new Intl.DateTimeFormat('th-TH-u-ca-buddhist', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
  } catch {
    return String(value);
  }
}

function showNotification(message, type = 'info', duration = 3500) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = `show ${type}`;
  if (toast._timer) clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.className = ''; toast._timer = null; }, duration);
}

function setSecondaryUpdateStatus(message, type = 'muted') {
  const el = document.getElementById('secondary-update-status');
  if (!el) return;
  el.textContent = message;
  el.dataset.type = type;
}

async function checkSecondaryUpdatesManual() {
  await runSecondaryUpdateCheck({ manual: true, allowPrompt: true });
}

async function runSecondaryUpdateCheck({ manual = false, allowPrompt = true } = {}) {
  if (State.updateBusy) return;
  State.updateBusy = true;
  setSecondaryUpdateStatus('กำลังตรวจอัปเดต...', 'progress');
  try {
    const result = await api.checkSecondaryUpdates({ manifestUrl: DEFAULT_SECONDARY_UPDATE_MANIFEST_URL });
    const versionText = result?.currentVersion ? `v${result.currentVersion}` : '';
    if (!result?.available) {
      setSecondaryUpdateStatus(`ล่าสุดแล้ว ${versionText}`.trim(), 'success');
      if (manual) showNotification('✅ เครื่องรองเป็นเวอร์ชันล่าสุดแล้ว', 'success');
      return;
    }

    setSecondaryUpdateStatus(`มีอัปเดต v${result.latestVersion}`, 'warning');
    if (!allowPrompt) return;

    const confirmation = typeof api.confirmDialog === 'function'
      ? await api.confirmDialog({
          title: `พบอัปเดตเครื่องรอง v${result.latestVersion}`,
          message: 'ต้องการดาวน์โหลดและติดตั้งตอนนี้หรือไม่?',
          detail: result.notes || '',
          buttons: ['ดาวน์โหลดและติดตั้ง', 'ยกเลิก'],
          defaultId: 1,
          cancelId: 1
        })
      : { confirmed: false };
    if (!confirmation.confirmed) return;

    setSecondaryUpdateStatus(`กำลังดาวน์โหลด v${result.latestVersion}`, 'progress');
    showNotification('กำลังดาวน์โหลดอัปเดตเครื่องรอง...', 'info', 6000);
    await api.downloadAndInstallSecondaryUpdate({ manifestUrl: DEFAULT_SECONDARY_UPDATE_MANIFEST_URL });
    setSecondaryUpdateStatus(`เปิดตัวติดตั้ง v${result.latestVersion} แล้ว`, 'success');
  } catch (error) {
    setSecondaryUpdateStatus(`อัปเดตไม่สำเร็จ: ${error.message}`, 'danger');
    if (manual) showNotification(`❌ อัปเดตเครื่องรองไม่สำเร็จ: ${error.message}`, 'error', 8000);
  } finally {
    State.updateBusy = false;
  }
}

function setupSecondaryUpdateProgressListener() {
  if (typeof api.onSecondaryUpdateDownloadProgress !== 'function') return;
  api.onSecondaryUpdateDownloadProgress((progress = {}) => {
    const suffix = typeof progress.percent === 'number'
      ? `${progress.percent}%`
      : `${Math.round(Number(progress.downloadedBytes || 0) / 1024 / 1024)} MB`;
    setSecondaryUpdateStatus(`กำลังดาวน์โหลด v${progress.version || ''} ${suffix}`.trim(), 'progress');
  });
}

async function autoCheckSecondaryUpdatesOnStartup() {
  if (State.hasAutoCheckedUpdates) return;
  State.hasAutoCheckedUpdates = true;
  await runSecondaryUpdateCheck({ manual: false, allowPrompt: true });
}

function createEmptyManualEntryRow() {
  return { id: generateUUID(), plate: '', type: 'รย', taxAmount: '', note: '', brand: '', province: State.settings.province || 'เชียงราย' };
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function getTodayIsoDate() {
  return todayIso();
}

function formatDateForDisplay(isoDate) {
  return window.RendererTableDomainModule.formatDateForDisplay({}, isoDate);
}

function parseDisplayDateToIso(value) {
  return window.RendererTableDomainModule.parseDisplayDateToIso({}, value);
}

function createDefaultTableMeta() {
  return window.RendererTableDomainModule.createDefaultTableMeta({ State, getTodayIsoDate });
}

function getCurrentPersistentPrintMeta() {
  return {
    stationName: State.tableMeta.stationName || State.settings.shopName || 'รับเล่มรถ ตรอ.',
    printLayout: ['auto','half-left','full-page'].includes(String(State.tableMeta.printLayout || '')) ? State.tableMeta.printLayout : 'auto',
    printStyle: State.tableMeta.printStyle && typeof State.tableMeta.printStyle === 'object'
      ? { ...State.tableMeta.printStyle }
      : null
  };
}

function createDefaultTableMetaPreservingPrintSettings() {
  const previous = getCurrentPersistentPrintMeta();
  const next = createDefaultTableMeta();
  next.stationName = previous.stationName || next.stationName;
  next.printLayout = previous.printLayout || next.printLayout;
  if (previous.printStyle) next.printStyle = { ...next.printStyle, ...previous.printStyle };
  return next;
}

function setConnectionStatus(text, online = false, detail = '') {
  const el = document.getElementById('connection-status');
  if (!el) return;
  el.textContent = text;
  el.title = detail || text;
  el.classList.toggle('online', online);
}

async function loadSecondarySettings() {
  try {
    const saved = await api.loadSecondarySettings();
    const roomInput = document.getElementById('room-code-input');
    const clientInput = document.getElementById('client-name-input');
    const portInput = document.getElementById('main-port-input');
    const clientId = saved.clientId || `sec-${generateUUID().replace(/-/g, '').slice(0, 16)}`;
    if (roomInput) roomInput.value = saved.roomCode || '';
    if (clientInput) clientInput.value = saved.clientName || 'โต๊ะพิมพ์ข้อมูล';
    if (portInput) portInput.value = saved.port ? String(normalizePortValue(saved.port || 39730)) : '';
    State.tableMeta.stationName = saved.stationName || State.tableMeta.stationName || State.settings.shopName || 'รับเล่มรถ ตรอ.';
    State.settings.shopName = State.tableMeta.stationName;
    State.settings.province = String(saved.province || State.settings.province || '').trim();
    State.settings.backupDir = String(saved.backupDir || '').trim();
    applySecondaryServiceRates(saved);
    State.tableMeta.printLayout = ['auto','half-left','full-page'].includes(String(saved.printLayout || '')) ? saved.printLayout : State.tableMeta.printLayout;
    if (saved.printStyle && typeof saved.printStyle === 'object') State.tableMeta.printStyle = { ...State.tableMeta.printStyle, ...saved.printStyle };
    State.connection = { ...State.connection, host: saved.host || State.connection.host, port: saved.port || State.connection.port, roomCode: saved.roomCode || State.connection.roomCode, name: saved.name || State.connection.name, clientId };
    if (!saved.clientId) await api.saveSecondarySettings(getSecondarySettingsPayload({ ...saved, clientId, clientName: saved.clientName || 'โต๊ะพิมพ์ข้อมูล' }));
    if (saved.host) {
      State.connection = { ...State.connection, ...saved, clientId, connected: false };
      setConnectionStatus(`จำเครื่องหลักไว้: ${saved.host}:${saved.port || 39730}`, false);
      startConnectionMonitor();
    }
  } catch (error) {
    showNotification(`โหลดค่าการเชื่อมต่อไม่ได้: ${error.message}`, 'warning');
  } finally {
    State.settingsLoaded = true;
  }
}

async function ensureSecondarySettingsLoaded() {
  if (State.settingsLoaded) return;
  if (!State.settingsLoadPromise) {
    State.settingsLoadPromise = loadSecondarySettings().finally(() => {
      State.settingsLoadPromise = null;
    });
  }
  await State.settingsLoadPromise;
}

async function ensureClientId() {
  await ensureSecondarySettingsLoaded();
  if (State.connection.clientId) return State.connection.clientId;
  const clientId = `sec-${generateUUID().replace(/-/g, '').slice(0, 16)}`;
  const clientName = document.getElementById('client-name-input')?.value || 'โต๊ะพิมพ์ข้อมูล';
  State.connection.clientId = clientId;
  await api.saveSecondarySettings(getSecondarySettingsPayload({ clientId, clientName }));
  return clientId;
}

async function discoverMainByRoom() {
  await ensureSecondarySettingsLoaded();
  const roomCode = document.getElementById('room-code-input')?.value || '';
  const clientName = document.getElementById('client-name-input')?.value || 'โต๊ะพิมพ์ข้อมูล';
  try {
    const clientId = await ensureClientId();
    setConnectionStatus('กำลังค้นหาเครื่องหลัก...', false);
    const found = await api.discoverMainByRoom({ roomCode, timeoutMs: 5000 });
    const manualPort = getManualMainPort(found.port || 39730);
    const port = manualPort || found.port || 39730;
    State.connection = { host: found.host, port, roomCode: found.roomCode, name: found.name, clientId, connected: true };
    await api.saveSecondarySettings(getSecondarySettingsPayload({ clientName }));
    State.connectionMonitor.consecutiveFailures = 0;
    State.connectionMonitor.lastOkAt = new Date().toISOString();
    const portInput = document.getElementById('main-port-input');
    if (portInput) portInput.value = String(port);
    setConnectionStatus(`ออนไลน์: ${found.name || 'เครื่องหลัก'} ${found.host}:${port}`, true, `เจอเครื่องหลักล่าสุด ${new Date().toLocaleTimeString('th-TH')}`);
    startConnectionMonitor();
    showNotification('✅ เจอเครื่องหลักและเชื่อมต่อสำเร็จ', 'success');
  } catch (error) {
    State.connection.connected = false;
    setConnectionStatus('ค้นหาไม่เจอ', false);
    showNotification(`❌ ค้นหาเครื่องหลักไม่เจอ: ${error.message}`, 'error', 6500);
  }
}

async function testConnection(showToast = true) {
  await ensureSecondarySettingsLoaded();
  const roomCode = document.getElementById('room-code-input')?.value || State.connection.roomCode;
  const clientName = document.getElementById('client-name-input')?.value || 'โต๊ะพิมพ์ข้อมูล';
  try {
    const clientId = await ensureClientId();
    const manualPort = getManualMainPort(State.connection.port || 39730);
    const port = manualPort || State.connection.port || 39730;
    const result = await api.testMainConnection(getSecondarySettingsPayload({ port, roomCode, clientName, clientId }));
    State.connection.port = port;
    State.connection.connected = true;
    State.connection.name = result.name || State.connection.name || 'เครื่องหลัก';
    State.connectionMonitor.consecutiveFailures = 0;
    State.connectionMonitor.lastError = '';
    State.connectionMonitor.lastOkAt = new Date().toISOString();
    const lastText = new Date().toLocaleTimeString('th-TH');
    const portInput = document.getElementById('main-port-input');
    if (portInput) portInput.value = String(State.connection.port || result.port || 39730);
    await api.saveSecondarySettings(getSecondarySettingsPayload({ roomCode, clientName, clientId }));
    setConnectionStatus(`ออนไลน์: ${result.name || 'เครื่องหลัก'} • ล่าสุด ${lastText}`, true, `${State.connection.host || result.recommendedAddress}:${State.connection.port || result.port || 39730}`);
    if (showToast) showNotification('✅ เครื่องหลักพร้อมใช้งาน', 'success');
    return true;
  } catch (error) {
    State.connection.connected = false;
    State.connectionMonitor.consecutiveFailures += 1;
    State.connectionMonitor.lastError = error.message;
    if (error.blocked) {
      setConnectionStatus('ถูกตัดการเชื่อมต่อจากเครื่องหลัก', false, error.message);
      if (showToast) showNotification(`⛔ ${error.message}`, 'error', 8000);
      return false;
    }
    setConnectionStatus(`หลุดการเชื่อมต่อ (${State.connectionMonitor.consecutiveFailures})`, false, error.message);
    if (showToast) showNotification(`❌ เชื่อมต่อไม่ได้: ${error.message}`, 'error', 6500);
    return false;
  }
}

function startConnectionMonitor() {
  if (State.connectionMonitor.timer) clearTimeout(State.connectionMonitor.timer);
  if (!State.connection.host) return;
  const loop = async () => {
    if (State.connectionMonitor.busy) {
      return;
    }
    State.connectionMonitor.busy = true;
    try {
      await testConnection(false);
    } finally {
      State.connectionMonitor.busy = false;
    }
    if (State.connection.host) {
      State.connectionMonitor.timer = setTimeout(loop, 5000);
    }
  };
  State.connectionMonitor.timer = setTimeout(loop, 500);
}

function syncTableMetaInputs() {
  const map = {
    'table-document-date': formatDateForDisplay(State.tableMeta.documentDate),
    'table-appointment-date': formatDateForDisplay(State.tableMeta.appointmentDate),
    'table-add-count': String(State.tableMeta.addCount || 1),
    'table-delete-count': String(State.tableMeta.deleteCount || 1)
  };
  for (const [id, value] of Object.entries(map)) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (el.tagName === 'BUTTON') el.textContent = value || 'DD/MM/YYYY';
    else el.value = value || '';
  }
  const nativeInputs = {
    'table-document-date-picker': State.tableMeta.documentDate,
    'table-appointment-date-picker': State.tableMeta.appointmentDate
  };
  for (const [id, value] of Object.entries(nativeInputs)) {
    const el = document.getElementById(id);
    if (el) el.value = value || '';
  }
  const stationDisplay = document.getElementById('table-station-name-display');
  if (stationDisplay) stationDisplay.textContent = State.tableMeta.stationName || State.settings.shopName || 'รับเล่มรถ ตรอ.';
  syncSecondarySettingsInputs();
}

function syncSecondarySettingsInputs() {
  const rates = getSecondaryServiceRates();
  const values = {
    'settings-station-name': State.tableMeta.stationName || State.settings.shopName || 'รับเล่มรถ ตรอ.',
    'settings-default-province': State.settings.province || '',
    'settings-backup-dir': State.settings.backupDir || 'ค่าเริ่มต้นของโปรแกรม',
    'settings-transport-car-rate': rates.transportCarRate,
    'settings-transport-moto-rate': rates.transportMotoRate,
    'settings-shop-car-rate': rates.shopCarRate,
    'settings-shop-moto-rate': rates.shopMotoRate
  };
  Object.entries(values).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el) el.value = String(value ?? '');
  });
}

function syncMetaInputs() { syncTableMetaInputs(); syncPrintLayoutControls(); syncBulkEditInput(); }

function syncBulkEditInput() {
  const field = document.getElementById('bulk-edit-field')?.value || 'brand';
  const input = document.getElementById('bulk-edit-value');
  if (!input) return;
  input.removeAttribute('list');
  if (field === 'province') { input.setAttribute('list', 'province-options'); input.placeholder = 'พิมพ์ค้นหาจังหวัด'; }
  else if (field === 'type') input.placeholder = 'ใส่ รย หรือ จยย';
  else if (field === 'taxAmount') input.placeholder = 'ใส่ตัวเลข เช่น 3500';
  else if (field === 'plate') input.placeholder = 'ทะเบียนที่ต้องการแทน';
  else if (field === 'note') input.placeholder = 'หมายเหตุที่ต้องการใส่';
  else input.placeholder = 'ค่าที่ต้องการใส่ให้บรรทัดที่เลือก';
}

function openTableDatePicker(field) {
  const inputId = field === 'appointmentDate' ? 'table-appointment-date-picker' : 'table-document-date-picker';
  const input = document.getElementById(inputId);
  if (!input) return;
  if (typeof input.showPicker === 'function') input.showPicker(); else input.click();
}

function applyTableDateFromPicker(field, value) { updateTableMetaField(field, value); }

function getSelectedTableRowIndexes() {
  return Array.from(State.tableSelectedRows)
    .map(Number)
    .filter((value) => Number.isInteger(value) && value >= 0 && value < State.manualEntries.length)
    .sort((left, right) => left - right);
}

function syncTableSelectionState() {
  const validIndexes = new Set(getSelectedTableRowIndexes());
  State.tableSelectedRows = validIndexes;
  const selectAll = document.getElementById('table-select-all');
  if (selectAll) {
    const selectedCount = validIndexes.size;
    selectAll.checked = State.manualEntries.length > 0 && selectedCount === State.manualEntries.length;
    selectAll.indeterminate = selectedCount > 0 && selectedCount < State.manualEntries.length;
  }
}

function getTableValidationResult() { return window.RendererTableDomainModule.validateManualEntries({ State, parseMoney }); }
function getVisibleManualEntryIndexes() { return window.RendererTableDomainModule.getManualEntrySearchIndexes({ State }, State.tableSearchQuery); }
function getManualEntryRowStatus(validationResult, index) { return window.RendererTableDomainModule.getManualEntryRowStatus({ validationResult }, index); }

function renderTableAssistPanel(validationResult = null) {
  const result = validationResult || getTableValidationResult();
  const statusEl = document.getElementById('table-validation-status');
  const searchMetaEl = document.getElementById('table-search-meta');
  const floatingEl = document.getElementById('table-floating-summary');
  const summary = calculateTableSummary();
  const visibleCount = getVisibleManualEntryIndexes().length;
  const totalCount = State.manualEntries.length;
  const selectedCount = getSelectedTableRowIndexes().length;
  if (statusEl) {
    const tone = result.errorCount > 0 ? 'error' : (result.warningCount > 0 ? 'warning' : 'success');
    statusEl.className = `table-validation-status ${tone}`;
    statusEl.textContent = result.errorCount > 0 ? `พบข้อมูลต้องแก้ ${result.errorCount} จุด • กดดูแถวสีแดง/ส้ม` : (result.warningCount > 0 ? `มีคำเตือน ${result.warningCount} จุด แต่ยังบันทึกได้ถ้าไม่ติด error` : `ข้อมูลที่กรอก ${result.filledCount} แถวพร้อมใช้งาน`);
  }
  if (searchMetaEl) searchMetaEl.textContent = State.tableSearchQuery ? `พบ ${visibleCount.toLocaleString()} จาก ${totalCount.toLocaleString()} แถว` : 'ค้นทะเบียน จังหวัด ยี่ห้อ หมายเหตุ หรือเลขแถว';
  if (floatingEl) {
    floatingEl.innerHTML = `<span>รย. <strong>${summary.carCount}</strong> คัน</span><span>จยย. <strong>${summary.motorcycleCount}</strong> คัน</span><span>ภาษี <strong>${formatCurrency(summary.taxTotal)}</strong></span><span>ค่าขนส่ง <strong>${formatCurrency(summary.serviceTotal)}</strong></span><span class="grand">รวม <strong>${formatCurrency(summary.grandTotal)}</strong></span>${selectedCount ? `<span>เลือก <strong>${selectedCount}</strong> แถว</span>` : ''}`;
  }
}

function renderTableSummary() {
  const summary = calculateTableSummary();
  const taxEl = document.getElementById('summary-tax-total');
  const serviceEl = document.getElementById('summary-service-total');
  const grandEl = document.getElementById('summary-grand-total');
  const breakdownEl = document.getElementById('summary-service-breakdown');
  if (taxEl) taxEl.textContent = formatCurrency(summary.taxTotal);
  if (serviceEl) serviceEl.textContent = formatCurrency(summary.serviceTotal);
  if (grandEl) grandEl.textContent = formatCurrency(summary.grandTotal);
  if (breakdownEl) breakdownEl.textContent = `รย. ${summary.carCount} คัน × ${summary.transportCarRate} | จยย. ${summary.motorcycleCount} คัน × ${summary.transportMotoRate}`;
  renderTableAssistPanel();
}

function updateManualEntryCount() {
  const badge = document.getElementById('manual-entry-count');
  if (!badge) return;
  const selectedCount = getSelectedTableRowIndexes().length;
  badge.textContent = `${State.manualEntries.length.toLocaleString()} บรรทัด${selectedCount > 0 ? ` • เลือก ${selectedCount}` : ''}`;
}

function renderTable() { renderManualEntryTable(); }

function renderManualEntryTable() {
  const tbody = document.getElementById('manual-entry-body');
  if (!tbody) return;
  const validationResult = getTableValidationResult();
  State.tableLastValidation = validationResult;
  const visibleIndexes = getVisibleManualEntryIndexes();
  if (visibleIndexes.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty-state">ไม่พบแถวที่ตรงกับคำค้นหา</td></tr>';
  } else {
    tbody.innerHTML = visibleIndexes.map((index) => {
      const row = State.manualEntries[index] || createEmptyManualEntryRow();
      const status = getManualEntryRowStatus(validationResult, index);
      const rowType = row.type === 'จยย' ? 'จยย' : 'รย';
      const rowIssues = [...(validationResult.byIndex[index]?.errors || []), ...(validationResult.byIndex[index]?.warnings || [])];
      const issueText = rowIssues.map((issue) => issue.message).join(' | ');
      return `<tr class="entry-row status-${status}" data-row-index="${index}">
        <td class="selection-cell"><input type="checkbox" ${State.tableSelectedRows.has(index) ? 'checked' : ''} onchange="toggleTableRowSelection(${index}, this.checked)"></td>
        <td class="sequence-cell"><span>${index + 1}</span>${issueText ? `<small title="${escapeHTML(issueText)}">!</small>` : ''}</td>
        <td><input type="text" value="${escapeHTML(row.plate)}" oninput="updateManualEntryField(${index}, 'plate', this.value)" placeholder="เช่น 1กข 1234"></td>
        <td class="radio-cell"><input type="radio" name="table-type-${index}" ${rowType === 'รย' ? 'checked' : ''} onchange="updateManualEntryField(${index}, 'type', 'รย')"></td>
        <td class="radio-cell"><input type="radio" name="table-type-${index}" ${rowType === 'จยย' ? 'checked' : ''} onchange="updateManualEntryField(${index}, 'type', 'จยย')"></td>
        <td><input class="numeric-input" type="number" min="0" step="0.01" value="${escapeHTML(row.taxAmount)}" oninput="updateManualEntryField(${index}, 'taxAmount', this.value)" placeholder="0.00"></td>
        <td><input type="text" value="${escapeHTML(row.note)}" oninput="updateManualEntryField(${index}, 'note', this.value)" placeholder="หมายเหตุ"></td>
        <td><input type="text" value="${escapeHTML(row.brand)}" oninput="updateManualEntryField(${index}, 'brand', this.value)" placeholder="ยี่ห้อ"></td>
        <td><input type="text" list="province-options" value="${escapeHTML(row.province)}" oninput="updateManualEntryField(${index}, 'province', this.value)" placeholder="พิมพ์ค้นหาจังหวัด"></td>
        <td class="delete-cell"><button class="btn btn-sm" type="button" onclick="removeManualEntryRow(${index})">ลบ</button></td>
      </tr>`;
    }).join('');
  }
  syncTableSelectionState(); updateManualEntryCount(); renderTableSummary(); renderTableAssistPanel(validationResult);
}

function addManualEntryRows(count = 1) { const n = Math.max(1, Number(count) || 1); for (let i = 0; i < n; i++) State.manualEntries.push(createEmptyManualEntryRow()); renderManualEntryTable(); markSecondaryTableDirtyForAutoBackup('add-row'); }
function addTableRows() { addManualEntryRows(State.tableMeta.addCount || 1); }
function setTableAddCount(value) { State.tableMeta.addCount = Math.max(1, Number(value) || 1); syncTableMetaInputs(); }
function setTableDeleteCount(value) { State.tableMeta.deleteCount = Math.max(1, Number(value) || 1); syncTableMetaInputs(); }
function deleteTableRowsByCount() { const deleteCount = Math.max(1, Number(State.tableMeta.deleteCount) || 1); if (State.manualEntries.length === 0) return; const nextLength = Math.max(1, State.manualEntries.length - deleteCount); State.manualEntries = State.manualEntries.slice(0, nextLength); State.tableSelectedRows = new Set(Array.from(State.tableSelectedRows).filter((index) => Number(index) < nextLength)); renderManualEntryTable(); markSecondaryTableDirtyForAutoBackup('delete-row'); }
function deleteLastManualEntryRows() { deleteTableRowsByCount(); }
function resetManualEntryTable(render = true) { State.tableMeta = createDefaultTableMetaPreservingPrintSettings(); State.manualEntries = Array.from({ length: 10 }, () => createEmptyManualEntryRow()); State.tableSelectedRows = new Set(); State.tableSearchQuery = ''; State.tableLastValidation = null; resetSecondaryExcelAutoBackupDirtyState(); const searchInput = document.getElementById('table-search-input'); if (searchInput) searchInput.value = ''; if (render) { syncTableMetaInputs(); syncPrintLayoutControls(); renderManualEntryTable(); } }

async function startNewDay() {
  if (typeof api.confirmDialog !== 'function') {
    showNotification('❌ ไม่สามารถแสดงหน้าต่างยืนยันได้', 'error');
    return;
  }
  const hasData = hasSecondaryTableData();
  let autoBackupDone = false;
  if (hasData) {
    const confirm = await api.confirmDialog({
      title: 'เริ่มวันใหม่',
      message: 'ตารางปัจจุบันมีข้อมูลอยู่ ต้องการสำรองข้อมูลเป็น Excel อัตโนมัติก่อนเริ่มวันใหม่หรือไม่?',
      detail: 'ข้อมูลจะถูกล้างออกหลังสำรองแล้ว • ตั้งค่าการพิมพ์และร้านจะยังคงอยู่',
      buttons: ['สำรองแล้วเริ่มวันใหม่', 'เริ่มวันใหม่โดยไม่สำรอง', 'ยกเลิก'],
      defaultId: 0,
      cancelId: 2
    });
    if (confirm.response === 2) return;
    if (confirm.response === 0) {
      try {
        const backupResult = await autoBackupSecondaryTable('start-new-day');
        autoBackupDone = true;
        showNotification(`✅ สำรองข้อมูล Excel แล้ว: ${backupResult.backup.fileName}`, 'success', 5000);
      } catch (error) {
        showNotification(`❌ สำรองข้อมูลไม่สำเร็จ: ${error.message} — ยังไม่ล้างรายการ กรุณาลองใหม่หรือเลือก “เริ่มวันใหม่โดยไม่สำรอง”`, 'error', 9000);
        return;
      }
    }
  } else {
    const confirm = await api.confirmDialog({
      title: 'เริ่มวันใหม่',
      message: 'ต้องการเริ่มวันใหม่ใช่หรือไม่?',
      detail: 'ตารางจะถูกล้าง • ตั้งค่าการพิมพ์และร้านจะยังคงอยู่',
      buttons: ['เริ่มวันใหม่', 'ยกเลิก'],
      defaultId: 0,
      cancelId: 1
    });
    if (!confirm.confirmed) return;
  }

  State.tableMeta = createDefaultTableMetaPreservingPrintSettings();
  State.manualEntries = Array.from({ length: 10 }, () => createEmptyManualEntryRow());
  State.tableSelectedRows = new Set();
  State.tableSearchQuery = '';
  State.tableLastValidation = null;
  const searchInput = document.getElementById('table-search-input');
  if (searchInput) searchInput.value = '';
  syncTableMetaInputs();
  syncPrintLayoutControls();
  renderManualEntryTable();
  resetSecondaryExcelAutoBackupDirtyState();
  showNotification('✅ เริ่มวันใหม่แล้ว' + (autoBackupDone ? ' (สำรองข้อมูลแล้ว)' : ''), 'success');
  restoreSecondaryTableInteraction({ select: true });
}

async function exportExcelBackup() {
  if (typeof api.exportSecondaryExcel !== 'function') {
    showNotification('❌ ไม่สามารถส่งออก Excel ได้', 'error');
    return;
  }
  try {
    const result = await api.exportSecondaryExcel(buildSecondaryExcelPayload());
    if (!result) return;
    showNotification(`✅ ส่งออก Excel แล้วที่: ${result.path} (${(result.bytes / 1024).toFixed(1)} KB)`, 'success', 6000);
  } catch (error) {
    showNotification(`❌ ส่งออก Excel ไม่สำเร็จ: ${error.message}`, 'error', 8000);
  }
}

function updateTableMetaField(field, value) {
  if (!Object.prototype.hasOwnProperty.call(State.tableMeta, field)) return;
  if (field === 'addCount') { State.tableMeta[field] = Math.max(1, Number(value) || 1); syncTableMetaInputs(); return; }
  if (field === 'deleteCount') { State.tableMeta[field] = Math.max(1, Number(value) || 1); syncTableMetaInputs(); return; }
  if (field === 'printLayout') { State.tableMeta[field] = ['auto','half-left','full-page'].includes(String(value)) ? String(value) : 'auto'; syncPrintLayoutControls(); if (document.getElementById('print-preview-modal')?.classList.contains('show')) renderPrintPreviewContent(); scheduleSecondarySettingsPersist(); return; }
  if (field === 'documentDate' || field === 'appointmentDate') {
    const parsedDate = parseDisplayDateToIso(value);
    if (parsedDate === null) { syncTableMetaInputs(); showNotification('❌ กรุณาใส่วันที่แบบ DD/MM/YYYY', 'error'); return; }
    State.tableMeta[field] = parsedDate; syncTableMetaInputs(); markSecondaryTableDirtyForAutoBackup(`meta-${field}`); return;
  }
  State.tableMeta[field] = value;
  markSecondaryTableDirtyForAutoBackup(`meta-${field}`);
  if (field === 'stationName') persistSecondaryUiSettings({ stationName: value }).catch(() => {});
}
function updatePrintLayout(value) { updateTableMetaField('printLayout', value || 'auto'); }
function openSecondarySettings() { syncSecondarySettingsInputs(); document.getElementById('secondary-settings-modal')?.classList.add('show'); }
function closeSecondarySettings() { document.getElementById('secondary-settings-modal')?.classList.remove('show'); }
async function chooseSecondaryBackupDir() {
  if (typeof api.selectSecondaryBackupDir !== 'function') {
    showNotification('❌ ไม่สามารถเลือกโฟลเดอร์สำรองได้', 'error');
    return;
  }
  try {
    const result = await api.selectSecondaryBackupDir(State.settings.backupDir || '');
    if (!result?.backupDir) return;
    State.settings.backupDir = result.backupDir;
    syncSecondarySettingsInputs();
    showNotification('✅ เลือกที่เก็บไฟล์สำรอง Excel แล้ว', 'success');
  } catch (error) {
    showNotification(`❌ เลือกโฟลเดอร์สำรองไม่สำเร็จ: ${error.message}`, 'error', 8000);
  }
}
function resetSecondaryBackupDir() {
  State.settings.backupDir = '';
  syncSecondarySettingsInputs();
  persistSecondaryUiSettings({ backupDir: '' })
    .then(() => showNotification('✅ กลับไปใช้ที่เก็บสำรองค่าเริ่มต้นแล้ว', 'success'))
    .catch((error) => showNotification(`⚠️ บันทึกที่เก็บสำรองไม่สำเร็จ: ${error.message}`, 'warning', 7000));
}
async function saveSecondarySettingsModal() {
  const stationName = String(document.getElementById('settings-station-name')?.value || '').trim() || 'รับเล่มรถ ตรอ.';
  const province = String(document.getElementById('settings-default-province')?.value || '').trim();
  const rates = {
    transportCarRate: normalizeServiceRate(document.getElementById('settings-transport-car-rate')?.value, DEFAULT_TRANSPORT_CAR_SERVICE_RATE),
    transportMotoRate: normalizeServiceRate(document.getElementById('settings-transport-moto-rate')?.value, DEFAULT_TRANSPORT_MOTO_SERVICE_RATE),
    shopCarRate: normalizeServiceRate(document.getElementById('settings-shop-car-rate')?.value, DEFAULT_SHOP_CAR_SERVICE_RATE),
    shopMotoRate: normalizeServiceRate(document.getElementById('settings-shop-moto-rate')?.value, DEFAULT_SHOP_MOTO_SERVICE_RATE)
  };
  State.tableMeta.stationName = stationName;
  State.settings.shopName = stationName;
  State.settings.province = province;
  applySecondaryServiceRates(rates);
  try {
    await persistSecondaryUiSettings({ stationName, province, backupDir: State.settings.backupDir || '', ...rates });
    syncMetaInputs();
    renderManualEntryTable();
    markSecondaryTableDirtyForAutoBackup('settings-rate');
    if (document.getElementById('print-preview-modal')?.classList.contains('show')) renderPrintPreviewContent();
    closeSecondarySettings();
    showNotification('✅ บันทึกตั้งค่าโปรแกรมรองแล้ว', 'success');
  } catch (error) {
    showNotification(`❌ บันทึกตั้งค่าไม่สำเร็จ: ${error.message}`, 'error', 8000);
  }
}
function updatePrintStyleSetting(key, value) { const result = window.RendererPrintPreviewModule.updatePrintStyleSetting({ State, renderPrintPreviewContent }, key, value); scheduleSecondarySettingsPersist(); return result; }
function clearTableEntryRows(preserveCount = null) { const rowCount = Math.max(1, Number(preserveCount) || State.manualEntries.length || 10); State.manualEntries = Array.from({ length: rowCount }, () => createEmptyManualEntryRow()); State.tableSelectedRows = new Set(); resetSecondaryExcelAutoBackupDirtyState(); renderManualEntryTable(); }
function buildTableRecordsForMainList() { return window.RendererTableDomainModule.buildTableRecordsForMainList({ State, generateUUID }); }
function buildPrintableTableRows() { return window.RendererTableDomainModule.buildPrintableTableRows({ State, parseMoney }); }
function calculateTableSummary() { return window.RendererTableDomainModule.calculateTableSummary({ State, parseMoney, serviceRates: getSecondaryServiceRates() }); }
function syncPrintLayoutControls() { return window.RendererPrintPreviewModule.syncPrintLayoutControls({ State, buildPrintableTableRows }); }
function syncPrintStyleStateFromControls() {
  const current = State.tableMeta.printStyle && typeof State.tableMeta.printStyle === 'object' ? { ...State.tableMeta.printStyle } : {};
  const mapping = {
    'print-main-title-font': 'mainTitleFontPx',
    'print-header-label-font': 'headerLabelFontPx',
    'print-header-value-font': 'headerValueFontPx',
    'print-sub-title-font': 'subTitleFontPx',
    'print-table-body-font': 'tableBodyFontPx',
    'print-summary-font': 'summaryFontPx',
    'print-table-width': 'tableWidthPct',
    'print-vertical-scale': 'verticalScalePct'
  };
  Object.entries(mapping).forEach(([id, key]) => {
    const input = document.getElementById(id);
    if (input && String(input.value || '').trim() !== '') current[key] = input.value;
  });
  State.tableMeta.printStyle = window.RendererPrintPreviewModule.normalizePrintStyleSettings(current);
  const layout = document.getElementById('print-layout-select')?.value;
  if (['auto','half-left','full-page'].includes(String(layout || ''))) State.tableMeta.printLayout = String(layout);
  syncPrintLayoutControls();
}
function persistSecondaryUiSettings(extra = {}) { return api.saveSecondarySettings(getSecondarySettingsPayload(extra)); }
function saveSecondaryPrintSettings() { if (State.settingsSaveTimer) { clearTimeout(State.settingsSaveTimer); State.settingsSaveTimer = null; } syncPrintStyleStateFromControls(); persistSecondaryUiSettings().then(() => showNotification('✅ บันทึกตั้งค่าการพิมพ์แล้ว', 'success')).catch((error) => showNotification(`❌ บันทึกตั้งค่าไม่สำเร็จ: ${error.message}`, 'error')); }
function renderPrintPreviewContent() { return window.RendererPrintPreviewModule.renderPrintPreviewContent({ State, escapeHTML, formatDate, formatCurrency, buildPrintableTableRows, calculateTableSummary, syncPrintLayoutControls, showShopService: true, stackedSecondaryHeader: true, omitContinuationHeader: true }); }
function openPrintPreview() { return window.RendererPrintPreviewModule.openPrintPreview({ buildPrintableTableRows, syncPrintLayoutControls, renderPrintPreviewContent, showNotification }); }
function closePrintPreview() { return window.RendererPrintPreviewModule.closePrintPreview(); }
async function confirmTablePrint() { try { await autoBackupSecondaryTable('before-print'); } catch (error) { showNotification(`⚠️ พิมพ์ต่อได้ แต่สำรอง Excel ไม่สำเร็จ: ${error.message}`, 'warning', 7000); } return window.RendererPrintPreviewModule.confirmTablePrint(); }
function finishPrintInteraction(shouldClosePreview = true) { return window.RendererPrintPreviewModule.finishPrintInteraction ? window.RendererPrintPreviewModule.finishPrintInteraction({ closePrintPreview }, shouldClosePreview) : (document.body.classList.remove('printing-active'), shouldClosePreview && closePrintPreview()); }
async function exportPrintPreviewPdf() { await autoBackupSecondaryTable('before-pdf').catch((error) => showNotification(`⚠️ บันทึก PDF ต่อได้ แต่สำรอง Excel ไม่สำเร็จ: ${error.message}`, 'warning', 7000)); return window.RendererPrintPreviewModule.exportPrintPreviewPdf({ buildPrintableTableRows, renderPrintPreviewContent, State, api, showNotification, finishPrintInteraction }); }
function updateManualEntryField(index, field, value) { if (!State.manualEntries[index]) return; State.manualEntries[index][field] = value; State.tableLastValidation = null; markSecondaryTableDirtyForAutoBackup(`field-${field}`); renderTableSummary(); renderTableAssistPanel(); }
function toggleTableRowSelection(index, checked) { if (checked) State.tableSelectedRows.add(index); else State.tableSelectedRows.delete(index); syncTableSelectionState(); updateManualEntryCount(); renderTableAssistPanel(); }
function toggleSelectAllTableRows(checked) { State.tableSelectedRows = checked ? new Set(State.manualEntries.map((_, index) => index)) : new Set(); renderManualEntryTable(); }
function applyBulkTableEdit() { const indexes = getSelectedTableRowIndexes(); if (indexes.length === 0) { showNotification('❌ กรุณาเลือกบรรทัดที่ต้องการแก้ไขก่อน', 'error'); return; } const field = document.getElementById('bulk-edit-field')?.value || 'brand'; const value = document.getElementById('bulk-edit-value')?.value ?? ''; const normalizedValue = String(value).trim(); if (field === 'type' && !['รย','จยย'].includes(normalizedValue)) { showNotification('❌ ประเภทรถต้องเป็น รย หรือ จยย', 'error'); return; } if (field === 'taxAmount' && normalizedValue && !Number.isFinite(Number(normalizedValue))) { showNotification('❌ ราคาภาษีต้องเป็นตัวเลข', 'error'); return; } indexes.forEach((index) => { if (State.manualEntries[index]) State.manualEntries[index][field] = normalizedValue; }); markSecondaryTableDirtyForAutoBackup(`bulk-${field}`); renderManualEntryTable(); showNotification(`✅ แก้ไข ${indexes.length.toLocaleString()} บรรทัดแล้ว`, 'success'); }
function removeManualEntryRow(index) { State.manualEntries.splice(index, 1); State.tableSelectedRows = new Set(getSelectedTableRowIndexes().filter((selectedIndex) => selectedIndex !== index).map((selectedIndex) => selectedIndex > index ? selectedIndex - 1 : selectedIndex)); if (State.manualEntries.length === 0) State.manualEntries.push(createEmptyManualEntryRow()); renderManualEntryTable(); markSecondaryTableDirtyForAutoBackup('remove-row'); }
function updateTableSearch(value) { State.tableSearchQuery = String(value || '').trim(); if (State.tableSearchTimer) clearTimeout(State.tableSearchTimer); State.tableSearchTimer = setTimeout(() => { State.tableSearchTimer = null; renderManualEntryTable(); }, 120); }
function clearTableSearch() { State.tableSearchQuery = ''; if (State.tableSearchTimer) { clearTimeout(State.tableSearchTimer); State.tableSearchTimer = null; } const input = document.getElementById('table-search-input'); if (input) input.value = ''; renderManualEntryTable(); }
function validateManualEntryTable(showResult = true) { const result = getTableValidationResult(); State.tableLastValidation = result; renderManualEntryTable(); const firstError = result.issues.find((issue) => issue.level === 'error'); if (firstError) { const rowEl = document.querySelector(`[data-row-index="${firstError.index}"]`); if (rowEl) rowEl.scrollIntoView({ behavior:'smooth', block:'center' }); if (showResult) showNotification(`❌ ${firstError.message}`, 'error'); return { ok:false, result, errorCount: result.errorCount, filledCount: result.filledCount }; } if (showResult) showNotification(result.warningCount > 0 ? `⚠️ ตรวจแล้ว: มีคำเตือน ${result.warningCount} จุด แต่ไม่มี error` : `✅ ตรวจแล้ว: ข้อมูลที่กรอก ${result.filledCount} แถวพร้อมบันทึก`, result.warningCount > 0 ? 'warning' : 'success'); return { ok:true, result, errorCount: result.errorCount, filledCount: result.filledCount }; }
function copyManualEntryFromAbove() { const indexes = getSelectedTableRowIndexes(); if (indexes.length === 0) { showNotification('❌ กรุณาเลือกบรรทัดที่จะคัดลอกจากแถวบนก่อน', 'error'); return; } let copied = 0; indexes.forEach((index) => { if (index <= 0 || !State.manualEntries[index] || !State.manualEntries[index - 1]) return; const prev = State.manualEntries[index - 1]; State.manualEntries[index] = { ...State.manualEntries[index], type: prev.type === 'จยย' ? 'จยย' : 'รย', taxAmount: prev.taxAmount || '', note: prev.note || '', brand: prev.brand || '', province: prev.province || '' }; copied += 1; }); if (copied > 0) markSecondaryTableDirtyForAutoBackup('copy-from-above'); renderManualEntryTable(); if (copied > 0) showNotification(`✅ คัดลอกค่าจากแถวบนแล้ว ${copied} แถว`, 'success'); else showNotification('⚠️ แถวแรกไม่มีแถวบนให้คัดลอก', 'warning'); }
function focusNextManualEntryInput(currentInput) { const inputs = Array.from(document.querySelectorAll('#manual-entry-body input[type="text"], #manual-entry-body input[type="number"]')); const index = inputs.indexOf(currentInput); const next = inputs[index + 1]; if (next) { next.focus(); if (typeof next.select === 'function') next.select(); } }
function handleTableKeyboardShortcut(event) { const target = event.target; const tagName = String(target?.tagName || '').toLowerCase(); const isEditable = ['input','select','textarea'].includes(tagName); if (event.key === 'Enter' && isEditable && target.closest?.('#manual-entry-body')) { event.preventDefault(); event.stopImmediatePropagation(); focusNextManualEntryInput(target); return; } if (!event.ctrlKey && !event.metaKey) return; const key = String(event.key || '').toLowerCase(); if (key === 's') { event.preventDefault(); event.stopImmediatePropagation(); saveTableDraft(); } else if (key === 'p') { event.preventDefault(); event.stopImmediatePropagation(); openPrintPreview(); } else if (key === 'enter') { event.preventDefault(); event.stopImmediatePropagation(); addManualEntryRows(1); } else if (key === 'd') { event.preventDefault(); event.stopImmediatePropagation(); copyManualEntryFromAbove(); } else if (key === 'f') { event.preventDefault(); event.stopImmediatePropagation(); document.getElementById('table-search-input')?.focus(); } }
document.addEventListener('keydown', handleTableKeyboardShortcut);

function getTroImportRows() {
  return Array.isArray(State.troImportPreview?.rows) ? State.troImportPreview.rows : [];
}

function getTroImportSheets() {
  return Array.isArray(State.troImportPreview?.sheets) ? State.troImportPreview.sheets : [];
}

function formatTroSheetOption(sheet = {}) {
  const dateText = sheet.sheetDate ? formatDateForDisplay(sheet.sheetDate) : sheet.sheetName;
  const countText = Number(sheet.totalRows || 0).toLocaleString('th-TH');
  const label = sheet.formatLabel || 'ไฟล์ ตรอ.';
  return `${dateText} / ${sheet.sheetName} — ${countText} รายการ (${label})`;
}

function selectTroImportSheet(sheetName) {
  const preview = State.troImportPreview;
  if (!preview) return;
  const sheet = getTroImportSheets().find((item) => item.sheetName === sheetName);
  if (!sheet) return;
  State.troImportPreview = {
    ...preview,
    ...sheet,
    fileName: preview.fileName,
    fileSize: preview.fileSize,
    importedAt: preview.importedAt,
    sheetOptions: preview.sheetOptions,
    sheets: preview.sheets
  };
  renderTroImportPreview();
}

function restoreSecondaryTableInteraction(options = {}) {
  const { target = 'first-table-input', select = false } = options || {};
  const restore = () => {
    try {
      if (typeof window.focus === 'function') window.focus();
      const selector = target === 'tro-preview'
        ? '#tro-import-preview-body input:not([disabled])'
        : '#manual-entry-body input:not([disabled]), #manual-entry-body select:not([disabled]), #bulk-edit-value, #table-add-count';
      const input = document.querySelector(selector);
      if (!input) return;
      input.removeAttribute?.('disabled');
      input.readOnly = false;
      if (input.style) input.style.pointerEvents = 'auto';
      input.focus?.({ preventScroll: true });
      if (select && typeof input.select === 'function') input.select();
    } catch (error) {
      console.warn('restoreSecondaryTableInteraction failed:', error);
    }
  };
  restore();
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(restore);
  setTimeout(restore, 90);
}

function renderTroImportPreview() {
  const preview = State.troImportPreview;
  const rows = getTroImportRows();
  const modal = document.getElementById('tro-import-modal');
  const body = document.getElementById('tro-import-preview-body');
  if (!preview || !modal || !body) return;
  const selectedReadyCount = rows.filter((row) => row.selected && row.status !== 'error').length;
  const sheets = getTroImportSheets();
  const sheetPickerWrap = document.getElementById('tro-import-sheet-picker-wrap');
  const sheetPicker = document.getElementById('tro-import-sheet-picker');
  if (sheetPickerWrap && sheetPicker) {
    sheetPickerWrap.style.display = sheets.length > 1 ? 'flex' : 'none';
    sheetPicker.innerHTML = sheets.map((sheet) => `<option value="${escapeHTML(sheet.sheetName)}" ${sheet.sheetName === preview.sheetName ? 'selected' : ''}>${escapeHTML(formatTroSheetOption(sheet))}</option>`).join('');
  }
  const setText = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = String(value); };
  setText('tro-import-total', rows.length.toLocaleString('th-TH'));
  setText('tro-import-ready', rows.filter((row) => row.status === 'ready').length.toLocaleString('th-TH'));
  setText('tro-import-review', rows.filter((row) => row.status === 'review').length.toLocaleString('th-TH'));
  setText('tro-import-error', rows.filter((row) => row.status === 'error').length.toLocaleString('th-TH'));
  const subtitle = document.getElementById('tro-import-subtitle');
  if (subtitle) {
    const dateText = preview.sheetDate ? ` • วันที่ ${formatDateForDisplay(preview.sheetDate)}` : '';
    subtitle.textContent = `${preview.fileName || 'ไฟล์ Excel'} • ${preview.formatLabel || 'ไฟล์ ตรอ.'} • ชีต ${preview.sheetName || '-'}${dateText} • หัวตารางแถว ${preview.headerRow || '-'} • คอลัมน์ทะเบียน ${preview.plateColumn || '-'}`;
  }
  const footer = document.getElementById('tro-import-footer-note');
  if (footer) footer.textContent = `เลือกพร้อมนำเข้า ${selectedReadyCount.toLocaleString('th-TH')} รายการ • ตรวจแก้ทะเบียน/จังหวัดได้ก่อนนำลงตาราง`;
  body.innerHTML = rows.map((row, index) => {
    const statusClass = row.status === 'error' ? 'tro-status-error' : (row.status === 'review' ? 'tro-status-review' : 'tro-status-ready');
    const rowClass = row.status === 'error' ? 'tro-row-error' : (row.status === 'review' ? 'tro-row-review' : '');
    const statusText = row.status === 'error' ? '❌ ผิดพลาด' : (row.status === 'review' ? '⚠️ ต้องตรวจ' : '✅ พร้อม');
    return `<tr class="${rowClass}">
      <td><input type="checkbox" ${row.selected && row.status !== 'error' ? 'checked' : ''} ${row.status === 'error' ? 'disabled' : ''} onchange="updateTroImportRow(${index}, 'selected', this.checked)"></td>
      <td>${escapeHTML(row.sourceRow)}</td>
      <td>${escapeHTML(row.raw)}</td>
      <td><input type="text" value="${escapeHTML(row.plate)}" oninput="updateTroImportRow(${index}, 'plate', this.value)"></td>
      <td><select onchange="updateTroImportRow(${index}, 'type', this.value)"><option value="รย" ${row.type !== 'จยย' ? 'selected' : ''}>รย</option><option value="จยย" ${row.type === 'จยย' ? 'selected' : ''}>จยย</option></select></td>
      <td><input class="numeric-input" type="number" min="0" step="0.01" value="${escapeHTML(row.taxAmount || '')}" oninput="updateTroImportRow(${index}, 'taxAmount', this.value)"></td>
      <td><input type="text" list="province-options" value="${escapeHTML(row.province)}" oninput="updateTroImportRow(${index}, 'province', this.value)"></td>
      <td><span class="tro-status-pill ${statusClass}">${statusText}</span></td>
      <td title="${escapeHTML(row.note || row.message || '')}">${escapeHTML(row.message || row.note || '-')}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="9" class="empty-state">ไม่พบข้อมูลทะเบียนในไฟล์</td></tr>';
  modal.classList.add('show');
  restoreSecondaryTableInteraction({ target: 'tro-preview', select: true });
}

function recalculateTroImportRowStatus(row) {
  const plate = String(row.plate || '').trim();
  const province = String(row.province || '').trim();
  const taxAmount = String(row.taxAmount || '').trim();
  if (!plate) return { status: 'error', selected: false, message: 'ยังไม่มีทะเบียน' };
  if (!['รย','จยย'].includes(String(row.type || '').trim())) return { status: 'review', selected: false, message: 'กรุณาเลือกประเภทรถ รย หรือ จยย' };
  if (taxAmount && !Number.isFinite(Number(taxAmount))) return { status: 'error', selected: false, message: 'ราคาภาษีต้องเป็นตัวเลข' };
  if (!province) return { status: 'review', selected: false, message: 'ยังไม่ได้ใส่จังหวัด' };
  return { status: 'ready', selected: row.selected !== false, message: 'พร้อมนำเข้า' };
}

function updateTroImportRow(index, field, value) {
  const row = getTroImportRows()[index];
  if (!row) return;
  if (field === 'selected') row.selected = Boolean(value);
  else row[field] = String(value || '').trim();
  if (field !== 'selected') Object.assign(row, recalculateTroImportRowStatus(row));
  renderTroImportPreview();
}

function toggleAllTroImportRows(checked = true) {
  getTroImportRows().forEach((row) => { row.selected = Boolean(checked) && row.status !== 'error'; });
  renderTroImportPreview();
}

function closeTroImportPreview() {
  document.getElementById('tro-import-modal')?.classList.remove('show');
}

async function selectTroReportFile() {
  try {
    showNotification('กำลังอ่านไฟล์รายงาน ตรอ....', 'info', 5000);
    const preview = await api.selectAndParseTroReport();
    if (!preview) {
      restoreSecondaryTableInteraction();
      return;
    }
    State.troImportPreview = preview;
    renderTroImportPreview();
    showNotification(`✅ อ่านไฟล์สำเร็จ ${Number(preview.totalRows || 0).toLocaleString('th-TH')} รายการ`, 'success');
  } catch (error) {
    restoreSecondaryTableInteraction();
    showNotification(`❌ อ่านไฟล์ ตรอ. ไม่สำเร็จ: ${error.message}`, 'error', 8000);
  }
}

function applyTroImportPreview(mode = 'replace') {
  const rows = getTroImportRows()
    .filter((row) => row.selected && row.status !== 'error' && String(row.plate || '').trim())
    .map((row) => ({
      id: generateUUID(),
      plate: String(row.plate || '').trim(),
      type: row.type === 'จยย' ? 'จยย' : 'รย',
      taxAmount: String(row.taxAmount || '').trim(),
      note: String(row.note || '').trim(),
      brand: String(row.brand || '').trim(),
      province: String(row.province || '').trim()
    }));
  if (rows.length === 0) {
    showNotification('❌ ไม่มีรายการที่พร้อมนำเข้า กรุณาติ๊กเลือกหรือแก้รายการก่อน', 'error');
    return;
  }
  const shouldAppend = String(mode || '').toLowerCase() === 'append';
  if (State.troImportPreview?.sheetDate) {
    State.tableMeta.documentDate = State.troImportPreview.sheetDate;
  }
  if (State.troImportPreview?.stationName) {
    State.tableMeta.stationName = State.troImportPreview.stationName;
  }
  if (!shouldAppend) State.manualEntries = rows;
  else State.manualEntries = State.manualEntries.filter((row) => window.RendererTableDomainModule.rowHasBusinessContent({}, row)).concat(rows);
  State.tableSelectedRows = new Set();
  closeTroImportPreview();
  syncMetaInputs();
  renderManualEntryTable();
  markSecondaryTableDirtyForAutoBackup('tro-import');
  restoreSecondaryTableInteraction({ select: true });
  showNotification(`✅ นำเข้าจากไฟล์ ตรอ. แล้ว ${rows.length.toLocaleString('th-TH')} รายการ${shouldAppend ? ' (ต่อท้ายข้อมูลเดิม)' : ' (แทนที่ตารางเดิม)'}`, 'success', 6500);
}

async function saveTableDraft() {
  if (State.isSavingTableDraft) {
    showNotification('กำลังบันทึกอยู่ กรุณารอสักครู่', 'warning');
    return;
  }

  const validation = validateManualEntryTable(false);
  const validationResult = validation.result || validation;
  if (!validation.ok || validationResult.errorCount > 0) {
    showNotification(`❌ ยังบันทึกไม่ได้ พบข้อผิดพลาด ${validationResult.errorCount} จุด`, 'error', 6000);
    return;
  }
  if (!State.tableMeta.appointmentDate) {
    showNotification('❌ กรุณาใส่วันนัดก่อนบันทึก', 'error');
    return;
  }
  const records = buildTableRecordsForMainList();
  if (records.length === 0) {
    showNotification('❌ ยังไม่มีข้อมูลสำหรับบันทึก', 'error');
    return;
  }

  State.isSavingTableDraft = true;
  try {
    await ensureSecondarySettingsLoaded();
    const clientName = document.getElementById('client-name-input')?.value || 'โต๊ะพิมพ์ข้อมูล';
    const roomCode = String(document.getElementById('room-code-input')?.value || State.connection.roomCode || '').replace(/\D/g, '').slice(0, 6);
    State.connection.port = getManualMainPort(State.connection.port || 39730) || State.connection.port || 39730;
    if (State.connection.roomCode && roomCode && roomCode !== State.connection.roomCode) {
      State.connection.connected = false;
      setConnectionStatus('รหัสห้องเปลี่ยน กรุณาค้นหาเครื่องหลักใหม่', false);
      showNotification('❌ รหัสห้องไม่ตรงกับเครื่องหลักที่เชื่อมต่ออยู่ กรุณากด “ค้นหาเครื่องหลัก” ใหม่ก่อนบันทึก', 'error', 8000);
      return;
    }
    const clientId = await ensureClientId();
    const result = await api.submitIntakeBatch({
      ...getSecondarySettingsPayload({ roomCode, clientName, clientId }),
      rows: records,
      printableRows: buildPrintableTableRows(),
      batchSize: 500
    });
    State.connection.connected = true;
    setConnectionStatus(`ออนไลน์: บันทึกล่าสุด ${result.batchId}`, true);
    showNotification(`✅ บันทึกเข้าเครื่องหลักแล้ว ${result.imported} รายการ (ข้าม ${result.skipped})`, 'success', 6500);
    autoBackupSecondaryTable('after-save-to-main')
      .then((backupResult) => showNotification(`✅ สำรอง Excel อัตโนมัติแล้ว: ${backupResult.backup.fileName}`, 'success', 5000))
      .catch((backupError) => showNotification(`⚠️ บันทึกสำเร็จ แต่สำรอง Excel ไม่สำเร็จ: ${backupError.message}`, 'warning', 7000));
  } catch (error) {
    State.connection.connected = false;
    setConnectionStatus('บันทึกไม่ได้', false);
    showNotification(`❌ บันทึกเข้าเครื่องหลักไม่สำเร็จ: ${error.message}`, 'error', 8000);
  } finally {
    State.isSavingTableDraft = false;
  }
}

async function init() {
  State.tableMeta = createDefaultTableMetaPreservingPrintSettings();
  setupSecondaryUpdateProgressListener();
  await ensureSecondarySettingsLoaded();
  syncMetaInputs();
  if (!State.manualEntries.length) clearTableEntryRows(10); else renderManualEntryTable();
  startSecondaryExcelAutoBackupTimer();
  autoCheckSecondaryUpdatesOnStartup().catch(() => {});
}

window.addEventListener('afterprint', () => {
  finishPrintInteraction();
});

Object.assign(window, {
  discoverMainByRoom,
  testConnection,
  updateTableMetaField,
  openTableDatePicker,
  applyTableDateFromPicker,
  openPrintPreview,
  closePrintPreview,
  confirmTablePrint,
  exportPrintPreviewPdf,
  updatePrintLayout,
  openSecondarySettings,
  closeSecondarySettings,
  chooseSecondaryBackupDir,
  resetSecondaryBackupDir,
  saveSecondarySettingsModal,
  updateTableSearch,
  clearTableSearch,
  setTableAddCount,
  addTableRows,
  setTableDeleteCount,
  deleteTableRowsByCount,
  deleteLastManualEntryRows,
  copyManualEntryFromAbove,
  resetManualEntryTable,
  startNewDay,
  exportExcelBackup,
  validateManualEntryTable,
  saveTableDraft,
  saveSecondaryPrintSettings,
  checkSecondaryUpdatesManual,
  selectTroReportFile,
  selectTroImportSheet,
  closeTroImportPreview,
  updateTroImportRow,
  toggleAllTroImportRows,
  applyTroImportPreview,
  syncBulkEditInput,
  applyBulkTableEdit,
  toggleSelectAllTableRows,
  toggleTableRowSelection,
  updateManualEntryField,
  removeManualEntryRow
});

document.addEventListener('DOMContentLoaded', init);
