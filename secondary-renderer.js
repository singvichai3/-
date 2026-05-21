const TABLE_SERVICE_RATE = 20;

const State = {
  manualEntries: [],
  tableMeta: { stationName: '', documentDate: '', appointmentDate: '', addCount: 10, deleteCount: 1, printLayout: 'auto', printStyle: { mainTitleFontPx: 9, headerLabelFontPx: 9, headerValueFontPx: 9, subTitleFontPx: 10, tableBodyFontPx: 8, summaryFontPx: 8, tableWidthPct: 100, verticalScalePct: 100 } },
  tableLastValidation: null,
  connection: { host: '', port: 39730, roomCode: '', name: '', clientId: '', connected: false },
  settings: { shopName: 'รับเล่มรถ ตรอ.', province: '' },
  isSavingTableDraft: false,
  settingsLoaded: false,
  settingsLoadPromise: null,
  connectionMonitor: { timer: null, busy: false, lastOkAt: '', lastError: '', consecutiveFailures: 0 },
  tableSelectedRows: new Set(),
  tableSearchQuery: '',
  tableSearchTimer: null,
  currentView: 'table'
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
    if (!saved.clientId) await api.saveSecondarySettings({ ...saved, clientId, clientName: saved.clientName || 'โต๊ะพิมพ์ข้อมูล' });
    State.connection = { ...State.connection, clientId };
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
  await api.saveSecondarySettings({ ...State.connection, clientId, clientName });
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
    await api.saveSecondarySettings({ ...State.connection, clientName });
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
    const result = await api.testMainConnection({ ...State.connection, port, roomCode, clientName, clientId });
    State.connection.port = port;
    State.connection.connected = true;
    State.connection.name = result.name || State.connection.name || 'เครื่องหลัก';
    State.connectionMonitor.consecutiveFailures = 0;
    State.connectionMonitor.lastError = '';
    State.connectionMonitor.lastOkAt = new Date().toISOString();
    const lastText = new Date().toLocaleTimeString('th-TH');
    const portInput = document.getElementById('main-port-input');
    if (portInput) portInput.value = String(State.connection.port || result.port || 39730);
    await api.saveSecondarySettings({ ...State.connection, roomCode, clientName, clientId });
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
    'table-station-name': State.tableMeta.stationName,
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
    floatingEl.innerHTML = `<span>รย. <strong>${summary.carCount}</strong> คัน</span><span>จยย. <strong>${summary.motorcycleCount}</strong> คัน</span><span>ภาษี <strong>${formatCurrency(summary.taxTotal)}</strong></span><span>บริการ <strong>${formatCurrency(summary.serviceTotal)}</strong></span><span class="grand">รวม <strong>${formatCurrency(summary.grandTotal)}</strong></span>${selectedCount ? `<span>เลือก <strong>${selectedCount}</strong> แถว</span>` : ''}`;
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
  if (breakdownEl) breakdownEl.textContent = `รย. ${summary.carCount} คัน | จยย. ${summary.motorcycleCount} คัน | รวม ${summary.serviceCount} คัน × ${TABLE_SERVICE_RATE}`;
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

function addManualEntryRows(count = 1) { const n = Math.max(1, Number(count) || 1); for (let i = 0; i < n; i++) State.manualEntries.push(createEmptyManualEntryRow()); renderManualEntryTable(); }
function addTableRows() { addManualEntryRows(State.tableMeta.addCount || 1); }
function setTableAddCount(value) { State.tableMeta.addCount = Math.max(1, Number(value) || 1); syncTableMetaInputs(); }
function setTableDeleteCount(value) { State.tableMeta.deleteCount = Math.max(1, Number(value) || 1); syncTableMetaInputs(); }
function deleteTableRowsByCount() { const deleteCount = Math.max(1, Number(State.tableMeta.deleteCount) || 1); if (State.manualEntries.length === 0) return; const nextLength = Math.max(1, State.manualEntries.length - deleteCount); State.manualEntries = State.manualEntries.slice(0, nextLength); State.tableSelectedRows = new Set(Array.from(State.tableSelectedRows).filter((index) => Number(index) < nextLength)); renderManualEntryTable(); }
function deleteLastManualEntryRows() { deleteTableRowsByCount(); }
function resetManualEntryTable(render = true) { State.tableMeta = createDefaultTableMeta(); State.manualEntries = Array.from({ length: 10 }, () => createEmptyManualEntryRow()); State.tableSelectedRows = new Set(); State.tableSearchQuery = ''; State.tableLastValidation = null; const searchInput = document.getElementById('table-search-input'); if (searchInput) searchInput.value = ''; if (render) { syncTableMetaInputs(); syncPrintLayoutControls(); renderManualEntryTable(); } }

function updateTableMetaField(field, value) {
  if (!Object.prototype.hasOwnProperty.call(State.tableMeta, field)) return;
  if (field === 'addCount') { State.tableMeta[field] = Math.max(1, Number(value) || 1); syncTableMetaInputs(); return; }
  if (field === 'deleteCount') { State.tableMeta[field] = Math.max(1, Number(value) || 1); syncTableMetaInputs(); return; }
  if (field === 'printLayout') { State.tableMeta[field] = ['auto','half-left','full-page'].includes(String(value)) ? String(value) : 'auto'; syncPrintLayoutControls(); if (document.getElementById('print-preview-modal')?.classList.contains('show')) renderPrintPreviewContent(); return; }
  if (field === 'documentDate' || field === 'appointmentDate') {
    const parsedDate = parseDisplayDateToIso(value);
    if (parsedDate === null) { syncTableMetaInputs(); showNotification('❌ กรุณาใส่วันที่แบบ DD/MM/YYYY', 'error'); return; }
    State.tableMeta[field] = parsedDate; syncTableMetaInputs(); return;
  }
  State.tableMeta[field] = value;
}
function updatePrintLayout(value) { updateTableMetaField('printLayout', value || 'auto'); }
function updatePrintStyleSetting(key, value) { return window.RendererPrintPreviewModule.updatePrintStyleSetting({ State, renderPrintPreviewContent }, key, value); }
function clearTableEntryRows(preserveCount = null) { const rowCount = Math.max(1, Number(preserveCount) || State.manualEntries.length || 10); State.manualEntries = Array.from({ length: rowCount }, () => createEmptyManualEntryRow()); State.tableSelectedRows = new Set(); renderManualEntryTable(); }
function buildTableRecordsForMainList() { return window.RendererTableDomainModule.buildTableRecordsForMainList({ State, generateUUID }); }
function buildPrintableTableRows() { return window.RendererTableDomainModule.buildPrintableTableRows({ State, parseMoney }); }
function calculateTableSummary() { return window.RendererTableDomainModule.calculateTableSummary({ State, parseMoney, TABLE_SERVICE_RATE }); }
function syncPrintLayoutControls() { return window.RendererPrintPreviewModule.syncPrintLayoutControls({ State, buildPrintableTableRows }); }
function renderPrintPreviewContent() { return window.RendererPrintPreviewModule.renderPrintPreviewContent({ State, escapeHTML, formatDate, formatCurrency, buildPrintableTableRows, calculateTableSummary, TABLE_SERVICE_RATE, syncPrintLayoutControls }); }
function openPrintPreview() { return window.RendererPrintPreviewModule.openPrintPreview({ buildPrintableTableRows, syncPrintLayoutControls, renderPrintPreviewContent, showNotification }); }
function closePrintPreview() { return window.RendererPrintPreviewModule.closePrintPreview(); }
function confirmTablePrint() { return window.RendererPrintPreviewModule.confirmTablePrint(); }
function finishPrintInteraction(shouldClosePreview = true) { return window.RendererPrintPreviewModule.finishPrintInteraction ? window.RendererPrintPreviewModule.finishPrintInteraction({ closePrintPreview }, shouldClosePreview) : (document.body.classList.remove('printing-active'), shouldClosePreview && closePrintPreview()); }
function exportPrintPreviewPdf() { return window.RendererPrintPreviewModule.exportPrintPreviewPdf({ buildPrintableTableRows, renderPrintPreviewContent, State, api, showNotification, finishPrintInteraction }); }
function updateManualEntryField(index, field, value) { if (!State.manualEntries[index]) return; State.manualEntries[index][field] = value; State.tableLastValidation = null; renderTableSummary(); renderTableAssistPanel(); }
function toggleTableRowSelection(index, checked) { if (checked) State.tableSelectedRows.add(index); else State.tableSelectedRows.delete(index); syncTableSelectionState(); updateManualEntryCount(); renderTableAssistPanel(); }
function toggleSelectAllTableRows(checked) { State.tableSelectedRows = checked ? new Set(State.manualEntries.map((_, index) => index)) : new Set(); renderManualEntryTable(); }
function applyBulkTableEdit() { const indexes = getSelectedTableRowIndexes(); if (indexes.length === 0) { showNotification('❌ กรุณาเลือกบรรทัดที่ต้องการแก้ไขก่อน', 'error'); return; } const field = document.getElementById('bulk-edit-field')?.value || 'brand'; const value = document.getElementById('bulk-edit-value')?.value ?? ''; const normalizedValue = String(value).trim(); if (field === 'type' && !['รย','จยย'].includes(normalizedValue)) { showNotification('❌ ประเภทรถต้องเป็น รย หรือ จยย', 'error'); return; } if (field === 'taxAmount' && normalizedValue && !Number.isFinite(Number(normalizedValue))) { showNotification('❌ ราคาภาษีต้องเป็นตัวเลข', 'error'); return; } indexes.forEach((index) => { if (State.manualEntries[index]) State.manualEntries[index][field] = normalizedValue; }); renderManualEntryTable(); showNotification(`✅ แก้ไข ${indexes.length.toLocaleString()} บรรทัดแล้ว`, 'success'); }
function removeManualEntryRow(index) { State.manualEntries.splice(index, 1); State.tableSelectedRows = new Set(getSelectedTableRowIndexes().filter((selectedIndex) => selectedIndex !== index).map((selectedIndex) => selectedIndex > index ? selectedIndex - 1 : selectedIndex)); if (State.manualEntries.length === 0) State.manualEntries.push(createEmptyManualEntryRow()); renderManualEntryTable(); }
function updateTableSearch(value) { State.tableSearchQuery = String(value || '').trim(); if (State.tableSearchTimer) clearTimeout(State.tableSearchTimer); State.tableSearchTimer = setTimeout(() => { State.tableSearchTimer = null; renderManualEntryTable(); }, 120); }
function clearTableSearch() { State.tableSearchQuery = ''; if (State.tableSearchTimer) { clearTimeout(State.tableSearchTimer); State.tableSearchTimer = null; } const input = document.getElementById('table-search-input'); if (input) input.value = ''; renderManualEntryTable(); }
function validateManualEntryTable(showResult = true) { const result = getTableValidationResult(); State.tableLastValidation = result; renderManualEntryTable(); const firstError = result.issues.find((issue) => issue.level === 'error'); if (firstError) { const rowEl = document.querySelector(`[data-row-index="${firstError.index}"]`); if (rowEl) rowEl.scrollIntoView({ behavior:'smooth', block:'center' }); if (showResult) showNotification(`❌ ${firstError.message}`, 'error'); return { ok:false, result, errorCount: result.errorCount, filledCount: result.filledCount }; } if (showResult) showNotification(result.warningCount > 0 ? `⚠️ ตรวจแล้ว: มีคำเตือน ${result.warningCount} จุด แต่ไม่มี error` : `✅ ตรวจแล้ว: ข้อมูลที่กรอก ${result.filledCount} แถวพร้อมบันทึก`, result.warningCount > 0 ? 'warning' : 'success'); return { ok:true, result, errorCount: result.errorCount, filledCount: result.filledCount }; }
function copyManualEntryFromAbove() { const indexes = getSelectedTableRowIndexes(); if (indexes.length === 0) { showNotification('❌ กรุณาเลือกบรรทัดที่จะคัดลอกจากแถวบนก่อน', 'error'); return; } let copied = 0; indexes.forEach((index) => { if (index <= 0 || !State.manualEntries[index] || !State.manualEntries[index - 1]) return; const prev = State.manualEntries[index - 1]; State.manualEntries[index] = { ...State.manualEntries[index], type: prev.type === 'จยย' ? 'จยย' : 'รย', taxAmount: prev.taxAmount || '', note: prev.note || '', brand: prev.brand || '', province: prev.province || '' }; copied += 1; }); renderManualEntryTable(); if (copied > 0) showNotification(`✅ คัดลอกค่าจากแถวบนแล้ว ${copied} แถว`, 'success'); else showNotification('⚠️ แถวแรกไม่มีแถวบนให้คัดลอก', 'warning'); }
function focusNextManualEntryInput(currentInput) { const inputs = Array.from(document.querySelectorAll('#manual-entry-body input[type="text"], #manual-entry-body input[type="number"]')); const index = inputs.indexOf(currentInput); const next = inputs[index + 1]; if (next) { next.focus(); if (typeof next.select === 'function') next.select(); } }
function handleTableKeyboardShortcut(event) { const target = event.target; const tagName = String(target?.tagName || '').toLowerCase(); const isEditable = ['input','select','textarea'].includes(tagName); if (event.key === 'Enter' && isEditable && target.closest?.('#manual-entry-body')) { event.preventDefault(); event.stopImmediatePropagation(); focusNextManualEntryInput(target); return; } if (!event.ctrlKey && !event.metaKey) return; const key = String(event.key || '').toLowerCase(); if (key === 's') { event.preventDefault(); event.stopImmediatePropagation(); saveTableDraft(); } else if (key === 'p') { event.preventDefault(); event.stopImmediatePropagation(); openPrintPreview(); } else if (key === 'enter') { event.preventDefault(); event.stopImmediatePropagation(); addManualEntryRows(1); } else if (key === 'd') { event.preventDefault(); event.stopImmediatePropagation(); copyManualEntryFromAbove(); } else if (key === 'f') { event.preventDefault(); event.stopImmediatePropagation(); document.getElementById('table-search-input')?.focus(); } }
document.addEventListener('keydown', handleTableKeyboardShortcut);

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
  const records = buildTableRecordsForMainList();
  if (records.length === 0) {
    showNotification('❌ ยังไม่มีข้อมูลสำหรับบันทึก', 'error');
    return;
  }
  if (!State.tableMeta.appointmentDate) {
    showNotification('❌ กรุณาใส่วันนัดก่อนบันทึก', 'error');
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
      ...State.connection,
      roomCode,
      rows: records,
      printableRows: buildPrintableTableRows(),
      clientName,
      clientId,
      batchSize: 500
    });
    State.connection.connected = true;
    setConnectionStatus(`ออนไลน์: บันทึกล่าสุด ${result.batchId}`, true);
    showNotification(`✅ บันทึกเข้าเครื่องหลักแล้ว ${result.imported} รายการ (ข้าม ${result.skipped})`, 'success', 6500);
  } catch (error) {
    State.connection.connected = false;
    setConnectionStatus('บันทึกไม่ได้', false);
    showNotification(`❌ บันทึกเข้าเครื่องหลักไม่สำเร็จ: ${error.message}`, 'error', 8000);
  } finally {
    State.isSavingTableDraft = false;
  }
}

async function init() {
  State.tableMeta = { ...createDefaultTableMeta(), ...State.tableMeta };
  await ensureSecondarySettingsLoaded();
  syncMetaInputs();
  if (!State.manualEntries.length) clearTableEntryRows(10); else renderManualEntryTable();
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
  updateTableSearch,
  clearTableSearch,
  setTableAddCount,
  addTableRows,
  setTableDeleteCount,
  deleteTableRowsByCount,
  deleteLastManualEntryRows,
  copyManualEntryFromAbove,
  resetManualEntryTable,
  validateManualEntryTable,
  saveTableDraft,
  syncBulkEditInput,
  applyBulkTableEdit,
  toggleSelectAllTableRows,
  toggleTableRowSelection,
  updateManualEntryField,
  removeManualEntryRow
});

document.addEventListener('DOMContentLoaded', init);
