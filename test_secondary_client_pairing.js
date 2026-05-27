const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = __dirname;

function read(name) {
  return fs.readFileSync(path.join(root, name), 'utf8');
}

function assertIncludes(source, needle, message) {
  assert.ok(source.includes(needle), message || `Expected source to include ${needle}`);
}

function testPairingModuleContract() {
  const pairing = require('./lan-pairing');

  assert.strictEqual(pairing.normalizeRoomCode(' 555641 '), '555641', 'room code should trim and keep 6 digits');
  assert.strictEqual(pairing.normalizeRoomCode('55-56-41'), '555641', 'room code should ignore separators');
  assert.strictEqual(pairing.normalizeRoomCode('abc555641xyz'), '555641', 'manual room code should accept pasted text with digits');
  assert.throws(() => pairing.normalizeRoomCode('12345'), /6 หลัก/, 'room code must be exactly 6 digits');

  const request = pairing.buildDiscoveryRequest('555641');
  const parsedRequest = pairing.parseDiscoveryMessage(Buffer.from(request));
  assert.deepStrictEqual(parsedRequest, {
    app: pairing.APP_ID,
    type: pairing.DISCOVERY_REQUEST,
    roomCode: '555641'
  }, 'discovery request should be parseable JSON contract');

  const response = pairing.buildDiscoveryResponse({ roomCode: '555641', port: 39730, host: '192.168.1.10', name: 'MAIN-PC' });
  const parsedResponse = pairing.parseDiscoveryMessage(Buffer.from(response));
  assert.strictEqual(parsedResponse.type, pairing.DISCOVERY_RESPONSE, 'response should have discovery response type');
  assert.strictEqual(parsedResponse.host, '192.168.1.10', 'response should include main host');
  assert.strictEqual(parsedResponse.roomCode, '555641', 'response should include room code');

  const broadcastAddresses = pairing.getDiscoveryBroadcastAddresses({
    'Wi-Fi': [{ family: 'IPv4', internal: false, address: '192.168.1.44', netmask: '255.255.255.0' }],
    'Ethernet': [{ family: 'IPv4', internal: false, address: '10.8.0.5', netmask: '255.255.0.0' }],
    Loopback: [{ family: 'IPv4', internal: true, address: '127.0.0.1', netmask: '255.0.0.0' }]
  });
  assert.ok(broadcastAddresses.includes('255.255.255.255'), 'discovery should keep global broadcast fallback');
  assert.ok(broadcastAddresses.includes('192.168.1.255'), 'discovery should target Wi-Fi subnet broadcast');
  assert.ok(broadcastAddresses.includes('10.8.255.255'), 'discovery should target Ethernet/VPN subnet broadcast');
}

function testMainProgramExposesRoomServer() {
  const mainJs = read('main.js');
  const preloadJs = read('preload.js');
  const packageJson = read('package.json');
  const rendererJs = read('renderer.js');

  assertIncludes(mainJs, "require('./local-network-server')", 'main app should use the LAN network server module');
  assertIncludes(mainJs, 'startLocalNetworkServer', 'main app should start local network server');
  assertIncludes(mainJs, 'loadPersistedRoomCode', 'main app should persist room code across restarts');
  assertIncludes(mainJs, 'persistRoomCode', 'main app should save generated/regenerated room code');
  assertIncludes(mainJs, "ipcMain.handle('get-network-server-status'", 'main app should expose network status IPC');
  assertIncludes(mainJs, "ipcMain.handle('set-network-room-code'", 'main app should allow operator-defined room code');
  assertIncludes(mainJs, 'setRoomCode(payload?.roomCode)', 'main app should pass manual room code into network server');
  assertIncludes(preloadJs, 'getNetworkServerStatus', 'preload should expose network server status to UI');
  assertIncludes(preloadJs, 'setNetworkRoomCode', 'preload should expose manual room code setting to UI');
  assertIncludes(rendererJs, 'startNetworkRoomMonitor', 'main UI should poll LAN monitor status');
  assertIncludes(rendererJs, '__networkRoomMonitorBusy', 'main LAN monitor polling should guard against overlapping async refreshes');
  assertIncludes(rendererJs, 'clientCount', 'main UI should display connected secondary count');
  assertIncludes(packageJson, 'local-network-server.js', 'build allowlist should include main LAN server module');
  assertIncludes(packageJson, 'lan-pairing.js', 'build allowlist should include shared pairing module');
  assertIncludes(packageJson, 'lan-security.js', 'build allowlist should include shared LAN HMAC security module');
}

function testSecondaryClientFilesAndContracts() {
  const required = [
    'secondary-main.js',
    'secondary-preload.js',
    'secondary-index.html',
    'secondary-renderer.js',
    'secondary-network.js',
    'electron-builder.secondary.json'
  ];
  for (const file of required) {
    assert.ok(fs.existsSync(path.join(root, file)), `${file} should exist for the secondary PC program`);
  }

  const html = read('secondary-index.html');
  const renderer = read('secondary-renderer.js');
  const secondaryMain = read('secondary-main.js');
  const preload = read('secondary-preload.js');
  const network = read('secondary-network.js');
  const builder = read('electron-builder.secondary.json');

  assertIncludes(html, 'renderer-table-domain.js', 'secondary UI should reuse table domain module from main app');
  assertIncludes(html, 'renderer-print-preview.js', 'secondary UI should reuse print preview module from main app');
  assertIncludes(html, 'print-fit.js', 'secondary UI should reuse A4 print fit module');
  assertIncludes(html, 'id="room-code-input"', 'secondary UI should let user enter the room code');
  assertIncludes(html, 'id="main-port-input"', 'secondary UI should let user override the main HTTP port manually');
  assertIncludes(html, 'v1.0.18', 'secondary UI should visibly show the fixed build version so operators do not run a stale same-version installer');
  assertIncludes(html, 'นำเข้า Excel ตรอ. พรีเมี่ยม', 'secondary UI should visibly expose the premium TRO Excel import flow');
  const mainHtml = read('index.html');
  assertIncludes(mainHtml, 'onclick="promptSetNetworkRoomCode()"', 'main app room badge should let operator set room code manually');
  assertIncludes(mainHtml, 'data-view="network"', 'main app should provide a LAN monitor view for connected secondary machines');
  assertIncludes(mainHtml, 'network-monitor-shell', 'LAN monitor should have a dedicated rendering shell');
  assertIncludes(html, 'id="manual-entry-body"', 'secondary UI should include copied table-entry body');
  assertIncludes(html, 'id="table-search-input" type="search" hidden', 'secondary table should keep a hidden search input for renderer compatibility while removing the unused visible search UI');
  assertIncludes(html, 'id="table-select-all"', 'secondary table should copy main row selection checkbox column');
  assertIncludes(html, 'id="bulk-edit-field"', 'secondary table should copy main bulk edit controls');
  assertIncludes(html, 'id="table-floating-summary"', 'secondary table should keep a hidden floating-summary target so renderer updates stay harmless');
  assertIncludes(html, 'onclick="copyManualEntryFromAbove()"', 'secondary table should copy main copy-from-above action');
  assert.ok(!html.includes('placeholder="ค้นทะเบียน / จังหวัด / ยี่ห้อ / หมายเหตุ"'), 'secondary UI should remove the unused visible plate-search box to give table more height');
  assertIncludes(html, 'radial-gradient(circle at top right, rgba(16,185,129,.14)', 'secondary table card should visually match main table tab surface styling');
  assertIncludes(html, '.summary-card::after { content:none; }', 'secondary summary should be compact pills instead of tall cards that steal table height');
  assertIncludes(html, '.station-settings-button', 'secondary station name should move to settings button instead of an always-editable table field');
  assertIncludes(html, 'id="secondary-settings-modal"', 'secondary UI should include a settings modal');
  assertIncludes(html, 'id="settings-transport-car-rate"', 'secondary settings should let operator customize รย transport fee');
  assertIncludes(html, 'id="settings-shop-moto-rate"', 'secondary settings should let operator customize shop จยย service fee');
  assertIncludes(html, '.print-summary-shop-divider', 'secondary print CSS should style the separator above shop service calculation');
  assertIncludes(html, 'margin:2.8mm 0 .55mm', 'secondary shop service calculation should sit farther below the grand total in print preview');
  assertIncludes(html, 'print-sheet-header-stacked', 'secondary print header should support a stacked shop-name/date layout');
  assertIncludes(html, 'print-summary-shop-total', 'secondary print shop-service section should include a distinct total row');
  assertIncludes(html, 'ร้าน รย.=50 / จยย.=40', 'secondary default shop service rates should be รย.50 and จยย.40');
  assertIncludes(html, "onclick=\"applyTroImportPreview('append')\"", 'secondary TRO import should offer append without a blocking native confirm');
  assertIncludes(html, "onclick=\"applyTroImportPreview('replace')\"", 'secondary TRO import should offer replace without a blocking native confirm');
  assertIncludes(html, 'id="tro-import-sheet-picker"', 'secondary TRO import should let operator choose the date/sheet when a workbook contains multiple days');
  assertIncludes(html, '<th style="width:90px">ประเภท</th>', 'secondary TRO preview should show mapped vehicle type before import');
  assertIncludes(html, '<th style="width:120px">ราคาภาษี</th>', 'secondary TRO preview should show tax amount mapped from source total');
  assertIncludes(renderer, 'colspan="9"', 'secondary TRO empty preview row should match the expanded preview columns');
  assertIncludes(html, '.entry-grid .sequence-cell small', 'secondary row issue badge styling should match main table tab');
  assertIncludes(html, '.table-grid-surface { display:flex; flex-direction:column;', 'secondary table surface must be a flex column so the entry grid gets visible scrollable height');
  assertIncludes(html, '.entry-shell { display:flex; flex-direction:column; gap:6px; min-height:0; flex:1 1 auto; overflow:hidden; }', 'secondary content shell should use compact gaps so the table gets more vertical space');
  assertIncludes(html, '.table-grid-surface { display:flex; flex-direction:column; flex:1 1 auto; min-height:260px; margin-bottom:0;', 'secondary table should reserve substantially more visible height than the controls');
  assertIncludes(html, '.entry-grid-wrap { padding:6px 8px 8px; overflow:auto; flex:1 1 auto; min-height:260px; }', 'secondary entry grid should have a larger minimum visible height and denser padding');
  assertIncludes(html, '@media (max-height: 820px)', 'secondary UI should have a compact-height mode for normal laptop windows');
  assertIncludes(html, '.table-actions-row { display:flex; margin-top:0; gap:6px; align-items:center; }', 'compact-height mode should keep bulk edit controls on the same toolbar row');
  assertIncludes(html, '.bulk-edit-bar { gap:6px; flex-wrap:nowrap; }', 'compact-height bulk edit controls should stay on one usable row');
  assertIncludes(html, '.summary-surface { display:none; }', 'secondary UI should hide summary on short windows so table rows stay visible');
  assertIncludes(html, '.table-grid-surface { flex-basis:auto; min-height:260px; margin-bottom:0; }', 'compact-height mode should give the table priority over summary/help content');
  assertIncludes(html, '.toolbar-surface .btn { height:34px;', 'secondary toolbar buttons should be dense enough to stay on one line');

  assertIncludes(renderer, 'function renderManualEntryTable', 'secondary renderer should use the same manual-entry renderer shape as main table tab');
  assertIncludes(renderer, 'toggleSelectAllTableRows', 'secondary renderer should support main row select-all behavior');
  assertIncludes(renderer, 'applyBulkTableEdit', 'secondary renderer should support main bulk edit behavior');
  assertIncludes(renderer, 'updateTableSearch', 'secondary renderer should support main table quick search');
  assertIncludes(renderer, 'copyManualEntryFromAbove', 'secondary renderer should support main copy-from-above behavior');
  assertIncludes(renderer, 'handleTableKeyboardShortcut', 'secondary renderer should support main table keyboard shortcuts');
  assertIncludes(renderer, "window.addEventListener('afterprint'", 'secondary renderer should restore the UI after print dialog closes');
  assertIncludes(renderer, 'Object.assign(window, {', 'secondary renderer should explicitly expose inline-handler functions on window');
  assert.strictEqual((renderer.match(/function syncMetaInputs\(/g) || []).length, 1, 'secondary renderer should not keep duplicate syncMetaInputs definitions with stale main-app IDs');
  for (const handler of ['addTableRows', 'deleteTableRowsByCount', 'openPrintPreview', 'confirmTablePrint', 'saveTableDraft']) {
    assertIncludes(renderer, handler, `secondary renderer should define/export ${handler} used by visible buttons`);
  }

  assertIncludes(renderer, 'RendererTableDomainModule.buildTableRecordsForMainList', 'secondary renderer should convert table rows with shared table domain logic');
  assertIncludes(renderer, 'RendererPrintPreviewModule.openPrintPreview', 'secondary renderer should open shared print preview');
  assertIncludes(renderer, 'api.discoverMainByRoom', 'secondary renderer should discover main by room code');
  assertIncludes(renderer, 'getManualMainPort', 'secondary renderer should read a manually entered main port');
  assertIncludes(renderer, 'api.submitIntakeBatch', 'secondary renderer should submit saved rows to main app');
  assertIncludes(renderer, 'isSavingTableDraft', 'secondary renderer should guard double-click/double-submit while saving');
  assertIncludes(renderer, 'รหัสห้องไม่ตรงกับเครื่องหลักที่เชื่อมต่ออยู่', 'secondary renderer should prevent saving to an old host after the operator changes room code without rediscovery');
  assertIncludes(renderer, 'startConnectionMonitor', 'secondary renderer should continuously monitor main connection health');
  assertIncludes(renderer, 'setTimeout(loop, 5000)', 'secondary monitor should schedule the next health check only after the previous one completes');
  assertIncludes(renderer, 'consecutiveFailures', 'secondary monitor should count consecutive health failures');
  assertIncludes(renderer, 'State.connection.connected = false;', 'secondary renderer should mark stale connection offline after failures');
  assertIncludes(secondaryMain, 'requestSingleInstanceLock', 'secondary app should prevent multiple secondary windows/processes');
  assertIncludes(secondaryMain, 'isExportingPdf', 'secondary PDF export should reject overlapping export requests');
  assertIncludes(secondaryMain, 'printToPdfPromise.catch((error) => {', 'secondary PDF timeout race should consume and log late printToPDF rejections');
  assertIncludes(secondaryMain, "console.warn('Late PDF export rejection:'", 'secondary PDF timeout race should keep late rejection details visible for diagnostics');
  assertIncludes(secondaryMain, 'verifyFileSha256', 'secondary updater should verify installer SHA-256 before launching it');
  assertIncludes(secondaryMain, 'verifySecondaryUpdateManifestSignature', 'secondary updater should verify a signed manifest before trusting url/sha256');
  assertIncludes(secondaryMain, 'SECONDARY_UPDATE_APP_ID', 'secondary updater should bind signed manifests to the secondary app id');
  assertIncludes(read('secondary-update-signing.js'), 'BEGIN PUBLIC KEY', 'secondary updater should embed only the public update verification key');
  assertIncludes(secondaryMain, 'MAX_SECONDARY_INSTALLER_BYTES', 'secondary updater should reject oversized installer downloads');
  assertIncludes(secondaryMain, 'sanitizeFileNamePart', 'secondary updater should sanitize manifest-controlled filename parts');
  assertIncludes(secondaryMain, 'MAX_SETTINGS_BYTES', 'secondary settings loader should reject oversized local settings files');

  assertIncludes(secondaryMain, 'check-secondary-updates', 'secondary app should expose an update-check IPC handler');
  assertIncludes(secondaryMain, 'download-and-install-secondary-update', 'secondary app should download and launch the secondary installer');
  assertIncludes(secondaryMain, 'update-secondary.json', 'secondary app should use the secondary update manifest instead of the main installer manifest');
  assertIncludes(preload, 'checkSecondaryUpdates', 'secondary preload should expose update checking');
  assertIncludes(preload, 'downloadAndInstallSecondaryUpdate', 'secondary preload should expose update installation');
  assertIncludes(renderer, 'checkSecondaryUpdatesManual', 'secondary renderer should provide a manual update button handler');
  assertIncludes(renderer, 'autoCheckSecondaryUpdatesOnStartup', 'secondary renderer should check for updates on startup');
  assertIncludes(html, 'id="secondary-update-status"', 'secondary UI should show update status in the title bar');
  assertIncludes(html, 'onclick="checkSecondaryUpdatesManual()"', 'secondary UI should provide a manual update button');

  assertIncludes(html, 'onclick="saveSecondaryPrintSettings()"', 'secondary print preview should provide a button to save print settings');
  assertIncludes(html, 'body.printing-active .print-preview-toolbar, body.printing-active .print-style-controls { display:none !important; }', 'secondary print output should hide toolbar and font-setting controls');
  assertIncludes(secondaryMain, 'stationName:', 'secondary main should persist the station/shop name in local settings');
  assertIncludes(secondaryMain, 'province:', 'secondary main should persist the default province in local settings');
  assertIncludes(secondaryMain, 'name:', 'secondary main should persist the discovered main-computer display name in local settings');
  assertIncludes(secondaryMain, 'Object.entries(settings).forEach', 'secondary main should merge settings without dropping saved fields when a partial payload is saved');
  assertIncludes(secondaryMain, 'printStyle: normalizePrintStyleSettings', 'secondary main should persist normalized print style settings');
  assertIncludes(secondaryMain, "printLayout: ['auto', 'half-left', 'full-page']", 'secondary main should persist the selected print layout safely');
  assertIncludes(secondaryMain, 'transportCarRate:', 'secondary main should persist custom transport car service rate');
  assertIncludes(secondaryMain, 'shopMotoRate:', 'secondary main should persist custom shop motorcycle service rate');
  assertIncludes(html, 'id="settings-default-province"', 'secondary settings modal should expose the default province so new rows keep the operator preference after restart');
  assertIncludes(renderer, 'State.tableMeta.stationName = saved.stationName', 'secondary renderer should restore saved shop name on startup');
  assertIncludes(renderer, 'State.settings.province = String(saved.province', 'secondary renderer should restore saved default province on startup');
  assertIncludes(renderer, 'State.tableMeta.printLayout =', 'secondary renderer should restore saved print layout on startup');
  assertIncludes(renderer, 'State.tableMeta.printStyle = { ...State.tableMeta.printStyle, ...saved.printStyle }', 'secondary renderer should restore saved print style on startup');
  assertIncludes(renderer, 'function createDefaultTableMetaPreservingPrintSettings', 'secondary renderer should preserve print settings when creating a fresh table meta');
  assertIncludes(renderer, 'function syncPrintStyleStateFromControls', 'secondary print-save button should capture current print control values before saving');
  assertIncludes(renderer, 'syncPrintStyleStateFromControls(); persistSecondaryUiSettings()', 'secondary print-save button should save the latest control values even if onchange has not fired');
  assertIncludes(renderer, 'resetManualEntryTable(render = true) { State.tableMeta = createDefaultTableMetaPreservingPrintSettings()', 'secondary table reset/import workflow should not reset saved print layout/style');
  assertIncludes(renderer, 'function saveSecondarySettingsModal', 'secondary renderer should save shop name and custom service rates from settings modal');
  assertIncludes(renderer, 'function getSecondarySettingsPayload', 'secondary renderer should centralize every persisted secondary setting into one payload');
  assertIncludes(renderer, 'function scheduleSecondarySettingsPersist', 'secondary renderer should auto-save print/layout setting changes with debounce');
  assertIncludes(renderer, 'scheduleSecondarySettingsPersist(); return result;', 'secondary print style changes should persist even when the user forgets the save-print-settings button');
  assertIncludes(renderer, 'getSecondaryServiceRates()', 'secondary renderer should include custom service rates when persisting settings');
  assertIncludes(renderer, 'showShopService: true', 'secondary print preview should opt into shop service calculation under grand total');
  assertIncludes(renderer, 'stackedSecondaryHeader: true', 'secondary print preview should render shop name on row 1 and dates on row 2');
  assertIncludes(renderer, '<select onchange="updateTroImportRow(${index}, \'type\', this.value)">', 'secondary TRO preview should let operator correct mapped vehicle type before import');
  assertIncludes(renderer, 'ราคาภาษีต้องเป็นตัวเลข', 'secondary TRO preview should validate tax amount before applying rows');
  assertIncludes(renderer, 'State.tableMeta.stationName = State.troImportPreview.stationName', 'secondary TRO import should apply parsed station name to the current batch print header');
  assertIncludes(renderer, 'function restoreSecondaryTableInteraction', 'secondary renderer should explicitly recover focus after file dialogs/import modals');
  assertIncludes(renderer, "restoreSecondaryTableInteraction({ select: true })", 'secondary TRO import should focus an editable table cell immediately after import');
  assertIncludes(renderer, "String(mode || '').toLowerCase() === 'append'", 'secondary TRO import should append/replace based on explicit non-blocking buttons');
  assertIncludes(renderer, 'function selectTroImportSheet', 'secondary TRO import should switch preview rows by selected date/sheet');
  assertIncludes(renderer, 'State.tableMeta.documentDate = State.troImportPreview.sheetDate', 'secondary TRO import should apply the selected sheet date as the document date');
  assertIncludes(renderer, "type: row.type === 'จยย' ? 'จยย' : 'รย'", 'secondary TRO import should preserve mapped รย/จยย type when applying rows');
  assertIncludes(renderer, 'State.tableMeta = createDefaultTableMetaPreservingPrintSettings()', 'secondary init should set fresh dates without resetting saved print settings');
  assert.ok(renderer.indexOf('if (!State.tableMeta.appointmentDate)') < renderer.indexOf('const records = buildTableRecordsForMainList();'), 'secondary save should validate appointment date before converting rows so the message is accurate and records are not hidden as empty');
  assert.ok(!renderer.includes('const replace = window.confirm(`นำเข้า'), 'secondary TRO import must not use blocking window.confirm because it can leave Electron inputs unfocused');
  assertIncludes(preload, 'confirmDialog', 'secondary preload should expose non-blocking native confirmation via IPC');
  assertIncludes(secondaryMain, "ipcMain.handle('secondary-confirm-dialog'", 'secondary main should handle IPC confirmation dialogs');
  assertIncludes(secondaryMain, 'refocusSecondaryWindow(win)', 'secondary main should restore Electron focus after native dialogs');
  assert.ok(secondaryMain.indexOf("ipcMain.handle('export-print-pdf'") < secondaryMain.lastIndexOf('refocusSecondaryWindow(win)'), 'secondary PDF export should also restore focus after the native save dialog closes');
  assertIncludes(renderer, 'function saveSecondaryPrintSettings', 'secondary renderer should save print settings on demand');
  const printPreviewModule = read('renderer-print-preview.js');
  assertIncludes(printPreviewModule, 'print-meta-station-line', 'print preview should render station/shop name as its own first header line when requested');
  assertIncludes(printPreviewModule, 'print-meta-date-line', 'print preview should render document date and appointment date on the second header line');
  assertIncludes(printPreviewModule, 'การคิดค่าบริการร้าน', 'shop service heading should match the requested wording');
  assertIncludes(printPreviewModule, 'รย. ${summary.carCount}×${summary.shopCarRate}=', 'shop service car row should use count×rate= format');
  assertIncludes(printPreviewModule, 'จยย. ${summary.motorcycleCount}×${summary.shopMotoRate}=', 'shop service motorcycle row should use count×rate= format');
  assertIncludes(printPreviewModule, 'รวม=', 'shop service section should show a combined total label');

  assertIncludes(renderer, 'settingsLoaded', 'secondary renderer should wait for settings before discovery/health so clientId stays stable');
  assertIncludes(renderer, 'ensureSecondarySettingsLoaded', 'secondary renderer should serialize settings load before network actions');
  assertIncludes(renderer, 'ensureClientId', 'secondary renderer should create/persist one stable client id before connect/submit');
  assertIncludes(renderer, 'error.blocked', 'secondary renderer should show blocked clients differently from generic network failures');
  assertIncludes(renderer, 'connectionMonitor.busy', 'secondary connection monitor should guard against overlapping health checks');
  assert.ok(!renderer.includes('if (State.connectionMonitor.busy) {\n      State.connectionMonitor.timer = setTimeout(loop, 5000);'), 'secondary monitor busy branch should not schedule an extra timer pileup');
  assertIncludes(secondaryMain, 'normalizePortValue', 'secondary main should validate saved port values');
  assertIncludes(secondaryMain, 'ค้นพบเครื่องหลัก แต่ข้อมูล IP/พอร์ตไม่สมบูรณ์', 'secondary main should reject corrupt discovery results before saving settings');
  assertIncludes(network, 'makeHttpError', 'secondary network should preserve blocked/status metadata from HTTP failures');
  assertIncludes(network, 'เครื่องหลักตอบกลับไม่ถูกต้อง', 'secondary network should reject invalid JSON instead of showing undefined success counts');
  assertIncludes(network, 'เครื่องหลักตอบกลับไม่ครบถ้วนหลังบันทึก', 'secondary network should reject incomplete success payloads');
  assertIncludes(network, 'normalizePort', 'secondary network should normalize invalid ports before fetch');
  assertIncludes(network, 'error.blocked', 'secondary network errors should carry blocked metadata');

  assertIncludes(preload, 'discoverMainByRoom', 'secondary preload should expose room discovery');
  assertIncludes(preload, 'submitIntakeBatch', 'secondary preload should expose batch submit');
  assertIncludes(network, 'findMainByRoomCode', 'secondary network module should implement room-code discovery');
  assertIncludes(network, 'submitIntakeBatch', 'secondary network module should submit rows over HTTP');
  assertIncludes(network, 'X-Client-Name', 'secondary network should identify itself to the main connection monitor');
  assertIncludes(network, 'X-Client-Id', 'secondary network should send a stable client id so blocking cannot be bypassed by IP/name changes');
  assertIncludes(renderer, 'clientId', 'secondary renderer should persist a stable client id');
  assertIncludes(secondaryMain, 'clientId', 'secondary main should persist stable client id in local settings');
  assertIncludes(network, 'X-Room-Code', 'secondary health checks should authenticate room monitoring pings');
  assertIncludes(network, 'signLanRequest', 'secondary network should HMAC-sign health checks and batch submits');
  assertIncludes(read('lan-security.js'), "'X-LAN-HMAC'", 'shared LAN security module should send LAN HMAC headers');
  assertIncludes(builder, 'secondary-update-signing.js', 'secondary packaged app should include signed-manifest verifier');
  assertIncludes(builder, 'lan-security.js', 'secondary packaged app should include the LAN HMAC module');
  assertIncludes(builder, '!win-unpacked{,/**}', 'secondary build should exclude stale root win-unpacked artifacts');
  assertIncludes(builder, '!.qwen{,/**}', 'secondary build should exclude local assistant scratch folders like the main build');
  assertIncludes(builder, '!*.bat', 'secondary build should exclude developer batch files');
  assertIncludes(builder, '!*.md', 'secondary build should exclude documentation files');
  assertIncludes(builder, 'รับเล่มรถ ตรอ. - เครื่องรอง', 'secondary builder config should package separate app name');
}

function testLanDataIntegrityGuards() {
  const worker = read('db-worker.js');
  const server = read('local-network-server.js');

  assertIncludes(worker, 'INSERT OR IGNORE INTO records', 'batch import should not REPLACE existing rows and reset status fields');
  assertIncludes(worker, 'WHERE NOT EXISTS', 'batch import should enforce duplicate plate/date skip at insert time');
  assertIncludes(worker, 'insertResult.changes > 0', 'batch import should count imported only when SQLite inserted a row');
  assert.ok(!worker.includes(".normalize('NFC')"), 'worker duplicate key normalization should not diverge from SQLite generated plate_norm');
  assertIncludes(worker, 'const plateNorm = normalizePlateText(plate);', 'LAN batch import should use the shared plate normalization helper for duplicate keys');
  assertIncludes(worker, 'idx_records_plate_imported', 'worker should index plate_norm/importedAt for duplicate-check performance');
  assert.ok(!worker.includes('.replace(/-/g, \'\')'), 'worker duplicate key normalization should match SQL plate_norm and not strip dashes separately');
  assertIncludes(server, 'error.statusCode || 500', 'main LAN server should preserve request parse status codes instead of always returning 500');
  assertIncludes(server, 'host: \'\'', 'discovery response should let secondary use UDP source address instead of guessed interface');
  assertIncludes(server, 'setImmediate', 'main server should respond before broadcasting UI refresh');
  assertIncludes(server, 'activeHttpSockets', 'main LAN server should track sockets so shutdown can force-close active connections');
  assertIncludes(server, 'closeAllConnections', 'main LAN server should close active HTTP connections during app shutdown');
  assertIncludes(server, 'httpServer.unref()', 'main LAN HTTP server should not keep the Electron process alive by itself');
  assertIncludes(server, 'udpSocket.unref()', 'main LAN UDP socket should not keep the Electron process alive by itself');
  assertIncludes(server, '}, 0, 120000)', 'secondary batch import should use a longer timeout to avoid false failure on larger batches');
  assertIncludes(server, 'clientCount', 'main LAN status should expose secondary client monitor count');
  assertIncludes(server, 'blockedClients', 'main LAN server should track clients disconnected by the operator');
  assertIncludes(server, 'sanitizeClientKeyPart', 'main LAN server should sanitize fallback client-name keys');
  assertIncludes(server, 'key: clientId ? `client:${clientId}` : `name:${sanitizeClientKeyPart(clientName)}`', 'main LAN server should use stable client id/name rather than IP for block identity');
  assertIncludes(server, "decodeHeaderText(req.headers['x-client-name'])", 'main LAN server should decode encoded client names from headers');
  assertIncludes(server, "X-Client-Name, X-Client-Id", 'main LAN server should allow stable client id headers');
  assertIncludes(server, 'X-LAN-HMAC', 'main LAN server should allow HMAC headers through CORS');
  assertIncludes(server, 'verifyLanHmacRequest', 'main LAN server should verify signed LAN requests when HMAC headers are present');
  assertIncludes(server, 'createNonceReplayCache', 'main LAN server should keep a nonce cache to reject replayed LAN requests');
  assertIncludes(server, "authenticated ? { ok: true, ...identity() } : { ok: true, app: APP_ID", 'unauthenticated LAN health checks should not leak room code/client list');
  assertIncludes(server, 'disconnectClient', 'main LAN server should expose a control to block/disconnect a secondary client');
  assertIncludes(server, 'allowClient', 'main LAN server should expose a control to allow a blocked secondary client again');
  assertIncludes(server, 'blocked-submit', 'blocked secondary clients should be rejected when submitting records');
  assertIncludes(server, 'blocked-health', 'blocked secondary clients should be rejected on heartbeat health checks');
  assertIncludes(server, 'pruneClients', 'main LAN server should remove stale secondary monitor entries');
  assertIncludes(server, 'touchClient', 'main LAN server should track secondary client heartbeats/submits');
  assertIncludes(server, 'clients: Array.from', 'main LAN status should return recent secondary clients');

  const main = read('main.js');
  const preload = read('preload.js');
  const renderer = read('renderer.js');
  assertIncludes(main, "ipcMain.handle('disconnect-network-client'", 'main process should wire disconnect-client IPC');
  assertIncludes(main, "ipcMain.handle('allow-network-client'", 'main process should wire allow-client IPC');
  assertIncludes(preload, 'disconnectNetworkClient', 'preload should expose disconnect control to renderer');
  assertIncludes(preload, 'allowNetworkClient', 'preload should expose allow control to renderer');
  assertIncludes(renderer, 'data-client-key', 'renderer should put client keys in data attributes instead of inline JavaScript strings');
  assertIncludes(renderer, 'addEventListener(\'click\'', 'renderer should bind LAN monitor actions with event listeners');
  assert.ok(!renderer.includes('onclick="allowNetworkClient(\'${key}\')'), 'LAN monitor should not inject client keys into inline allow onclick handlers');
  assert.ok(!renderer.includes('onclick="disconnectNetworkClient(\'${key}\')'), 'LAN monitor should not inject client keys into inline disconnect onclick handlers');
  assertIncludes(renderer, 'disconnectNetworkClient', 'renderer should let operator disconnect a secondary client');
  assertIncludes(renderer, 'allowNetworkClient', 'renderer should let operator re-allow a secondary client');
  assertIncludes(renderer, 'renderNetworkMonitor({ showLoading: false })', 'LAN monitor auto-refresh should update silently without replacing the view with a loading state');
  assertIncludes(renderer, 'if (showLoading && !shell.dataset.hasRendered)', 'LAN monitor should show loading only for the first/manual render, not every timer tick');
  assertIncludes(renderer, 'if (shell.innerHTML !== nextHtml) shell.innerHTML = nextHtml;', 'LAN monitor should avoid unnecessary full DOM replacement when content did not change');
}


function testSignedSecondaryUpdateManifest() {
  const crypto = require('crypto');
  const updateSigning = require('./secondary-update-signing');
  const currentManifest = JSON.parse(read('update-secondary.json'));
  assert.strictEqual(currentManifest.appId, updateSigning.SECONDARY_UPDATE_APP_ID, 'secondary update manifest should be bound to secondary app id');
  assert.strictEqual(currentManifest.channel, updateSigning.SECONDARY_UPDATE_CHANNEL, 'secondary update manifest should be bound to stable channel');
  assert.strictEqual(currentManifest.signatureAlg, 'ed25519', 'secondary update manifest should use ed25519 signatures');
  assert.ok(updateSigning.verifySecondaryUpdateManifestSignature(currentManifest).ok, 'current secondary update manifest should verify with bundled public key');

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const signed = updateSigning.signSecondaryUpdateManifest({
    version: '9.9.9',
    url: 'https://example.test/secondary.exe',
    sha256: 'a'.repeat(64),
    publishedAt: '2026-05-25T00:00:00+07:00',
    notes: 'test only'
  }, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  assert.ok(updateSigning.verifySecondaryUpdateManifestSignature(signed, publicKey.export({ type: 'spki', format: 'pem' })).ok, 'valid signed test manifest should verify');
  assert.throws(
    () => updateSigning.verifySecondaryUpdateManifestSignature({ ...signed, sha256: 'b'.repeat(64) }, publicKey.export({ type: 'spki', format: 'pem' })),
    /ลายเซ็นอัปเดตเครื่องรองไม่ถูกต้อง/,
    'tampered manifest field should fail signature verification'
  );
}

async function testLanHmacRequestAuthentication() {
  const { createLocalNetworkServer } = require('./local-network-server');
  const { signLanRequest } = require('./lan-security');
  const server = createLocalNetworkServer({
    port: 0,
    discoveryPort: 0,
    roomCode: '555641',
    requireHmac: true,
    sendToWorker: async () => ({ imported: 1, skipped: 0 }),
    broadcastRefresh: () => {},
    logger: { log() {}, warn() {}, error() {} }
  });
  await server.start();
  try {
    const status = server.getStatus();
    const base = `http://127.0.0.1:${status.port}`;
    const body = JSON.stringify({
      rows: [{ plate: 'กข 1234', province: 'เชียงราย', type: 'รย' }],
      clientName: 'โต๊ะรอง HMAC',
      clientId: 'sec-hmac-001'
    });
    const baseHeaders = {
      'Content-Type': 'application/json',
      'X-Room-Code': '555641',
      'X-Client-Name': encodeURIComponent('โต๊ะรอง HMAC'),
      'X-Client-Id': 'sec-hmac-001'
    };

    const publicHealth = await fetch(`${base}/api/health`);
    const publicPayload = await publicHealth.json();
    assert.strictEqual(publicHealth.status, 200, 'public health should remain reachable for coarse app readiness');
    assert.strictEqual(publicPayload.roomCode, undefined, 'public health should not leak the active room code');
    assert.strictEqual(publicPayload.clients, undefined, 'public health should not leak secondary client list');

    const unsigned = await fetch(`${base}/api/intake-batches`, { method: 'POST', headers: baseHeaders, body });
    assert.strictEqual(unsigned.status, 401, 'requireHmac server should reject unsigned batch submits');

    const signedHeaders = signLanRequest({ method: 'POST', path: '/api/intake-batches', body, roomCode: '555641', clientId: 'sec-hmac-001' });
    const tampered = await fetch(`${base}/api/intake-batches`, {
      method: 'POST',
      headers: { ...baseHeaders, ...signedHeaders },
      body: body.replace('กข 1234', 'กข 9999')
    });
    assert.strictEqual(tampered.status, 401, 'tampered body should fail HMAC body hash verification');

    const valid = await fetch(`${base}/api/intake-batches`, { method: 'POST', headers: { ...baseHeaders, ...signedHeaders }, body });
    assert.strictEqual(valid.status, 200, 'valid HMAC signed batch should be accepted');

    const replay = await fetch(`${base}/api/intake-batches`, { method: 'POST', headers: { ...baseHeaders, ...signedHeaders }, body });
    assert.strictEqual(replay.status, 401, 'replayed HMAC request should be rejected by nonce cache');

    const expiredHeaders = signLanRequest({
      method: 'GET',
      path: '/api/health',
      body: '',
      roomCode: '555641',
      clientId: 'sec-hmac-001',
      now: new Date(Date.now() - 5 * 60 * 1000)
    });
    const expired = await fetch(`${base}/api/health`, { headers: { ...baseHeaders, ...expiredHeaders } });
    assert.strictEqual(expired.status, 401, 'expired HMAC health check should be rejected');
  } finally {
    server.stop();
  }
}

function testDatabasePathFallbackIsWritable() {
  const db = read('db.js');
  assertIncludes(db, '.write-test', 'database path selection should probe that the preferred D drive path is writable');
  assertIncludes(db, 'falling back to AppData', 'database path selection should fall back to AppData when D drive is unavailable');
}

function testScriptsIncludeSecondaryBuild() {
  const packageJson = JSON.parse(read('package.json'));
  assert.strictEqual(packageJson.version, '1.0.18', 'secondary fixed build should use a new installer version, not a stale same-version installer');
  assert.ok(packageJson.scripts['start:secondary'], 'package should provide start:secondary script');
  assert.ok(packageJson.scripts['prebuild:secondary'], 'secondary build should clean stale rebuild folders before packaging so operators see one latest build');
  assert.ok(packageJson.scripts['prebuild:secondary'].includes("n.startsWith('rebuild_')"), 'secondary prebuild cleanup should remove timestamped rebuild folders');
  assert.ok(packageJson.scripts['postbuild:secondary'], 'secondary build should remove win-unpacked after installer creation to avoid a second runnable app in latest folder');
  assert.ok(packageJson.scripts['postbuild:secondary'].includes('dist-secondary-latest/win-unpacked'), 'secondary postbuild cleanup should remove the unpacked app from the user-facing latest folder');
  assert.ok(packageJson.scripts['build:secondary'], 'package should provide build:secondary script');
}

async function testLanServerStableClientBlocking() {
  const { createLocalNetworkServer } = require('./local-network-server');
  const server = createLocalNetworkServer({
    port: 0,
    discoveryPort: 0,
    roomCode: '555641',
    sendToWorker: async () => ({ imported: 1, skipped: 0 }),
    broadcastRefresh: () => {},
    logger: { log() {}, warn() {}, error() {} }
  });
  await server.start();
  const status = server.getStatus();
  const base = `http://127.0.0.1:${status.port}`;
  const headers = {
    'X-Room-Code': '555641',
    'X-Client-Name': encodeURIComponent('โต๊ะรอง A'),
    'X-Client-Id': 'sec-stable-001'
  };

  const firstHealth = await fetch(`${base}/api/health`, { headers });
  assert.strictEqual(firstHealth.status, 200, 'initial stable client health should pass');
  const afterHealth = server.getStatus();
  assert.strictEqual(afterHealth.clients[0]?.key, 'client:sec-stable-001', 'client monitor should use stable client id key, not IP');

  assert.throws(() => server.disconnectClient('client:not-seen', 'fake'), /ไม่พบเครื่องลูก/, 'disconnect should reject fake client keys');
  server.disconnectClient('client:sec-stable-001', 'test block');

  const renamedHealth = await fetch(`${base}/api/health`, {
    headers: {
      ...headers,
      'X-Client-Name': encodeURIComponent('เปลี่ยนชื่อแล้ว')
    }
  });
  const renamedPayload = await renamedHealth.json();
  assert.strictEqual(renamedHealth.status, 403, 'blocked client should remain blocked even if name changes');
  assert.strictEqual(renamedPayload.blocked, true, 'blocked health should include blocked=true');

  server.allowClient('client:sec-stable-001');
  const allowedHealth = await fetch(`${base}/api/health`, { headers });
  assert.strictEqual(allowedHealth.status, 200, 'allowed client should reconnect successfully');
  server.stop();
}

async function testLanServerFallsBackWhenHttpPortIsBusy() {
  const http = require('http');
  const { createLocalNetworkServer } = require('./local-network-server');
  const busyServer = http.createServer((_req, res) => res.end('busy'));
  await new Promise((resolve, reject) => {
    busyServer.once('error', reject);
    busyServer.listen(0, '127.0.0.1', resolve);
  });
  const busyPort = busyServer.address().port;
  const server = createLocalNetworkServer({
    port: busyPort,
    discoveryPort: 0,
    roomCode: '555641',
    sendToWorker: async () => ({ imported: 1, skipped: 0 }),
    broadcastRefresh: () => {},
    logger: { log() {}, warn() {}, error() {} }
  });
  try {
    await server.start();
    const status = server.getStatus();
    assert.notStrictEqual(status.port, busyPort, 'main LAN HTTP server should auto-shift when the preferred port is busy');
    assert.ok(status.port > 0 && status.port <= 65535, 'auto-shifted LAN port should be valid');
  } finally {
    server.stop();
    await new Promise(resolve => busyServer.close(resolve));
  }
}

async function main() {
  testPairingModuleContract();
  testMainProgramExposesRoomServer();
  testSecondaryClientFilesAndContracts();
  testLanDataIntegrityGuards();
  testSignedSecondaryUpdateManifest();
  testDatabasePathFallbackIsWritable();
  testScriptsIncludeSecondaryBuild();
  await testLanServerStableClientBlocking();
  await testLanServerFallsBackWhenHttpPortIsBusy();
  await testLanHmacRequestAuthentication();
  console.log('✅ secondary client pairing tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
