/**
 * renderer.js — Ultra-responsive UI Logic
 * State management + Dark mode + Glassmorphism + Bulletproof error handling
 * Anti-freeze + memory optimization + user-friendly notifications
 */

const DEFAULT_UPDATE_MANIFEST_URL = 'https://raw.githubusercontent.com/singvichai3/-/main/update.json';
const TABLE_SERVICE_RATE = 20;
const IMPORT_PROFILES = {
    standard: {
        label: 'มาตรฐานเดิม',
        description: 'ใช้กับไฟล์ที่แยกคอลัมน์ รย / จยย และหัวตารางแบบเดิมของร้าน'
    },
    generic: {
        label: 'ตารางทั่วไป',
        description: 'ใช้กับไฟล์จากร้านอื่นที่มีหัวคอลัมน์ทั่วไป เช่น ทะเบียน ประเภท จังหวัด ยี่ห้อ วันนัด'
    }
};

const State = {
    records: [],
    totalCount: 0,
    currentPage: 1,
    pageSize: 50,
    currentView: 'import',
    currentFilter: 'all',
    searchQuery: '',
    advancedSearch: {
        plate: '',
        ownerName: '',
        phone: '',
        brand: '',
        province: '',
        importedFrom: '',
        importedTo: '',
        receivedFrom: '',
        receivedTo: ''
    },
    listDraftRecord: null,
    debounceTimer: null,
    selectedIds: new Set(),
    importData: [],
    importRawData: [],
    importFilePath: null,
    importProfile: 'standard',
    selectedImportDate: '',
    importDateOverride: false,
    manualEntries: [],
    tableMeta: { stationName: '', documentDate: '', appointmentDate: '', addCount: 10, deleteCount: 1, printLayout: 'auto' },
    tableSelectedRows: new Set(),
    tableSearchQuery: '',
    tableLastValidation: null,
    selectedImportSheets: [],
    sheetNames: [],
    currentSheetIndex: 0,
    fileBuffer: null,
    sheetCount: 0,
    darkMode: true,
    settings: { shopName: 'รับเล่มรถ ตรอ.', province: '', brands: '', retainYears: 5, updateManifestUrl: DEFAULT_UPDATE_MANIFEST_URL },
    systemHealth: null,
    virtualScroll: { rowHeight: 52, visibleCount: 0, startIndex: 0, endIndex: 0 },
    lastAction: null,
    isLoading: false,
    loadingStartedAt: 0,
    pendingLoadOptions: null,
    searchRequestSeq: 0,
    insightsTimer: null,
    insightsRequestSeq: 0,
    errorCount: 0,
    maxErrors: 5,
    searchHistory: [],
    searchUi: { historyVisible: false, lastMeta: 'พร้อมค้นหา', selectedPresetIndex: '' },
    searchInsights: { totalMatched: 0, byType: {}, byStatus: {}, topBrands: [] },
    dashboardChart: null,
    isSavingTableDraft: false,
    tableSearchTimer: null,
    hasAutoCheckedUpdates: false,
    pendingInteractionRecovery: false,
    // Request tracking for race condition prevention
    sequenceId: 0,
    pendingRequests: new Map(),
    // Rollback state for optimistic UI
    rollbackStack: new Map(),
    navOrder: ['import', 'table', 'dashboard', 'network', 'list', 'settings']
};

const IMPORT_PREVIEW_ROW_LIMIT = 300;
const IMPORT_CONFIRM_PLATE_LIMIT = 80;
const DATE_FORMATTER = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC'
});
const DATETIME_FORMATTER = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Bangkok'
});

function formatDate(iso) {
    if (!iso) return '-';
    try {
        const text = String(iso).trim();
        const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        const date = isoMatch
            ? new Date(Date.UTC(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3])))
            : new Date(text);
        if (Number.isNaN(date.getTime())) return text;
        return DATE_FORMATTER.format(date);
    } catch {
        return String(iso);
    }
}

function formatDateTime(iso) {
    if (!iso) return '-';
    try {
        const date = new Date(iso);
        if (Number.isNaN(date.getTime())) return String(iso);
        return DATETIME_FORMATTER.format(date);
    } catch {
        return String(iso);
    }
}

// Generate UUID v4
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// Debug panel functions
function showDebug() {
    const panel = document.getElementById('debug-panel');
    if (panel) panel.style.display = 'block';
}

function hideDebug() {
    const panel = document.getElementById('debug-panel');
    if (panel) panel.style.display = 'none';
}

function clearDebug() {
    const content = document.getElementById('debug-content');
    if (content) content.textContent = '';
}

function addDebugLog(message) {
    const content = document.getElementById('debug-content');
    if (content) {
        const timestamp = new Date().toLocaleTimeString('th-TH');
        content.textContent += `[${timestamp}] ${message}\n`;
        content.scrollTop = content.scrollHeight;
    }
}

// Override console.log to also show in debug panel
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

console.log = function(...args) {
    originalLog.apply(console, args);
    addDebugLog(args.join(' '));
};

console.error = function(...args) {
    originalError.apply(console, args);
    addDebugLog('❌ ERROR: ' + args.join(' '));
};

console.warn = function(...args) {
    originalWarn.apply(console, args);
    addDebugLog('⚠️ WARN: ' + args.join(' '));
};

// ==========================================
// SEQUENCE ID & REQUEST TRACKING
// ==========================================
function getNextSequenceId() {
    return window.RendererRecordActionsModule.getNextSequenceId({ State });
}

function trackRequest(seqId, rollbackFn) {
    return window.RendererRecordActionsModule.trackRequest({ State }, seqId, rollbackFn);
}

function completeRequest(seqId) {
    return window.RendererRecordActionsModule.completeRequest({ State }, seqId);
}

function isStaleRequest(seqId) {
    return window.RendererRecordActionsModule.isStaleRequest({ State }, seqId);
}

// Rollback helper with toast notification
function pushRollback(id, previousState) {
    return window.RendererRecordActionsModule.pushRollback({ State }, id, previousState);
}

function executeRollback(id) {
    return window.RendererRecordActionsModule.executeRollback({ State }, id);
}

// ==========================================
// INITIALIZATION WITH RECOVERY
// ==========================================
async function init() {
    try {
        console.log('🚀 Initializing Ultra-responsive UI...');
        const pendingPostImportReset = consumePostImportReset();
        
        // Check if api is available
        if (typeof window.api === 'undefined') {
            console.error('❌ API not available, waiting for preload...');
            setTimeout(init, 500);
            return;
        }
        
        loadTheme();
        updateClock();
        setInterval(updateClock, 1000); // Update every 1 second for better visibility
        await loadSettings();
        startNetworkRoomMonitor();
        ensureTableDraftState();
        loadSearchHistory();
        applySavedTableDensity();
        setupSearchDebounce();
        // รอ DOM render เสร็จก่อนค่อย setup virtual scroll
        setTimeout(() => {
            setupVirtualScroll();
        }, 100);
        setupKeyboardShortcuts();
        setupSearchUiEvents();
        setupUpdateProgressListener();
        setupImportProgressListener();
        setupErrorListener();
        setupDragAndDrop();
        setupRefreshListener();
        setupSidebarDrag();
        setupNavReorder();
        if (pendingPostImportReset) {
            switchView('list');
            setTimeout(() => {
                focusSearchInput(true);
                const imported = Number(pendingPostImportReset.imported || 0);
                const skipped = Number(pendingPostImportReset.skipped || 0);
                showNotification(`พร้อมใช้งานแล้ว • นำเข้า ${imported.toLocaleString()} คัน • ข้ามซ้ำ ${skipped.toLocaleString()} คัน`, 'success');
            }, 280);
        } else {
            switchView('import');
        }
        setTimeout(() => {
            autoCheckForUpdatesOnStartup();
        }, 1200);
        console.log('✅ System initialized successfully');
    } catch (error) {
        console.error('❌ Init error:', error);
        showNotification('เกิดข้อผิดพลาดในการเริ่มต้น: ' + error.message, 'error');
        retryInit();
    }
}

function retryInit() {
    setTimeout(async () => {
        try {
            State.errorCount = 0;
            await loadSettings();
            switchView('list');
            showNotification('รีสตาร์ทระบบสำเร็จ', 'success');
        } catch (e) {
            State.errorCount++;
            if (State.errorCount < State.maxErrors) retryInit();
        }
    }, 2000);
}

async function updateNetworkRoomDisplay() {
    const badge = document.getElementById('network-room-display');
    if (!badge || !api?.getNetworkServerStatus) return;
    try {
        const status = await api.getNetworkServerStatus();
        if (status?.roomCode) {
            const ip = status.recommendedAddress || status.addresses?.[0]?.address || 'เครื่องนี้';
            const clients = Array.isArray(status.clients) ? status.clients : [];
            const lastClient = clients[0];
            const monitorText = status.clientCount > 0
                ? `รอง ${status.clientCount} • ${lastClient?.name || 'ล่าสุด'}`
                : 'รอเครื่องรอง';
            badge.textContent = `ห้อง ${status.roomCode} • ${ip} • ${monitorText}`;
            badge.dataset.roomCode = status.roomCode;
            badge.title = clients.length
                ? `คลิกเพื่อเปลี่ยนรหัสห้อง • เครื่องรองล่าสุด: ${clients.map(client => `${client.name || 'เครื่องรอง'} ${client.address || ''} ${client.lastAction || ''}`).join(' | ')}`
                : `คลิกเพื่อเปลี่ยนรหัสห้อง • ให้เครื่องรองใส่รหัส ${status.roomCode}`;
        } else {
            badge.textContent = 'ห้อง: เปิดไม่ได้';
            badge.title = status?.error || 'เปิดระบบเชื่อมต่อเครื่องรองไม่สำเร็จ';
        }
    } catch (error) {
        badge.textContent = 'ห้อง: เปิดไม่ได้';
        badge.title = error.message;
    }
}

function startNetworkRoomMonitor() {
    updateNetworkRoomDisplay();
    if (window.__networkRoomMonitorTimer) clearInterval(window.__networkRoomMonitorTimer);
    window.__networkRoomMonitorTimer = setInterval(() => {
        updateNetworkRoomDisplay();
        // อัปเดตหน้า LAN monitor แบบเงียบ ๆ เท่านั้น — ห้ามล้าง shell เป็น "กำลังโหลด" ทุก 5 วิ เพราะจะทำให้หน้ากระพริบ
        if (State.currentView === 'network') renderNetworkMonitor({ showLoading: false });
    }, 5000);
}

async function promptSetNetworkRoomCode() {
    if (!api?.setNetworkRoomCode) return;
    const badge = document.getElementById('network-room-display');
    const currentCode = badge?.dataset?.roomCode || '';
    const input = await openTextPrompt({
        title: 'ตั้งรหัสห้องเครื่องหลัก',
        message: 'ใส่รหัสตัวเลข 6 หลัก เช่น 555641 แล้วให้เครื่องรองใช้รหัสเดียวกัน',
        defaultValue: currentCode,
        placeholder: '555641',
        confirmText: 'บันทึกรหัส',
        cancelText: 'ยกเลิก',
        emptyError: 'กรุณากรอกรหัสห้อง 6 หลัก'
    });
    if (input === null) return;
    const roomCode = String(input || '').replace(/\D/g, '');
    if (!/^\d{6}$/.test(roomCode)) {
        showNotification('❌ รหัสห้องต้องเป็นตัวเลข 6 หลัก เช่น 555641', 'error', 6000);
        return;
    }
    try {
        const status = await api.setNetworkRoomCode(roomCode);
        await updateNetworkRoomDisplay();
        if (State.currentView === 'network') await renderNetworkMonitor();
        showNotification(`✅ เปลี่ยนรหัสห้องเป็น ${status.roomCode} แล้ว`, 'success', 5000);
    } catch (error) {
        showNotification(`❌ เปลี่ยนรหัสห้องไม่สำเร็จ: ${error.message}`, 'error', 7000);
    }
}

function formatLanAge(iso) {
    if (!iso) return '-';
    const diffMs = Date.now() - Date.parse(iso);
    if (!Number.isFinite(diffMs)) return formatDateTime(iso);
    const seconds = Math.max(0, Math.floor(diffMs / 1000));
    if (seconds < 60) return `${seconds} วินาทีที่แล้ว`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} นาทีที่แล้ว`;
    return formatDateTime(iso);
}

async function renderNetworkMonitor(options = {}) {
    const { showLoading = true } = options || {};
    const shell = document.getElementById('network-monitor-shell');
    if (!shell || !api?.getNetworkServerStatus) return;
    if (showLoading && !shell.dataset.hasRendered) shell.innerHTML = '<div class="lan-empty">กำลังโหลดสถานะ LAN...</div>';
    try {
        const status = await api.getNetworkServerStatus();
        const clients = Array.isArray(status.clients) ? status.clients : [];
        const addresses = Array.isArray(status.addresses) ? status.addresses : [];
        const addressText = addresses.map(item => `${item.address}${item.recommended ? ' ⭐' : ''}`).join(' / ') || status.recommendedAddress || '-';
        const summaryHtml = `
            <div class="lan-monitor-grid">
                <div class="lan-monitor-card"><h3>รหัสห้อง</h3><div class="lan-monitor-value">${escapeHtml(status.roomCode || '-')}</div><div class="lan-client-meta">ให้เครื่องรองใช้รหัสนี้ในการจับคู่</div></div>
                <div class="lan-monitor-card"><h3>IP เครื่องหลัก</h3><div class="lan-monitor-value" style="font-size:17px;">${escapeHtml(status.recommendedAddress || '-')}</div><div class="lan-client-meta">ทั้งหมด: ${escapeHtml(addressText)}</div></div>
                <div class="lan-monitor-card"><h3>เครื่องลูก</h3><div class="lan-monitor-value">${Number(status.clientCount || 0)}</div><div class="lan-client-meta">ถูกตัด: ${Number(status.blockedCount || 0)} เครื่อง</div></div>
                <div class="lan-monitor-card"><h3>พอร์ต</h3><div class="lan-monitor-value">${escapeHtml(status.port || '-')}</div><div class="lan-client-meta">HTTP health/submit ผ่าน LAN</div></div>
            </div>`;
        const clientHtml = clients.length ? clients.map(client => {
            const blocked = Boolean(client.blocked);
            const key = escapeHtml(client.key || '');
            const actionButton = blocked
                ? `<button class="btn btn-success lan-client-action" type="button" data-action="allow" data-client-key="${key}">✅ ปลดบล็อก</button>`
                : `<button class="btn btn-danger lan-client-action" type="button" data-action="disconnect" data-client-key="${key}">⛔ ตัดการเชื่อมต่อ</button>`;
            return `
                <div class="lan-client-row ${blocked ? 'blocked' : ''}">
                    <div>
                        <div class="lan-client-name">${escapeHtml(client.name || 'เครื่องรอง')}</div>
                        <div style="margin-top:6px;"><span class="lan-status-pill ${blocked ? 'blocked' : ''}">${blocked ? 'ถูกตัดการเชื่อมต่อ' : 'ออนไลน์/ล่าสุดยังติดต่อมา'}</span></div>
                        <div class="lan-client-meta">
                            IP: <strong>${escapeHtml(client.address || '-')}</strong><br>
                            วิธีเชื่อมต่อ: ${escapeHtml(client.connectionType || 'LAN HTTP')}<br>
                            เห็นครั้งแรก: ${escapeHtml(formatDateTime(client.firstSeenAt))}<br>
                            ล่าสุด: ${escapeHtml(formatLanAge(client.lastSeenAt))} (${escapeHtml(formatDateTime(client.lastSeenAt))})<br>
                            การทำงานล่าสุด: ${escapeHtml(client.lastAction || '-')} ${client.lastBatchId ? `• Batch ${escapeHtml(client.lastBatchId)}` : ''}<br>
                            บันทึกล่าสุด: ${Number(client.lastImported || 0)} / ข้ามซ้ำ: ${Number(client.lastSkipped || 0)}
                            ${blocked ? `<br>เหตุผล: ${escapeHtml(client.blockedReason || '-')} • เวลา: ${escapeHtml(formatDateTime(client.blockedAt))}` : ''}
                        </div>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:8px; min-width:150px;">${actionButton}</div>
                </div>`;
        }).join('') : '<div class="lan-empty">ยังไม่มีเครื่องลูกเชื่อมต่อ ให้เปิดโปรแกรมเครื่องรองแล้วใส่รหัสห้อง</div>';
        const nextHtml = `${summaryHtml}<div class="lan-client-list">${clientHtml}</div>`;
        if (shell.innerHTML !== nextHtml) shell.innerHTML = nextHtml;
        shell.dataset.hasRendered = '1';
        shell.querySelectorAll('.lan-client-action').forEach((button) => {
            button.addEventListener('click', () => {
                const clientKey = button.dataset.clientKey || '';
                if (button.dataset.action === 'allow') allowNetworkClient(clientKey);
                else disconnectNetworkClient(clientKey);
            });
        });
    } catch (error) {
        if (showLoading || !shell.dataset.hasRendered) {
            shell.innerHTML = `<div class="lan-empty">โหลดมอนิเตอร์ไม่สำเร็จ: ${escapeHtml(error.message || error)}</div>`;
        }
    }
}

async function disconnectNetworkClient(clientKey) {
    if (!api?.disconnectNetworkClient) return;
    const reason = await openTextPrompt({
        title: 'ตัดการเชื่อมต่อเครื่องลูก',
        message: 'เครื่องลูกนี้จะถูกบล็อกไม่ให้ health check หรือส่งข้อมูลเข้าเครื่องหลัก จนกว่าจะปลดบล็อก',
        defaultValue: 'ตัดจากเครื่องหลัก',
        placeholder: 'เหตุผล',
        confirmText: 'ตัดการเชื่อมต่อ',
        cancelText: 'ยกเลิก',
        emptyError: 'กรุณาระบุเหตุผล'
    });
    if (reason === null) return;
    try {
        await api.disconnectNetworkClient(clientKey, reason);
        await updateNetworkRoomDisplay();
        await renderNetworkMonitor();
        showNotification('✅ ตัดการเชื่อมต่อเครื่องลูกแล้ว', 'success', 5000);
    } catch (error) {
        showNotification(`❌ ตัดการเชื่อมต่อไม่สำเร็จ: ${error.message}`, 'error', 7000);
    }
}

async function allowNetworkClient(clientKey) {
    if (!api?.allowNetworkClient) return;
    try {
        await api.allowNetworkClient(clientKey);
        await updateNetworkRoomDisplay();
        await renderNetworkMonitor();
        showNotification('✅ ปลดบล็อกเครื่องลูกแล้ว เครื่องรองจะเชื่อมใหม่ได้ในรอบตรวจถัดไป', 'success', 6000);
    } catch (error) {
        showNotification(`❌ ปลดบล็อกไม่สำเร็จ: ${error.message}`, 'error', 7000);
    }
}

// ==========================================
// THEME MANAGEMENT (Dark Mode Toggle)
// ==========================================
function loadTheme() {
    try {
        const saved = localStorage.getItem('theme');
        State.darkMode = saved !== 'light';
        applyTheme();
    } catch {
        State.darkMode = true;
        applyTheme();
    }
}

function toggleTheme() {
    State.darkMode = !State.darkMode;
    localStorage.setItem('theme', State.darkMode ? 'dark' : 'light');
    applyTheme();
    showNotification(State.darkMode ? '🌙 เปิดโหมดมืด' : '☀️ เปิดโหมดสว่าง', 'success');
}

function applyTheme() {
    document.body.setAttribute('data-theme', State.darkMode ? 'dark' : 'light');
    const themeBtn = document.getElementById('theme-toggle');
    if (themeBtn) themeBtn.textContent = State.darkMode ? '☀️' : '🌙';
    if (State.currentView === 'dashboard') {
        loadDashboard();
    }
}

function applySavedTableDensity() {
    try {
        const rowValue = localStorage.getItem('table-row-spacing') || '12';
        const columnValue = localStorage.getItem('table-col-spacing') || '14';
        updateTableDensity('row', rowValue, false);
        updateTableDensity('column', columnValue, false);
    } catch {
        updateTableDensity('row', 12, false);
        updateTableDensity('column', 14, false);
    }
}

function updateTableDensity(axis, value, persist = true) {
    const root = document.documentElement;
    const numericValue = Number(value);
    if (!root || Number.isNaN(numericValue)) return;

    if (axis === 'row') {
        root.style.setProperty('--table-cell-padding-y', `${numericValue}px`);
        const input = document.getElementById('table-row-spacing');
        if (input && input.value !== String(numericValue)) input.value = String(numericValue);
        if (persist) localStorage.setItem('table-row-spacing', String(numericValue));
    }

    if (axis === 'column') {
        root.style.setProperty('--table-cell-padding-x', `${numericValue}px`);
        const input = document.getElementById('table-col-spacing');
        if (input && input.value !== String(numericValue)) input.value = String(numericValue);
        if (persist) localStorage.setItem('table-col-spacing', String(numericValue));
    }
}

function resetTableDensity() {
    updateTableDensity('row', 12);
    updateTableDensity('column', 14);
}

function setupSidebarDrag() {
    const panel = document.querySelector('.sidebar-panel');
    const handle = document.getElementById('sidebar-drag-handle');
    const app = document.getElementById('app');
    if (!panel || !handle || !app) return;

    let startY = 0;
    let startOffset = 0;
    let dragging = false;

    const applyOffset = (offset) => {
        const appHeight = app.clientHeight || window.innerHeight;
        const panelHeight = panel.offsetHeight || appHeight;
        const maxOffset = Math.max(0, appHeight - panelHeight);
        const nextOffset = Math.min(Math.max(0, offset), maxOffset);
        panel.style.transform = `translateY(${nextOffset}px)`;
        return nextOffset;
    };

    try {
        const saved = Number(localStorage.getItem('sidebar-offset-y') || '0');
        if (!Number.isNaN(saved) && window.innerWidth > 1100) {
            applyOffset(saved);
        }
    } catch {
        panel.style.transform = 'translateY(0px)';
    }

    handle.addEventListener('mousedown', (event) => {
        if (window.innerWidth <= 1100) return;
        dragging = true;
        startY = event.clientY;
        const match = /translateY\(([-\d.]+)px\)/.exec(panel.style.transform || '');
        startOffset = match ? Number(match[1]) : 0;
        panel.classList.add('dragging');
        event.preventDefault();
    });

    window.addEventListener('mousemove', (event) => {
        if (!dragging) return;
        const offset = applyOffset(startOffset + (event.clientY - startY));
        localStorage.setItem('sidebar-offset-y', String(offset));
    });

    window.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        panel.classList.remove('dragging');
    });

    window.addEventListener('resize', () => {
        if (window.innerWidth <= 1100) {
            panel.style.transform = 'translateY(0px)';
            return;
        }
        const match = /translateY\(([-\d.]+)px\)/.exec(panel.style.transform || '');
        const currentOffset = match ? Number(match[1]) : 0;
        const nextOffset = applyOffset(currentOffset);
        localStorage.setItem('sidebar-offset-y', String(nextOffset));
    });
}

// ==========================================
// ERROR LISTENER
// ==========================================
function setupErrorListener() {
    window.addEventListener('error', (e) => {
        console.error('Runtime error:', e.error);
        handleRuntimeError(e.error);
    });

    window.addEventListener('unhandledrejection', (e) => {
        console.error('Unhandled rejection:', e.reason);
    });
}

function handleRuntimeError(error) {
    State.errorCount++;
    if (State.errorCount >= State.maxErrors) {
        showNotification('ระบบพบข้อผิดพลาดซ้ำ กำลังรีสตาร์ท...', 'warning');
        setTimeout(() => location.reload(), 2000);
    }
}

// ==========================================
// REFRESH LISTENER (Data Sync)
// ==========================================
function setupRefreshListener() {
    return window.RendererSearchLoadCoordinationModule.setupRefreshListener({
        State,
        api,
        loadData,
        updateStats
    });
}

// ==========================================
// VIEW SWITCHING
// ==========================================
function switchView(viewId) {
    return window.RendererListViewControllerModule.switchView({
        State,
        hideLoading,
        setupVirtualScroll,
        loadData,
        updateStats,
        renderManualEntryTable,
        syncTableMetaInputs,
        syncBulkEditInput,
        syncPrintLayoutControls,
        loadDashboard,
        renderNetworkMonitor,
        showNotification
    }, viewId, arguments[1] || {});
}

function normalizeNavOrder(viewIds) {
    const defaults = ['import', 'table', 'dashboard', 'network', 'list', 'settings'];
    const unique = Array.from(new Set((Array.isArray(viewIds) ? viewIds : []).filter(Boolean)));
    defaults.forEach(viewId => {
        if (!unique.includes(viewId)) unique.push(viewId);
    });
    return unique;
}

function refreshNavDropMarkers() {
    const nav = document.querySelector('.sidebar-nav');
    if (!nav) return;

    nav.querySelectorAll('.nav-drop-marker').forEach(marker => marker.remove());

    const items = Array.from(nav.querySelectorAll('.nav-item'));
    items.forEach(item => {
        const marker = document.createElement('div');
        marker.className = 'nav-drop-marker';
        marker.setAttribute('aria-hidden', 'true');
        nav.insertBefore(marker, item);
    });

    const trailingMarker = document.createElement('div');
    trailingMarker.className = 'nav-drop-marker';
    trailingMarker.setAttribute('aria-hidden', 'true');
    nav.appendChild(trailingMarker);
}

function persistNavOrder() {
    const nav = document.querySelector('.sidebar-nav');
    if (!nav) return;

    State.navOrder = Array.from(nav.querySelectorAll('.nav-item'))
        .map(item => item.dataset.view)
        .filter(Boolean);

    localStorage.setItem('navOrder', JSON.stringify(State.navOrder));
}

function applySavedNavOrder() {
    const nav = document.querySelector('.sidebar-nav');
    if (!nav) return;

    let savedOrder = State.navOrder;
    try {
        const raw = localStorage.getItem('navOrder');
        if (raw) savedOrder = JSON.parse(raw);
    } catch (error) {
        console.warn('Nav order parse error:', error);
    }

    State.navOrder = normalizeNavOrder(savedOrder);

    const itemMap = new Map(
        Array.from(nav.querySelectorAll('.nav-item')).map(item => [item.dataset.view, item])
    );

    State.navOrder.forEach(viewId => {
        const item = itemMap.get(viewId);
        if (item) nav.appendChild(item);
    });

    refreshNavDropMarkers();
}

function setupNavReorder() {
    const nav = document.querySelector('.sidebar-nav');
    if (!nav) return;

    applySavedNavOrder();

    if (nav.dataset.reorderReady === 'true') return;
    nav.dataset.reorderReady = 'true';

    let draggedItem = null;
    let activeMarker = null;
    let dropIndex = -1;

    const getItems = () => Array.from(nav.querySelectorAll('.nav-item'));
    const clearMarkers = () => {
        nav.querySelectorAll('.nav-drop-marker').forEach(marker => marker.classList.remove('visible'));
        activeMarker = null;
        dropIndex = -1;
    };

    const getDropIndex = (clientY) => {
        const items = getItems().filter(item => item !== draggedItem);
        for (let index = 0; index < items.length; index++) {
            const rect = items[index].getBoundingClientRect();
            if (clientY < rect.top + rect.height / 2) {
                return index;
            }
        }
        return items.length;
    };

    const bindItems = () => {
        getItems().forEach(item => {
            item.draggable = true;
            if (item.dataset.dragBound === 'true') return;
            item.dataset.dragBound = 'true';

            item.addEventListener('dragstart', () => {
                draggedItem = item;
                item.classList.add('dragging-item');
            });

            item.addEventListener('dragend', () => {
                item.classList.remove('dragging-item');
                draggedItem = null;
                clearMarkers();
            });
        });
    };

    bindItems();

    nav.addEventListener('dragover', (event) => {
        if (!draggedItem) return;
        event.preventDefault();

        const markers = Array.from(nav.querySelectorAll('.nav-drop-marker'));
        const nextDropIndex = getDropIndex(event.clientY);
        clearMarkers();
        activeMarker = markers[nextDropIndex] || null;
        dropIndex = nextDropIndex;
        if (activeMarker) activeMarker.classList.add('visible');
    });

    nav.addEventListener('dragleave', (event) => {
        if (!nav.contains(event.relatedTarget)) clearMarkers();
    });

    nav.addEventListener('drop', (event) => {
        if (!draggedItem) return;
        event.preventDefault();

        const items = getItems().filter(item => item !== draggedItem);
        const referenceItem = items[dropIndex] || null;
        nav.insertBefore(draggedItem, referenceItem);

        refreshNavDropMarkers();
        bindItems();
        persistNavOrder();
        clearMarkers();
    });
}

// ==========================================
// CLOCK
// ==========================================
function updateClock() {
    try {
        const now = new Date();
        const thaiMonths = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
        const thaiDays = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
        const dayName = thaiDays[now.getDay()];
        const day = now.getDate();
        const month = thaiMonths[now.getMonth()];
        const year = now.getFullYear() + 543;
        const time = now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        const dateEl = document.getElementById('current-date');
        if (dateEl) {
            dateEl.textContent = `${dayName} ${day} ${month} ${year} ${time}`;
        } else {
            console.warn('⚠️ current-date element not found');
        }
    } catch (e) {
        console.error('❌ Clock update error:', e);
    }
}

// ==========================================
// SEARCH WITH DEBOUNCE (150ms)
// ==========================================
function setupSearchDebounce() {
    return window.RendererSearchWorkflowModule.setupSearchDebounce({
        State,
        renderSearchHistory,
        updateSearchMeta,
        toggleSearchHistory,
        loadData,
        updateSearchClearButton,
        scheduleSearchInsightsRefresh
    });
}

function scheduleSearchInsightsRefresh(delay = 450) {
    return window.RendererSearchWorkflowModule.scheduleSearchInsightsRefresh({
        State,
        api,
        getSearchParams,
        renderSearchInsights
    }, delay);
}

function updateQuickAppointmentDateInput() {
    return window.RendererSearchStateModule.updateQuickAppointmentDateInput({ State });
}

function setupSearchUiEvents() {
    return window.RendererSearchWorkflowModule.setupSearchUiEvents({
        toggleSearchHistory,
        updateSearchClearButton,
        updateAdvancedSearchSummary,
        updateQuickAppointmentDateInput,
        renderSearchPresets,
        renderSearchInsights
    });
}

function loadSearchHistory() {
    return window.RendererSearchStateModule.loadSearchHistory({ State });
}

function saveSearchHistory() {
    return window.RendererSearchStateModule.saveSearchHistory({ State });
}

function updateAppUpdateStatus(message, tone = 'muted') {
    const statusEl = document.getElementById('app-update-status');
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.dataset.tone = tone;
}

async function loadAppVersionInfo() {
    if (!window.api?.getAppVersion) return;
    try {
        const version = await api.getAppVersion();
        const versionEl = document.getElementById('app-version-label');
        if (versionEl) versionEl.textContent = `เวอร์ชันปัจจุบัน ${version}`;
    } catch (error) {
        console.warn('Load app version error:', error);
    }
}

function setupUpdateProgressListener() {
    if (!window.api?.onUpdateDownloadProgress) return;

    api.onUpdateDownloadProgress((payload) => {
        const percent = typeof payload?.percent === 'number' ? payload.percent : null;
        const message = percent !== null
            ? `กำลังดาวน์โหลดอัปเดต ${payload.version || ''} ${percent}%`
            : `กำลังดาวน์โหลดอัปเดต ${payload?.version || ''}`;

        updateAppUpdateStatus(message.trim(), 'progress');
        const loadingText = document.getElementById('loading-text');
        if (loadingText) loadingText.textContent = message.trim();
    });
}

function addRecentSearch(query) {
    return window.RendererSearchStateModule.addRecentSearch({
        State,
        saveSearchHistory,
        renderSearchHistory
    }, query);
}

function renderSearchHistory() {
    return window.RendererSearchWorkflowModule.renderSearchHistory({ State, escapeHTML });
}

function toggleSearchHistory(visible) {
    return window.RendererSearchWorkflowModule.toggleSearchHistory({ State }, visible);
}

function updateSearchClearButton() {
    return window.RendererSearchWorkflowModule.updateSearchClearButton({ State });
}

function updateSearchMeta(text) {
    return window.RendererSearchWorkflowModule.updateSearchMeta({ State }, text);
}

function getSearchParams() {
    return window.RendererSearchWorkflowModule.getSearchParams({ State });
}

function getActiveAdvancedSearchCount() {
    return window.RendererSearchWorkflowModule.getActiveAdvancedSearchCount({ State });
}

function hasAnySearchFilters() {
    return Boolean(
        State.searchQuery ||
        State.currentFilter !== 'all' ||
        getActiveAdvancedSearchCount() > 0
    );
}

function updateAdvancedSearchSummary() {
    return window.RendererSearchWorkflowModule.updateAdvancedSearchSummary({ getActiveAdvancedSearchCount });
}

function renderSearchInsights() {
    return window.RendererSearchWorkflowModule.renderSearchInsights({
        State,
        escapeHTML,
        hasAnySearchFilters
    });
}

function syncAdvancedSearchForm() {
    return window.RendererSearchWorkflowModule.syncAdvancedSearchForm({
        State,
        updateQuickAppointmentDateInput,
        updateAdvancedSearchSummary
    });
}

function toggleAdvancedSearch(force) {
    return window.RendererSearchStateModule.toggleAdvancedSearch({ syncAdvancedSearchForm }, force);
}

function applyAdvancedSearch() {
    return window.RendererSearchStateModule.applyAdvancedSearch({
        State,
        updateQuickAppointmentDateInput,
        updateAdvancedSearchSummary,
        toggleAdvancedSearch,
        loadData
    });
}

function resetAdvancedSearch() {
    return window.RendererSearchStateModule.resetAdvancedSearch({
        State,
        syncAdvancedSearchForm,
        loadData
    });
}

function clearAllSearchFilters() {
    return window.RendererSearchWorkflowModule.clearAllSearchFilters({
        State,
        renderSearchHistory,
        renderSearchPresets,
        syncAdvancedSearchForm,
        updateSearchMeta,
        loadData,
        updateSearchClearButton
    });
}

function applyQuickAppointmentDate(value) {
    return window.RendererSearchWorkflowModule.applyQuickAppointmentDate({
        State,
        updateQuickAppointmentDateInput,
        updateAdvancedSearchSummary,
        updateSearchMeta,
        loadData
    }, value);
}

function clearQuickAppointmentDate() {
    return window.RendererSearchWorkflowModule.clearQuickAppointmentDate({ applyQuickAppointmentDate });
}

function renderSearchPresets() {
    return window.RendererSearchPresetModule.renderSearchPresets({ State, escapeHTML });
}

function saveCurrentSearchPreset() {
    return window.RendererSearchFeaturePackModule.saveCurrentSearchPreset({
        State,
        api,
        openTextPrompt,
        renderSearchPresets,
        showNotification
    });
}

function applySearchPreset(index) {
    return window.RendererSearchFeaturePackModule.applySearchPreset({
        State,
        syncAdvancedSearchForm,
        loadData,
        updateSearchClearButton,
        showNotification
    }, index);
}

function removeCurrentSearchPreset() {
    return window.RendererSearchFeaturePackModule.removeCurrentSearchPreset({
        State,
        api,
        renderSearchPresets,
        showNotification
    });
}

function closeTextPrompt(result = null) {
    return window.RendererSearchPresetModule.closeTextPrompt({}, result);
}

function openTextPrompt(options = {}) {
    return window.RendererSearchPresetModule.openTextPrompt({ closeTextPrompt }, options);
}

function submitTextPrompt() {
    return window.RendererSearchPresetModule.submitTextPrompt({ closeTextPrompt, showNotification });
}

function handleTextPromptKeydown(event) {
    return window.RendererSearchPresetModule.handleTextPromptKeydown({ submitTextPrompt, closeTextPrompt }, event);
}

function applyInsightBrand(brand) {
    return window.RendererSearchFeaturePackModule.applyInsightBrand({ State, syncAdvancedSearchForm, loadData }, brand);
}

function applySmartSearch(mode) {
    return window.RendererSearchFeaturePackModule.applySmartSearch({ State, syncAdvancedSearchForm, loadData }, mode);
}

function applySearchHistory(query) {
    return window.RendererSearchFeaturePackModule.applySearchHistory({
        State,
        updateSearchClearButton,
        updateSearchMeta,
        toggleSearchHistory,
        loadData
    }, query);
}

function clearSearch() {
    return window.RendererSearchWorkflowModule.clearSearch({
        State,
        updateSearchClearButton,
        renderSearchHistory,
        updateSearchMeta,
        loadData
    });
}

function focusSearchInput(selectText = false) {
    return window.RendererSearchWorkflowModule.focusSearchInput({ renderSearchHistory, toggleSearchHistory }, selectText);
}

function recoverSearchInteraction(options = {}) {
    return window.RendererSearchWorkflowModule.recoverSearchInteraction({ State, toggleSearchHistory }, options);
}

// ==========================================
// FILTERS
// ==========================================
function setFilter(filter) {
    return window.RendererListViewControllerModule.setFilter({
        State,
        loadData,
        showNotification
    }, filter);
}

// ==========================================
// DATA LOADING WITH ERROR HANDLING
// ==========================================
function normalizeLoadOptions(options = {}) {
    return window.RendererSearchLoadCoordinationModule.normalizeLoadOptions({}, options);
}

async function loadData(options = {}) {
    return window.RendererSearchLoadCoordinationModule.loadData({
        State,
        api,
        normalizeLoadOptions,
        getSearchParams,
        getActiveAdvancedSearchCount,
        updateSearchMeta,
        addRecentSearch,
        renderTable,
        updatePagination,
        updateSearchClearButton,
        renderSearchInsights,
        showNotification,
        loadData
    }, options);
}

// ==========================================
// VIRTUAL SCROLLING (Anti-freeze)
// ==========================================
function setupVirtualScroll() {
    return window.RendererTableVirtualScrollModule.setupVirtualScroll({
        State,
        handleScroll,
        renderTable
    });
}

function handleScroll() {
    return window.RendererTableVirtualScrollModule.handleScroll({
        State,
        renderVisibleRows
    });
}

function renderTable() {
    return window.RendererTableVirtualScrollModule.renderTable({
        State,
        renderVisibleRows
    });
}

function renderVisibleRows() {
    return window.RendererTableVirtualScrollModule.renderVisibleRows({
        State,
        formatDate,
        createDraftRowHTML,
        createRowHTML
    });
}

function createDraftRowHTML() {
    const row = State.listDraftRecord;
    if (!row) return '';

    const hasAttempted = row._touched;
    const invalidPlate = hasAttempted && !String(row.plate || '').trim();
    const invalidDate = hasAttempted && !String(row.importedAt || '').trim();

    return `
        <tr class="row-draft">
            <td></td>
            <td>ใหม่</td>
            <td><input class="inline-input mono list-plate-input ${invalidPlate ? 'field-invalid' : ''}" value="${escapeHTML(row.plate || '')}" oninput="updateListDraftField('plate', this.value)" placeholder="ทะเบียน"></td>
            <td><input class="inline-input list-province-input" value="${escapeHTML(row.province || '')}" oninput="updateListDraftField('province', this.value)" placeholder="จังหวัด"></td>
            <td>
                <select class="inline-select type-select" oninput="updateListDraftField('type', this.value)">
                    <option value="รย" ${row.type === 'รย' ? 'selected' : ''}>🚗 รถยนต์</option>
                    <option value="จยย" ${row.type === 'จยย' ? 'selected' : ''}>🏍️ จักรยานยนต์</option>
                </select>
            </td>
            <td class="brand-cell"><input class="inline-input" value="${escapeHTML(row.brand || '')}" oninput="updateListDraftField('brand', this.value)" placeholder="ยี่ห้อ"></td>
            <td class="status-cell"><span class="status-badge pending">🔴 ยังไม่รับ</span></td>
            <td><input type="date" class="inline-input mono ${invalidDate ? 'field-invalid' : ''}" value="${escapeHTML(row.importedAt || '')}" oninput="updateListDraftField('importedAt', this.value)"></td>
            <td class="mono">-</td>
            <td>
                <div class="action-btns">
                    <button class="btn btn-sm btn-success" onclick="event.stopPropagation(); saveListDraftRecord()">💾 บันทึก</button>
                    <button class="btn btn-sm" onclick="event.stopPropagation(); cancelListDraftRecord()">ยกเลิก</button>
                </div>
            </td>
            <td><input class="inline-input" value="${escapeHTML(row.name || '')}" oninput="updateListDraftField('name', this.value)" placeholder="ชื่อ"></td>
            <td><input class="inline-input mono" value="${escapeHTML(row.phone || '')}" oninput="updateListDraftField('phone', this.value)" placeholder="เบอร์โทร"></td>
        </tr>`;
}

function createRowHTML(r, index) {
    try {
        const selected = State.selectedIds.has(r.id);
        const status = ['pending', 'received', 'completed', 'returned'].includes(r.status) ? r.status : 'pending';
        const statusClass = status;
        const statusTextMap = {
            pending: '🔴 ยังไม่รับ',
            received: '🟡 รับแล้ว',
            completed: '🔵 เสร็จแล้ว',
            returned: '🟢 คืนเล่มแล้ว'
        };
        const statusText = statusTextMap[status] || statusTextMap.pending;
        const receivedTime = formatDateTime(r.returnedAt || r.completedAt || r.receivedAt);
        const rowClass = [selected ? 'selected' : '', status !== 'pending' ? `row-${status}` : ''].filter(Boolean).join(' ');
        const safeType = r.type === 'จยย' ? 'จยย' : 'รย';
        // IDs can originate from imported/restored data. Keep them out of raw inline JS
        // string literals by URL-encoding before embedding in HTML attributes.
        const encodedId = encodeURIComponent(String(r.id || '')).replace(/'/g, '%27');
        const decodedIdExpr = `decodeURIComponent('${encodedId}')`;

        return `
        <tr class="${rowClass}" data-id="${encodedId}" onclick="handleRowClick(event, ${decodedIdExpr})">
            <td><input type="checkbox" ${selected ? 'checked' : ''} onclick="event.stopPropagation(); toggleSelect(${decodedIdExpr})"></td>
            <td>${index}</td>
            <td><input class="inline-input mono list-plate-input" value="${escapeHTML(r.plate || '')}" onchange="updateField(${decodedIdExpr}, 'plate', this.value)" placeholder="ทะเบียน"></td>
            <td><input class="inline-input list-province-input" value="${escapeHTML(r.province || '')}" onchange="updateField(${decodedIdExpr}, 'province', this.value)" placeholder="จังหวัด"></td>
            <td>
                <select class="inline-select type-select" onchange="updateField(${decodedIdExpr}, 'type', this.value)">
                    <option value="รย" ${safeType === 'รย' ? 'selected' : ''}>🚗 รถยนต์</option>
                    <option value="จยย" ${safeType === 'จยย' ? 'selected' : ''}>🏍️ จักรยานยนต์</option>
                </select>
            </td>
            <td class="brand-cell"><input class="inline-input" value="${escapeHTML(r.brand || '')}" onchange="updateField(${decodedIdExpr}, 'brand', this.value)" placeholder="ยี่ห้อ"></td>
            <td class="status-cell"><span class="status-badge ${statusClass}">${statusText}</span></td>
            <td class="mono">${formatDate(r.importedAt)}</td>
            <td class="mono">${receivedTime}</td>
            <td>
                <div class="action-btns">
                    ${status === 'pending' ?
                        `<button class="btn btn-sm btn-success" onclick="event.stopPropagation(); markReceived(${decodedIdExpr})">✅ รับเล่ม</button>` :
                        status === 'received' ?
                            `<button class="btn btn-sm btn-primary" onclick="event.stopPropagation(); markCompleted(${decodedIdExpr})">เสร็จ</button><button class="btn btn-sm" onclick="event.stopPropagation(); undoReceived(${decodedIdExpr})">ยกเลิก</button>` :
                            status === 'completed' ?
                                `<button class="btn btn-sm btn-success" onclick="event.stopPropagation(); markReturned(${decodedIdExpr})">คืนเล่ม</button><button class="btn btn-sm" onclick="event.stopPropagation(); reopenCompletedAsReceived(${decodedIdExpr})">ย้อนกลับ</button>` :
                                `<span class="status-done-note">ปิดงานแล้ว</span><button class="btn btn-sm" onclick="event.stopPropagation(); markCompletedFromReturned(${decodedIdExpr})">เปิดกลับ</button>`
                    }
                </div>
            </td>
            <td><input class="inline-input" value="${escapeHTML(r.name || '')}" onchange="updateField(${decodedIdExpr}, 'name', this.value)" placeholder="ชื่อ"></td>
            <td><input class="inline-input mono" value="${escapeHTML(r.phone || '')}" onchange="updateField(${decodedIdExpr}, 'phone', this.value)" placeholder="เบอร์โทร"></td>
        </tr>`;
    } catch (e) {
        return `<tr><td colspan="12" class="error-state">Error rendering row</td></tr>`;
    }
}

function startListDraftRecord() {
    if (State.listDraftRecord) {
        renderVisibleRows();
        return;
    }

    State.listDraftRecord = {
        plate: '',
        province: State.settings.province || '',
        type: 'รย',
        brand: '',
        importedAt: new Date().toISOString().split('T')[0],
        name: '',
        phone: '',
        _touched: false
    };
    renderVisibleRows();
}

function updateListDraftField(field, value) {
    if (!State.listDraftRecord) return;
    State.listDraftRecord[field] = value;
}

function cancelListDraftRecord() {
    State.listDraftRecord = null;
    renderVisibleRows();
}

async function saveListDraftRecord() {
    if (!State.listDraftRecord) return;

    State.listDraftRecord._touched = true;
    const payload = {
        id: generateUUID(),
        plate: String(State.listDraftRecord.plate || '').trim(),
        province: String(State.listDraftRecord.province || '').trim(),
        type: String(State.listDraftRecord.type || 'รย').trim() || 'รย',
        brand: String(State.listDraftRecord.brand || '').trim(),
        importedAt: String(State.listDraftRecord.importedAt || '').trim(),
        name: String(State.listDraftRecord.name || '').trim(),
        phone: String(State.listDraftRecord.phone || '').trim(),
        status: 'pending',
        receivedAt: null
    };

    if (!payload.plate || !payload.importedAt) {
        renderVisibleRows();
        showNotification('❌ ต้องกรอกทะเบียนและวันนัดก่อนบันทึก', 'error');
        return;
    }

    showLoading('กำลังบันทึกรายการใหม่...');
    try {
        const result = await api.saveRecords({ records: [payload], batchSize: 1 });
        const imported = result?.imported || 0;
        const skipped = result?.skipped || 0;

        if (imported === 0 && skipped > 0) {
            showNotification('⚠️ รายการนี้มีอยู่แล้วในวันนัดเดียวกัน ระบบจึงข้ามการบันทึก', 'warning');
            return;
        }

        State.listDraftRecord = null;
        State.currentPage = 1;
        State.records = [];
        State.totalCount = 0;
        loadData();
        updateStats();
        showNotification('✅ เพิ่มรายการใหม่แล้ว', 'success');
    } catch (error) {
        showNotification('❌ เพิ่มรายการไม่สำเร็จ: ' + error.message, 'error');
        renderVisibleRows();
    } finally {
        hideLoading();
    }
}

// ==========================================
// ACTIONS WITH OPTIMISTIC UI + UNDO
// ==========================================
async function updateField(id, field, value) {
    return window.RendererRecordActionsModule.updateField({
        State,
        getNextSequenceId,
        pushRollback,
        renderVisibleRows,
        trackRequest,
        api,
        isStaleRequest,
        executeRollback,
        showNotification,
        loadData,
        completeRequest
    }, id, field, value);
}

async function markReceived(id) {
    return window.RendererRecordActionsModule.markReceived({
        State,
        getNextSequenceId,
        pushRollback,
        renderVisibleRows,
        trackRequest,
        api,
        isStaleRequest,
        showUndoToast,
        updateStats,
        executeRollback,
        showNotification,
        loadData,
        completeRequest
    }, id);
}

async function undoReceived(id) {
    return window.RendererRecordActionsModule.undoReceived({
        State,
        getNextSequenceId,
        pushRollback,
        renderVisibleRows,
        trackRequest,
        api,
        isStaleRequest,
        updateStats,
        executeRollback,
        showNotification,
        loadData,
        completeRequest
    }, id);
}

async function markCompleted(id) {
    return window.RendererRecordActionsModule.markCompleted({
        State,
        getNextSequenceId,
        pushRollback,
        renderVisibleRows,
        trackRequest,
        api,
        isStaleRequest,
        showUndoToast,
        updateStats,
        executeRollback,
        showNotification,
        loadData,
        completeRequest
    }, id);
}

async function markReturned(id) {
    return window.RendererRecordActionsModule.markReturned({
        State,
        getNextSequenceId,
        pushRollback,
        renderVisibleRows,
        trackRequest,
        api,
        isStaleRequest,
        showUndoToast,
        updateStats,
        executeRollback,
        showNotification,
        loadData,
        completeRequest
    }, id);
}

async function reopenCompletedAsReceived(id) {
    return markReceived(id);
}

async function markCompletedFromReturned(id) {
    return markCompleted(id);
}

async function deleteRecord(id) {
    return window.RendererRecordActionsModule.deleteRecord({
        State,
        api,
        getNextSequenceId,
        pushRollback,
        renderTable,
        updatePagination,
        trackRequest,
        isStaleRequest,
        clearSelection,
        reloadCurrentListPage,
        recoverSearchInteraction,
        showUndoToast,
        updateStats,
        executeRollback,
        showNotification,
        loadData,
        completeRequest
    }, id);
}

async function deleteSelected() {
    return window.RendererRecordActionsModule.deleteSelected({
        State,
        getNextSequenceId,
        showNotification,
        api,
        renderTable,
        updatePagination,
        trackRequest,
        isStaleRequest,
        clearSelection,
        reloadCurrentListPage,
        recoverSearchInteraction,
        updateStats,
        completeRequest
    });
}

async function reloadCurrentListPage() {
    return window.RendererRecordActionsModule.reloadCurrentListPage({ State, loadData });
}

// ==========================================
// SELECTION & BULK ACTIONS
// ==========================================
function handleRowClick(event, id) {
    return window.RendererRecordActionsModule.handleRowClick({ toggleSelect }, event, id);
}

function updateBulkBar() {
    return window.RendererRecordActionsModule.updateBulkBar({ State });
}

function toggleSelect(id) {
    return window.RendererRecordActionsModule.toggleSelect({ State, updateBulkBar, renderVisibleRows }, id);
}

function toggleSelectAll() {
    return window.RendererRecordActionsModule.toggleSelectAll({ State, updateBulkBar, renderVisibleRows });
}

function clearSelection() {
    return window.RendererRecordActionsModule.clearSelection({ State, updateBulkBar, renderVisibleRows });
}

async function bulkSave() {
    return window.RendererRecordActionsModule.bulkSave({
        State,
        showLoading,
        api,
        showNotification,
        clearSelection,
        renderVisibleRows,
        hideLoading
    });
}

// ==========================================
// EXCEL IMPORT (IPC-based + Drag & Drop)
// ==========================================
function setupDragAndDrop() {
    const fileZone = document.getElementById('file-zone');
    if (!fileZone) return;

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        fileZone.addEventListener(eventName, (e) => { e.preventDefault(); e.stopPropagation(); }, false);
    });

    ['dragenter', 'dragover'].forEach(eventName => {
        fileZone.addEventListener(eventName, () => fileZone.classList.add('drag-over'), false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        fileZone.addEventListener(eventName, () => fileZone.classList.remove('drag-over'), false);
    });

    fileZone.addEventListener('drop', (e) => {
        const files = e.dataTransfer.files;
        if (files.length > 0) handleFileDrop(files[0]);
    }, false);
}

async function handleFileDrop(file) {
    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith('.xlsx') && !fileName.endsWith('.xls')) {
        showNotification('❌ กรุณาเลือกไฟล์ Excel (.xlsx, .xls)', 'error');
        return;
    }
    
    showLoading('กำลังอ่านไฟล์...');
    
    try {
        // Read as ArrayBuffer and convert to plain array for IPC
        const arrayBuffer = await file.arrayBuffer();
        const byteArray = Array.from(new Uint8Array(arrayBuffer));
        State.fileBuffer = { type: 'Buffer', data: byteArray };
        State.selectedImportDate = '';
        State.importDateOverride = false;
        
        const result = await api.parseExcel(State.fileBuffer);
        
        if (!result.success) throw new Error(result.error);
        
        State.sheetNames = result.sheetNames || [result.sheetName];
        State.sheetCount = result.sheetCount || 1;
        State.currentSheetIndex = 0;
        State.selectedImportSheets = State.sheetCount > 1 ? [] : [0];
        State.importRawData = result.data || [];
        rebuildImportData();
        
        showPreview();
        updateStep(2);
        showNotification(
            State.sheetCount > 1
                ? `📚 พบ ${State.sheetCount} Sheet กรุณาเลือก Sheet ที่ต้องการนำเข้าก่อน`
                : `📄 พบข้อมูล ${State.importData.length} รายการ`,
            'success'
        );
    } catch (error) {
        console.error('❌ handleFileDrop error:', error);
        console.error('❌ Error stack:', error.stack);
        showNotification('❌ อ่านไฟล์ไม่สำเร็จ: ' + error.message, 'error');
    } finally { 
        hideLoading(); 
    }
}

async function selectFile() {
    return window.RendererImportWorkflowModule.selectFile({
        State,
        api,
        rebuildImportData,
        showPreview,
        updateStep,
        showLoading,
        hideLoading,
        showNotification
    });
}

function parseExcelData(data, options = {}) {
    const records = [];
    const importProfile = options.importProfile || State.importProfile || 'standard';

    if (!data) {
        console.error('❌ Data is null or undefined');
        showNotification('❌ ข้อมูล Excel ว่างเปล่า', 'error');
        return records;
    }

    if (!Array.isArray(data)) {
        console.error('❌ Data is not an array, type:', typeof data);
        showNotification('❌ รูปแบบข้อมูลไม่ถูกต้อง', 'error');
        return records;
    }

    if (data.length === 0) {
        console.error('❌ Data array is empty');
        showNotification('❌ ไม่มีข้อมูลในไฟล์ Excel', 'error');
        return records;
    }

    const normalize = (value) => {
        if (value === null || value === undefined) return '';
        return String(value).trim();
    };

    const normalizeType = (value) => {
        const text = normalize(value).toLowerCase();
        if (!text) return '';
        if (text.includes('จักรยานยนต์') || text.includes('จยย') || text.includes('มอเตอร์ไซค์') || text.includes('motor')) return 'จยย';
        if (text.includes('รถยนต์') || text.includes('รย') || text.includes('car')) return 'รย';
        return '';
    };

    const parseDateString = (value) => {
        if (value instanceof Date && !Number.isNaN(value.getTime())) {
            return value.toISOString().split('T')[0];
        }

        const text = normalize(value);
        if (!text) return '';

        const dateMatches = [];
        const thaiDatePattern = /(\d{1,4})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/g;
        let thaiMatch;
        while ((thaiMatch = thaiDatePattern.exec(text)) !== null) {
            let year;
            let month;
            let day;

            if (thaiMatch[1].length === 4) {
                year = parseInt(thaiMatch[1], 10);
                month = thaiMatch[2].padStart(2, '0');
                day = thaiMatch[3].padStart(2, '0');
            } else {
                day = thaiMatch[1].padStart(2, '0');
                month = thaiMatch[2].padStart(2, '0');
                year = parseInt(thaiMatch[3], 10);
            }

            if (year < 100) {
                year += 2500;
            }
            if (year > 2400) year -= 543;

            const numericDay = Number(day);
            const numericMonth = Number(month);
            if (numericDay < 1 || numericDay > 31 || numericMonth < 1 || numericMonth > 12) {
                continue;
            }

            dateMatches.push({
                iso: `${year}-${month}-${day}`,
                index: thaiMatch.index,
                raw: thaiMatch[0]
            });
        }

        if (dateMatches.length > 0) {
            return dateMatches[0].iso;
        }

        return '';
    };

    const extractDateMatches = (value) => {
        if (value instanceof Date && !Number.isNaN(value.getTime())) {
            return [{ iso: value.toISOString().split('T')[0], index: 0, raw: value.toISOString() }];
        }

        const text = normalize(value);
        if (!text) return [];

        const matches = [];
        const thaiDatePattern = /(\d{1,4})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/g;
        let thaiMatch;
        while ((thaiMatch = thaiDatePattern.exec(text)) !== null) {
            let year;
            let month;
            let day;

            if (thaiMatch[1].length === 4) {
                year = parseInt(thaiMatch[1], 10);
                month = thaiMatch[2].padStart(2, '0');
                day = thaiMatch[3].padStart(2, '0');
            } else {
                day = thaiMatch[1].padStart(2, '0');
                month = thaiMatch[2].padStart(2, '0');
                year = parseInt(thaiMatch[3], 10);
            }

            if (year < 100) {
                year += 2500;
            }
            if (year > 2400) year -= 543;

            const numericDay = Number(day);
            const numericMonth = Number(month);
            if (numericDay < 1 || numericDay > 31 || numericMonth < 1 || numericMonth > 12) {
                continue;
            }

            matches.push({
                iso: `${year}-${month}-${day}`,
                index: thaiMatch.index,
                raw: thaiMatch[0]
            });
        }

        if (matches.length > 0) return matches;

        return [];
    };

    const findDateAfterKeywordInText = (value, keywords) => {
        const text = normalize(value).toLowerCase();
        if (!text) return '';

        const matches = extractDateMatches(value);
        if (matches.length === 0) return '';

        for (const keyword of keywords) {
            const keywordIndex = text.indexOf(keyword);
            if (keywordIndex === -1) continue;

            const matchAfterKeyword = matches.find(match => match.index > keywordIndex);
            if (matchAfterKeyword) return matchAfterKeyword.iso;
        }

        return '';
    };

    const extractRowDate = (row, preferredIndex) => {
        if (!Array.isArray(row) || row.length === 0) return '';

        const candidateIndexes = [];
        if (typeof preferredIndex === 'number' && preferredIndex >= 0) {
            candidateIndexes.push(preferredIndex);
        }

        for (let index = 0; index < row.length; index += 1) {
            if (!candidateIndexes.includes(index)) {
                candidateIndexes.push(index);
            }
        }

        for (const index of candidateIndexes) {
            const parsed = parseDateString(row[index]);
            if (parsed) return parsed;
        }

        return '';
    };

    const isLikelyPlate = (value) => {
        const text = normalize(value);
        if (!text) return false;

        const lowerText = text.toLowerCase();
        if (lowerText.includes('รวม') || lowerText.includes('บริการ') || lowerText.includes('ภาษี')) {
            return false;
        }

        return /\d/.test(text);
    };

    const collectDateCandidates = () => {
        const found = new Set();
        for (let i = 0; i < Math.min(30, data.length); i++) {
            const row = data[i];
            if (!Array.isArray(row)) continue;
            row.forEach(cell => {
                const parsed = parseDateString(cell);
                if (parsed) found.add(parsed);
            });
        }
        return Array.from(found).sort();
    };

    const findDateNearLabel = (keywords, options = {}) => {
        const {
            maxRows = 6,
            preferRight = true,
            fallbackToAnyNeighbor = true
        } = options;

        for (let rowIndex = 0; rowIndex < Math.min(maxRows, data.length); rowIndex += 1) {
            const row = Array.isArray(data[rowIndex]) ? data[rowIndex] : [];
            if (row.length === 0) continue;

            for (let colIndex = 0; colIndex < row.length; colIndex += 1) {
                const cellText = normalize(row[colIndex]).toLowerCase();
                if (!cellText) continue;
                if (!keywords.some(keyword => cellText.includes(keyword))) continue;

                const inCellDate = findDateAfterKeywordInText(row[colIndex], keywords);
                if (inCellDate) return inCellDate;

                const primaryOffsets = preferRight ? [1, 2, 3, -1, -2] : [-1, -2, 1, 2, 3];
                for (const offset of primaryOffsets) {
                    const parsed = parseDateString(row[colIndex + offset]);
                    if (parsed) return parsed;
                }

                if (fallbackToAnyNeighbor) {
                    for (let offset = -4; offset <= 4; offset += 1) {
                        if (offset === 0 || primaryOffsets.includes(offset)) continue;
                        const parsed = parseDateString(row[colIndex + offset]);
                        if (parsed) return parsed;
                    }
                }
            }
        }

        return '';
    };

    const findAppointmentDate = () => {
        const secondRow = Array.isArray(data[1]) ? data[1] : [];
        const secondRowWindow = secondRow.slice(2, 6).filter(Boolean);
        const secondRowText = secondRowWindow.join(' ');
        const secondRowAppointmentDate = findDateAfterKeywordInText(secondRowText, ['วันนัด', 'นัด']);
        if (secondRowAppointmentDate) return secondRowAppointmentDate;

        const explicitAppointmentDate = findDateNearLabel(['วันนัด', 'นัด'], { maxRows: 6, preferRight: true, fallbackToAnyNeighbor: false });
        if (explicitAppointmentDate) return explicitAppointmentDate;

        const importDate = findDateNearLabel(['วันนำเข้า', 'วันที่'], { maxRows: 6, preferRight: true, fallbackToAnyNeighbor: false });
        if (importDate) return importDate;

        for (let index = 0; index < secondRow.length; index += 1) {
            const matches = extractDateMatches(secondRow[index]);
            if (matches.length > 0) return matches[matches.length - 1].iso;
        }

        for (let i = 0; i < Math.min(6, data.length); i++) {
            const row = data[i];
            if (!Array.isArray(row)) continue;
            const rowText = row.map(cell => normalize(cell).toLowerCase()).join(' ');
            if (rowText.includes('นัด') || rowText.includes('วันนำเข้า') || rowText.includes('วันที่')) {
                for (let j = 0; j < row.length; j++) {
                    const value = normalize(row[j]);
                    if (!value) continue;
                    const parsed = parseDateString(value);
                    if (!parsed) continue;

                    const prev = normalize(row[j - 1]).toLowerCase();
                    const next = normalize(row[j + 1]).toLowerCase();
                    if (prev.includes('นัด') || next.includes('นัด') || rowText.includes('นัด')) {
                        return parsed;
                    }
                    if (prev.includes('วันนำเข้า') || next.includes('วันนำเข้า') || rowText.includes('วันนำเข้า')) {
                        return parsed;
                    }
                }
            }
        }
        return '';
    };

    const dateCandidates = collectDateCandidates();
    const appointmentDate = (options.useSelectedDate ? options.selectedDate : '') || findAppointmentDate() || dateCandidates[0] || '';
    const defaultDate = appointmentDate || new Date().toISOString().split('T')[0];
    State.selectedImportDate = defaultDate;

    const parseStandardRows = () => {
        let headerRowIndex = -1;
        const headerIndexMap = {};

        for (let i = 0; i < Math.min(20, data.length); i++) {
            const row = data[i];
            if (!Array.isArray(row)) continue;

            const normalizedRow = row.map(cell => normalize(cell).toLowerCase());
            if (normalizedRow.some(cell => cell.includes('เลขทะเบียน') || cell.includes('ทะเบียน')) &&
                normalizedRow.some(cell => cell.includes('ยี่ห้อ') || cell.includes('จังหวัด') || cell.includes('รย') || cell.includes('จยย'))) {
                headerRowIndex = i;
                normalizedRow.forEach((cell, colIndex) => {
                    if (cell.includes('เลขทะเบียน') || cell === 'ทะเบียน') headerIndexMap.plate = colIndex;
                    else if (cell.includes('รย')) headerIndexMap.car = colIndex;
                    else if (cell.includes('จยย')) headerIndexMap.motor = colIndex;
                    else if (cell.includes('ยี่ห้อ')) headerIndexMap.brand = colIndex;
                    else if (cell.includes('จังหวัด')) headerIndexMap.province = colIndex;
                    else if (cell.includes('นัด') || cell.includes('วันนำเข้า') || cell.includes('วันที่')) headerIndexMap.date = colIndex;
                });
                break;
            }
        }

        if (headerRowIndex === -1) {
            headerRowIndex = 0;
        }

        for (let i = headerRowIndex + 1; i < data.length; i++) {
            try {
                const row = data[i];
                if (!Array.isArray(row)) continue;
                if (row.every(cell => normalize(cell) === '')) continue;

                const plate = normalize(row[headerIndexMap.plate] || row[1] || row[0]);
                if (!isLikelyPlate(plate)) continue;

                let type = '';
                const carCell = normalize(row[headerIndexMap.car]);
                const motorCell = normalize(row[headerIndexMap.motor]);
                if (carCell) type = 'รย';
                if (motorCell) type = 'จยย';
                if (!type) {
                    if (carCell === '1' || carCell.toLowerCase() === 'x' || carCell.toLowerCase() === 'v') type = 'รย';
                    if (motorCell === '1' || motorCell.toLowerCase() === 'x' || motorCell.toLowerCase() === 'v') type = 'จยย';
                    if (!type && [carCell, motorCell].every(v => v === '')) {
                        const rowText = row.map(cell => normalize(cell).toLowerCase());
                        if (rowText.some(cell => cell.includes('รย'))) type = 'รย';
                        if (rowText.some(cell => cell.includes('จยย'))) type = 'จยย';
                    }
                }

                const brand = normalize(row[headerIndexMap.brand] || '');
                const province = normalize(row[headerIndexMap.province] || '');

                const importedAt = extractRowDate(row, headerIndexMap.date) || defaultDate;

                records.push({
                    id: generateUUID(),
                    plate,
                    province,
                    type: type || 'รย',
                    brand,
                    name: '',
                    phone: '',
                    status: 'pending',
                    importedAt,
                    receivedAt: null
                });
            } catch (err) {
                console.error(`❌ Error parsing row ${i}:`, err);
            }
        }
    };

    const parseGenericRows = () => {
        let headerRowIndex = -1;
        const headerIndexMap = {};

        for (let i = 0; i < Math.min(25, data.length); i++) {
            const row = data[i];
            if (!Array.isArray(row)) continue;

            const normalizedRow = row.map(cell => normalize(cell).toLowerCase());
            const hasPlate = normalizedRow.some(cell => cell.includes('ทะเบียน') || cell.includes('plate'));
            const hasTypeOrBrand = normalizedRow.some(cell => cell.includes('ประเภท') || cell.includes('ชนิด') || cell.includes('type') || cell.includes('ยี่ห้อ') || cell.includes('brand'));
            if (!hasPlate || !hasTypeOrBrand) continue;

            headerRowIndex = i;
            normalizedRow.forEach((cell, colIndex) => {
                if (cell.includes('เลขทะเบียน') || cell.includes('ทะเบียน') || cell.includes('plate')) headerIndexMap.plate = colIndex;
                else if (cell.includes('จังหวัด') || cell.includes('province')) headerIndexMap.province = colIndex;
                else if (cell.includes('ประเภท') || cell.includes('ชนิด') || cell.includes('type')) headerIndexMap.type = colIndex;
                else if (cell.includes('ยี่ห้อ') || cell.includes('brand')) headerIndexMap.brand = colIndex;
                else if (cell.includes('นัด') || cell.includes('วันนำเข้า') || cell.includes('วันที่') || cell.includes('date')) headerIndexMap.date = colIndex;
                else if (cell.includes('ชื่อ')) headerIndexMap.name = colIndex;
                else if (cell.includes('โทร') || cell.includes('phone')) headerIndexMap.phone = colIndex;
            });
            break;
        }

        if (headerRowIndex === -1) {
            headerRowIndex = 0;
        }

        for (let i = headerRowIndex + 1; i < data.length; i++) {
            try {
                const row = data[i];
                if (!Array.isArray(row)) continue;
                if (row.every(cell => normalize(cell) === '')) continue;

                const plate = normalize(row[headerIndexMap.plate] || row[0]);
                if (!isLikelyPlate(plate)) continue;

                const importedAt = extractRowDate(row, headerIndexMap.date) || defaultDate;

                records.push({
                    id: generateUUID(),
                    plate,
                    province: normalize(row[headerIndexMap.province] || ''),
                    type: normalizeType(row[headerIndexMap.type] || '') || 'รย',
                    brand: normalize(row[headerIndexMap.brand] || ''),
                    name: normalize(row[headerIndexMap.name] || ''),
                    phone: normalize(row[headerIndexMap.phone] || ''),
                    status: 'pending',
                    importedAt,
                    receivedAt: null
                });
            } catch (err) {
                console.error(`❌ Error parsing generic row ${i}:`, err);
            }
        }
    };

    if (importProfile === 'generic') {
        parseGenericRows();
        if (records.length === 0) {
            parseStandardRows();
        }
    } else {
        parseStandardRows();
    }

    return records;
}

function rebuildImportData(options = {}) {
    return window.RendererImportWorkflowModule.rebuildImportData({ State, parseExcelData }, options);
}

function applyImportProfile(profileId) {
    return window.RendererImportWorkflowModule.applyImportProfile({
        State,
        IMPORT_PROFILES,
        rebuildImportData,
        showPreview
    }, profileId);
}

function showPreview() {
    return window.RendererImportWorkflowModule.showPreview({
        State,
        IMPORT_PREVIEW_ROW_LIMIT,
        IMPORT_PROFILES,
        escapeHTML,
        formatDate,
        renderImportSheetSelection
    });
}

async function confirmImport() {
    return window.RendererImportWorkflowModule.confirmImport({
        State,
        IMPORT_CONFIRM_PLATE_LIMIT,
        api,
        parseExcelData,
        showLoading,
        hideLoading,
        showLoadingProgress,
        showNotification,
        updateStep,
        resetImportProgress,
        hideImportProgress,
        cancelImport,
        persistPostImportReset
    });
}

function updateImportProgress(payload) {
    return window.RendererImportWorkflowModule.updateImportProgress({}, payload);
}

async function finalizePostImportSync() {
    return window.RendererUiFeedbackModule.finalizePostImportSync({
        State,
        showLoadingProgress,
        switchView,
        loadData,
        updateStats,
        hideLoading,
        api,
        restoreInteractiveStateAfterImport
    });
}

function restoreInteractiveStateAfterImport() {
    return window.RendererImportWorkflowModule.restoreInteractiveStateAfterImport({ State, toggleSearchHistory, recoverSearchInteraction });
}

function persistPostImportReset(payload) {
    return window.RendererImportWorkflowModule.persistPostImportReset({}, payload);
}

function consumePostImportReset() {
    return window.RendererImportWorkflowModule.consumePostImportReset();
}

function resetImportProgress() {
    return window.RendererImportWorkflowModule.resetImportProgress();
}

function hideImportProgress() {
    return window.RendererImportWorkflowModule.hideImportProgress();
}

function cancelImport() {
    return window.RendererImportWorkflowModule.cancelImport({
        State,
        hideImportProgress,
        updateStep
    });
}

function updateStep(step) {
    return window.RendererImportWorkflowModule.updateStep({}, step);
}

async function switchSheet() {
    return window.RendererImportWorkflowModule.switchSheet({
        State,
        api,
        showLoading,
        hideLoading,
        rebuildImportData,
        showPreview,
        showNotification
    });
}

function applyImportDateSelection(value) {
    return window.RendererImportWorkflowModule.applyImportDateSelection({
        State,
        rebuildImportData,
        showPreview
    }, value);
}

function setSelectedImportSheets(indexes) {
    return window.RendererImportWorkflowModule.setSelectedImportSheets({
        State,
        renderImportSheetSelection,
        showPreview
    }, indexes);
}

function renderImportSheetSelection(sheetBulkTools, sheetSelectionList, sheetSelectionNote) {
    return window.RendererImportWorkflowModule.renderImportSheetSelection({
        State,
        escapeHTML
    }, sheetBulkTools, sheetSelectionList, sheetSelectionNote);
}

function toggleImportSheetSelection(index, checked) {
    return window.RendererImportWorkflowModule.toggleImportSheetSelection({
        State,
        setSelectedImportSheets
    }, index, checked);
}

function selectAllImportSheets() {
    return window.RendererImportWorkflowModule.selectAllImportSheets({
        State,
        setSelectedImportSheets
    });
}

function clearImportSheetSelection() {
    return window.RendererImportWorkflowModule.clearImportSheetSelection({ setSelectedImportSheets });
}

function getTodayIsoDate() {
    return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Bangkok' }).format(new Date());
}

function formatDateForDisplay(isoDate) {
    return window.RendererTableDomainModule.formatDateForDisplay({}, isoDate);
}

function parseDisplayDateToIso(value) {
    return window.RendererTableDomainModule.parseDisplayDateToIso({}, value);
}

function formatCurrency(value) {
    return Number(value || 0).toLocaleString('th-TH', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function parseMoney(value) {
    if (value === null || value === undefined) return 0;
    const normalized = String(value).replace(/,/g, '').trim();
    const amount = Number(normalized);
    return Number.isFinite(amount) ? amount : 0;
}

function createDefaultTableMeta() {
    return window.RendererTableDomainModule.createDefaultTableMeta({ State, getTodayIsoDate });
}

function createEmptyManualEntryRow() {
    return window.RendererTableDomainModule.createEmptyManualEntryRow({ State, generateUUID });
}

function ensureTableDraftState() {
    if (!State.tableMeta.documentDate || !State.tableMeta.appointmentDate) {
        State.tableMeta = { ...createDefaultTableMeta(), ...State.tableMeta };
    }
    if (!Array.isArray(State.manualEntries) || State.manualEntries.length === 0) {
        resetManualEntryTable();
        return;
    }
    syncTableMetaInputs();
    syncBulkEditInput();
    syncPrintLayoutControls();
    renderManualEntryTable();
}

function normalizeTableDraft(rawDraft) {
    return window.RendererTableDomainModule.normalizeTableDraft({
        createDefaultTableMeta,
        createEmptyManualEntryRow,
        generateUUID
    }, rawDraft);
}

function applyTableDraft(rawDraft) {
    const draft = normalizeTableDraft(rawDraft);
    State.tableMeta = {
        stationName: draft.stationName,
        documentDate: draft.documentDate,
        appointmentDate: draft.appointmentDate,
        addCount: draft.addCount,
        deleteCount: draft.deleteCount,
        printLayout: draft.printLayout
    };
    State.manualEntries = draft.rows;
    syncTableMetaInputs();
    syncPrintLayoutControls();
    renderManualEntryTable();
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
        if (el.tagName === 'BUTTON') {
            el.textContent = value || 'DD/MM/YYYY';
        } else {
            el.value = value || '';
        }
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

function syncBulkEditInput() {
    const field = document.getElementById('bulk-edit-field')?.value || 'brand';
    const input = document.getElementById('bulk-edit-value');
    if (!input) return;

    input.removeAttribute('list');
    if (field === 'province') {
        input.setAttribute('list', 'province-options');
        input.placeholder = 'พิมพ์ค้นหาจังหวัด';
    } else if (field === 'type') {
        input.placeholder = 'ใส่ รย หรือ จยย';
    } else if (field === 'taxAmount') {
        input.placeholder = 'ใส่ตัวเลข เช่น 3500';
    } else if (field === 'plate') {
        input.placeholder = 'ทะเบียนที่ต้องการแทน';
    } else if (field === 'note') {
        input.placeholder = 'หมายเหตุที่ต้องการใส่';
    } else {
        input.placeholder = 'ค่าที่ต้องการใส่ให้บรรทัดที่เลือก';
    }
}

function getPrintFitApi() {
    return window.RendererPrintPreviewModule.getPrintFitApi();
}

function calculatePrintFitMetrics(rowCount, requestedLayout) {
    return window.RendererPrintPreviewModule.calculatePrintFitMetrics({}, rowCount, requestedLayout);
}

function syncPrintLayoutControls() {
    return window.RendererPrintPreviewModule.syncPrintLayoutControls({ State, buildPrintableTableRows });
}

function openTableDatePicker(field) {
    const inputId = field === 'appointmentDate' ? 'table-appointment-date-picker' : 'table-document-date-picker';
    const input = document.getElementById(inputId);
    if (!input) return;
    if (typeof input.showPicker === 'function') input.showPicker();
    else input.click();
}

function applyTableDateFromPicker(field, value) {
    updateTableMetaField(field, value);
}

function getTableDraftPayload() {
    return window.RendererTableDomainModule.getTableDraftPayload({ State, generateUUID });
}

function getSelectedTableRowIndexes() {
    return Array.from(State.tableSelectedRows)
        .map((value) => Number(value))
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

function calculateTableSummary() {
    return window.RendererTableDomainModule.calculateTableSummary({ State, parseMoney, TABLE_SERVICE_RATE });
}

function getTableValidationResult() {
    return window.RendererTableDomainModule.validateManualEntries({ State, parseMoney });
}

function getVisibleManualEntryIndexes() {
    return window.RendererTableDomainModule.getManualEntrySearchIndexes({ State }, State.tableSearchQuery);
}

function getManualEntryRowStatus(validationResult, index) {
    return window.RendererTableDomainModule.getManualEntryRowStatus({ validationResult }, index);
}

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
        statusEl.textContent = result.errorCount > 0
            ? `พบข้อมูลต้องแก้ ${result.errorCount} จุด • กดดูแถวสีแดง/ส้ม`
            : (result.warningCount > 0
                ? `มีคำเตือน ${result.warningCount} จุด แต่ยังบันทึกได้ถ้าไม่ติด error`
                : `ข้อมูลที่กรอก ${result.filledCount} แถวพร้อมใช้งาน`);
    }

    if (searchMetaEl) {
        searchMetaEl.textContent = State.tableSearchQuery
            ? `พบ ${visibleCount.toLocaleString()} จาก ${totalCount.toLocaleString()} แถว`
            : 'ค้นทะเบียน จังหวัด ยี่ห้อ หมายเหตุ หรือเลขแถว';
    }

    if (floatingEl) {
        floatingEl.innerHTML = `
            <span>รย. <strong>${summary.carCount}</strong> คัน</span>
            <span>จยย. <strong>${summary.motorcycleCount}</strong> คัน</span>
            <span>ภาษี <strong>${formatCurrency(summary.taxTotal)}</strong></span>
            <span>บริการ <strong>${formatCurrency(summary.serviceTotal)}</strong></span>
            <span class="grand">รวม <strong>${formatCurrency(summary.grandTotal)}</strong></span>
            ${selectedCount ? `<span>เลือก <strong>${selectedCount}</strong> แถว</span>` : ''}
        `;
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
    if (breakdownEl) {
        breakdownEl.textContent = `รย. ${summary.carCount} คัน | จยย. ${summary.motorcycleCount} คัน | รวม ${summary.serviceCount} คัน × ${TABLE_SERVICE_RATE}`;
    }
    renderTableAssistPanel();
}

function updateManualEntryCount() {
    const badge = document.getElementById('manual-entry-count');
    if (!badge) return;
    const selectedCount = getSelectedTableRowIndexes().length;
    badge.textContent = `${State.manualEntries.length.toLocaleString()} บรรทัด${selectedCount > 0 ? ` • เลือก ${selectedCount}` : ''}`;
}

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
            const rowIssues = [
                ...(validationResult.byIndex[index]?.errors || []),
                ...(validationResult.byIndex[index]?.warnings || [])
            ];
            const issueText = rowIssues
                .map((issue) => issue.message)
                .join(' | ');

            return `
                <tr class="entry-row status-${status}" data-row-index="${index}">
                    <td class="selection-cell"><input type="checkbox" ${State.tableSelectedRows.has(index) ? 'checked' : ''} onchange="toggleTableRowSelection(${index}, this.checked)"></td>
                    <td class="sequence-cell">
                        <span>${index + 1}</span>
                        ${issueText ? `<small title="${escapeHTML(issueText)}">!</small>` : ''}
                    </td>
                    <td><input type="text" value="${escapeHTML(row.plate)}" oninput="updateManualEntryField(${index}, 'plate', this.value)" placeholder="เช่น 1กข 1234"></td>
                    <td class="radio-cell"><input type="radio" name="table-type-${index}" ${rowType === 'รย' ? 'checked' : ''} onchange="updateManualEntryField(${index}, 'type', 'รย')"></td>
                    <td class="radio-cell"><input type="radio" name="table-type-${index}" ${rowType === 'จยย' ? 'checked' : ''} onchange="updateManualEntryField(${index}, 'type', 'จยย')"></td>
                    <td><input class="numeric-input" type="number" min="0" step="0.01" value="${escapeHTML(row.taxAmount)}" oninput="updateManualEntryField(${index}, 'taxAmount', this.value)" placeholder="0.00"></td>
                    <td><input type="text" value="${escapeHTML(row.note)}" oninput="updateManualEntryField(${index}, 'note', this.value)" placeholder="หมายเหตุ"></td>
                    <td><input type="text" value="${escapeHTML(row.brand)}" oninput="updateManualEntryField(${index}, 'brand', this.value)" placeholder="ยี่ห้อ"></td>
                    <td><input type="text" list="province-options" value="${escapeHTML(row.province)}" oninput="updateManualEntryField(${index}, 'province', this.value)" placeholder="พิมพ์ค้นหาจังหวัด"></td>
                    <td class="delete-cell"><button class="btn btn-sm" type="button" onclick="removeManualEntryRow(${index})">ลบ</button></td>
                </tr>
            `;
        }).join('');
    }

    syncTableSelectionState();
    updateManualEntryCount();
    renderTableSummary();
    renderTableAssistPanel(validationResult);
}

function addManualEntryRows(count = 1) {
    const nextCount = Math.max(1, Number(count) || 1);
    for (let index = 0; index < nextCount; index++) {
        State.manualEntries.push(createEmptyManualEntryRow());
    }
    renderManualEntryTable();
}

function addTableRows() {
    addManualEntryRows(State.tableMeta.addCount || 1);
}

function setTableAddCount(value) {
    State.tableMeta.addCount = Math.max(1, Number(value) || 1);
    syncTableMetaInputs();
}

function setTableDeleteCount(value) {
    State.tableMeta.deleteCount = Math.max(1, Number(value) || 1);
    syncTableMetaInputs();
}

function deleteTableRowsByCount() {
    const deleteCount = Math.max(1, Number(State.tableMeta.deleteCount) || 1);
    if (State.manualEntries.length === 0) return;

    const nextLength = Math.max(1, State.manualEntries.length - deleteCount);
    State.manualEntries = State.manualEntries.slice(0, nextLength);
    State.tableSelectedRows = new Set(
        Array.from(State.tableSelectedRows).filter((index) => Number(index) < nextLength)
    );
    renderManualEntryTable();
}

function resetManualEntryTable(render = true) {
    State.tableMeta = createDefaultTableMeta();
    State.manualEntries = Array.from({ length: 10 }, () => createEmptyManualEntryRow());
    State.tableSelectedRows = new Set();
    State.tableSearchQuery = '';
    State.tableLastValidation = null;
    const searchInput = document.getElementById('table-search-input');
    if (searchInput) searchInput.value = '';
    if (render) {
        syncTableMetaInputs();
        syncPrintLayoutControls();
        renderManualEntryTable();
    }
}

function updateTableMetaField(field, value) {
    if (!Object.prototype.hasOwnProperty.call(State.tableMeta, field)) return;
    if (field === 'addCount') {
        State.tableMeta[field] = Math.max(1, Number(value) || 1);
        syncTableMetaInputs();
        return;
    }

    if (field === 'deleteCount') {
        State.tableMeta[field] = Math.max(1, Number(value) || 1);
        syncTableMetaInputs();
        return;
    }

    if (field === 'printLayout') {
        State.tableMeta[field] = ['auto', 'half-left', 'full-page'].includes(String(value)) ? String(value) : 'auto';
        syncPrintLayoutControls();
        if (document.getElementById('print-preview-modal')?.classList.contains('show')) {
            renderPrintPreviewContent();
        }
        return;
    }

    if (field === 'documentDate' || field === 'appointmentDate') {
        const parsedDate = parseDisplayDateToIso(value);
        if (parsedDate === null) {
            syncTableMetaInputs();
            showNotification('❌ กรุณาใส่วันที่แบบ DD/MM/YYYY', 'error');
            return;
        }
        State.tableMeta[field] = parsedDate;
        syncTableMetaInputs();
        return;
    }

    State.tableMeta[field] = value;
}

function updatePrintLayout(value) {
    return window.RendererPrintPreviewModule.updatePrintLayout({ updateTableMetaField }, value);
}

function clearTableEntryRows(preserveCount = null) {
    const rowCount = Math.max(1, Number(preserveCount) || State.manualEntries.length || 10);
    State.manualEntries = Array.from({ length: rowCount }, () => createEmptyManualEntryRow());
    State.tableSelectedRows = new Set();
    renderManualEntryTable();
}

async function saveTableDraft() {
    if (State.isSavingTableDraft) {
        showNotification('⏳ กำลังบันทึกอยู่ กรุณารอสักครู่', 'warning');
        return;
    }

    const validation = validateManualEntryTable(true);
    if (!validation.ok) return;

    const payload = getTableDraftPayload();
    if (!payload.stationName) {
        showNotification('❌ กรุณาระบุชื่อ ตรอ.', 'error');
        return;
    }
    if (!payload.documentDate || !payload.appointmentDate) {
        showNotification('❌ กรุณาระบุวันที่และวันนัดให้ครบ', 'error');
        return;
    }

    const mainRecords = buildTableRecordsForMainList();

    State.isSavingTableDraft = true;
    try {
        let imported = 0;
        let skipped = 0;

        if (mainRecords.length > 0) {
            const saveResult = await api.saveRecords({ records: mainRecords, batchSize: 500 });
            imported = Number(saveResult?.imported || 0);
            skipped = Number(saveResult?.skipped || 0);
        }

        const clearedDraft = {
            ...payload,
            rows: Array.from({ length: payload.rows.length || 10 }, () => ({
                id: generateUUID(),
                plate: '',
                type: 'รย',
                taxAmount: '',
                note: '',
                brand: '',
                province: State.settings.province || ''
            }))
        };
        await api.saveSettings({ tableDraft: clearedDraft });
        State.settings = { ...State.settings, tableDraft: clearedDraft };
        State.records = [];
        State.totalCount = 0;
        clearTableEntryRows(payload.rows.length || 10);
        updateStats();
        if (State.currentView === 'list') loadData();

        showNotification(
            `✅ บันทึกเข้าระบบแล้ว${mainRecords.length > 0 ? ` • เพิ่ม ${imported.toLocaleString()} รายการ${skipped > 0 ? ` • ข้ามซ้ำ ${skipped.toLocaleString()}` : ''}` : ' • ยังไม่มีรายการใหม่เข้าหน้าหลัก'}`,
            'success'
        );
    } catch (error) {
        showNotification('❌ บันทึกเข้าระบบไม่สำเร็จ: ' + error.message, 'error');
    } finally {
        State.isSavingTableDraft = false;
    }
}

function buildPrintableTableRows() {
    return window.RendererTableDomainModule.buildPrintableTableRows({ State, parseMoney });
}

function buildTableRecordsForMainList() {
    return window.RendererTableDomainModule.buildTableRecordsForMainList({ State, generateUUID });
}

function renderPrintPreviewContent() {
    return window.RendererPrintPreviewModule.renderPrintPreviewContent({
        State,
        escapeHTML,
        formatDate,
        formatCurrency,
        buildPrintableTableRows,
        calculateTableSummary,
        TABLE_SERVICE_RATE,
        syncPrintLayoutControls
    });
}

function openPrintPreview() {
    return window.RendererPrintPreviewModule.openPrintPreview({
        buildPrintableTableRows,
        syncPrintLayoutControls,
        renderPrintPreviewContent,
        showNotification
    });
}

function closePrintPreview() {
    return window.RendererPrintPreviewModule.closePrintPreview();
}

function finishPrintInteraction(shouldClosePreview = true) {
    return window.RendererPrintPreviewModule.finishPrintInteraction({ closePrintPreview }, shouldClosePreview);
}

function confirmTablePrint() {
    return window.RendererPrintPreviewModule.confirmTablePrint();
}

async function exportPrintPreviewPdf() {
    return window.RendererPrintPreviewModule.exportPrintPreviewPdf({
        buildPrintableTableRows,
        renderPrintPreviewContent,
        State,
        api,
        showNotification,
        finishPrintInteraction
    });
}

async function saveManualEntries() {
    await saveTableDraft();
}

function updateManualEntryField(index, field, value) {
    if (!State.manualEntries[index]) return;
    State.manualEntries[index][field] = value;
    renderTableSummary();
    renderTableAssistPanel();
}

function toggleTableRowSelection(index, checked) {
    if (checked) State.tableSelectedRows.add(index);
    else State.tableSelectedRows.delete(index);
    syncTableSelectionState();
    updateManualEntryCount();
}

function toggleSelectAllTableRows(checked) {
    if (checked) {
        State.tableSelectedRows = new Set(State.manualEntries.map((_, index) => index));
    } else {
        State.tableSelectedRows = new Set();
    }
    renderManualEntryTable();
}

function applyBulkTableEdit() {
    const indexes = getSelectedTableRowIndexes();
    if (indexes.length === 0) {
        showNotification('❌ กรุณาเลือกบรรทัดที่ต้องการแก้ไขก่อน', 'error');
        return;
    }

    const field = document.getElementById('bulk-edit-field')?.value || 'brand';
    const value = document.getElementById('bulk-edit-value')?.value ?? '';
    const normalizedValue = String(value).trim();

    if (field === 'type' && !['รย', 'จยย'].includes(normalizedValue)) {
        showNotification('❌ ประเภทรถต้องเป็น รย หรือ จยย', 'error');
        return;
    }

    if (field === 'taxAmount' && normalizedValue && !Number.isFinite(Number(normalizedValue))) {
        showNotification('❌ ราคาภาษีต้องเป็นตัวเลข', 'error');
        return;
    }

    indexes.forEach((index) => {
        if (!State.manualEntries[index]) return;
        State.manualEntries[index][field] = normalizedValue;
    });

    renderManualEntryTable();
    showNotification(`✅ แก้ไข ${indexes.length.toLocaleString()} บรรทัดแล้ว`, 'success');
}

function removeManualEntryRow(index) {
    State.manualEntries.splice(index, 1);
    State.tableSelectedRows = new Set(
        getSelectedTableRowIndexes()
            .filter((selectedIndex) => selectedIndex !== index)
            .map((selectedIndex) => (selectedIndex > index ? selectedIndex - 1 : selectedIndex))
    );
    if (State.manualEntries.length === 0) {
        State.manualEntries.push(createEmptyManualEntryRow());
    }
    renderManualEntryTable();
}


function updateTableSearch(value) {
    State.tableSearchQuery = String(value || '').trim();
    if (State.tableSearchTimer) clearTimeout(State.tableSearchTimer);
    State.tableSearchTimer = setTimeout(() => {
        State.tableSearchTimer = null;
        renderManualEntryTable();
    }, 120);
}

function clearTableSearch() {
    State.tableSearchQuery = '';
    if (State.tableSearchTimer) {
        clearTimeout(State.tableSearchTimer);
        State.tableSearchTimer = null;
    }
    const input = document.getElementById('table-search-input');
    if (input) input.value = '';
    renderManualEntryTable();
}

function validateManualEntryTable(showResult = true) {
    const result = getTableValidationResult();
    State.tableLastValidation = result;
    renderManualEntryTable();

    const firstError = result.issues.find((issue) => issue.level === 'error');
    if (firstError) {
        const rowEl = document.querySelector(`[data-row-index="${firstError.index}"]`);
        if (rowEl) rowEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (showResult) showNotification(`❌ ${firstError.message}`, 'error');
        return { ok: false, result };
    }

    if (showResult) {
        if (result.warningCount > 0) {
            showNotification(`⚠️ ตรวจแล้ว: มีคำเตือน ${result.warningCount} จุด แต่ไม่มี error`, 'warning');
        } else {
            showNotification(`✅ ตรวจแล้ว: ข้อมูลที่กรอก ${result.filledCount} แถวพร้อมบันทึก`, 'success');
        }
    }
    return { ok: true, result };
}

function copyManualEntryFromAbove() {
    const indexes = getSelectedTableRowIndexes();
    if (indexes.length === 0) {
        showNotification('❌ กรุณาเลือกบรรทัดที่จะคัดลอกจากแถวบนก่อน', 'error');
        return;
    }

    let copied = 0;
    indexes.forEach((index) => {
        if (index <= 0 || !State.manualEntries[index] || !State.manualEntries[index - 1]) return;
        const prev = State.manualEntries[index - 1];
        State.manualEntries[index] = {
            ...State.manualEntries[index],
            type: prev.type === 'จยย' ? 'จยย' : 'รย',
            taxAmount: prev.taxAmount || '',
            note: prev.note || '',
            brand: prev.brand || '',
            province: prev.province || ''
        };
        copied += 1;
    });

    renderManualEntryTable();
    if (copied > 0) showNotification(`✅ คัดลอกค่าจากแถวบนแล้ว ${copied} แถว`, 'success');
    else showNotification('⚠️ แถวแรกไม่มีแถวบนให้คัดลอก', 'warning');
}

function focusNextManualEntryInput(currentInput) {
    const inputs = Array.from(document.querySelectorAll('#manual-entry-body input[type="text"], #manual-entry-body input[type="number"]'));
    const index = inputs.indexOf(currentInput);
    const next = inputs[index + 1];
    if (next) {
        next.focus();
        if (typeof next.select === 'function') next.select();
    }
}

function handleTableKeyboardShortcut(event) {
    if (State.currentView !== 'table') return;
    const target = event.target;
    const tagName = String(target?.tagName || '').toLowerCase();
    const isEditable = ['input', 'select', 'textarea'].includes(tagName);

    if (event.key === 'Enter' && isEditable && target.closest?.('#manual-entry-body')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        focusNextManualEntryInput(target);
        return;
    }

    if (!event.ctrlKey && !event.metaKey) return;
    const key = String(event.key || '').toLowerCase();
    if (key === 's') {
        event.preventDefault();
        event.stopImmediatePropagation();
        saveTableDraft();
    } else if (key === 'p') {
        event.preventDefault();
        event.stopImmediatePropagation();
        openPrintPreview();
    } else if (key === 'enter') {
        event.preventDefault();
        event.stopImmediatePropagation();
        addManualEntryRows(1);
    } else if (key === 'd') {
        event.preventDefault();
        event.stopImmediatePropagation();
        copyManualEntryFromAbove();
    } else if (key === 'f') {
        event.preventDefault();
        event.stopImmediatePropagation();
        document.getElementById('table-search-input')?.focus();
    }
}

document.addEventListener('keydown', handleTableKeyboardShortcut);

// ==========================================
// SETTINGS
// ==========================================
async function loadSettings() {
    try {
        if (typeof window.api === 'undefined' || !window.api.loadSettings) {
            console.warn('⚠️ api.loadSettings not available');
            return;
        }
        
        const settings = await api.loadSettings();
        if (settings) {
            const normalizedSettings = {
                ...settings,
                updateManifestUrl: settings.updateManifestUrl?.trim() || DEFAULT_UPDATE_MANIFEST_URL
            };
            State.settings = { ...State.settings, ...normalizedSettings };
            const els = {
                'set-shop-name': State.settings.shopName,
                'set-province': State.settings.province,
                'set-brands': State.settings.brands,
                'set-retain-years': State.settings.retainYears,
                'set-update-manifest-url': State.settings.updateManifestUrl
            };
            for (const [id, val] of Object.entries(els)) {
                const el = document.getElementById(id);
                if (el) el.value = val || '';
            }
            const shopDisplay = document.getElementById('shop-display');
            if (shopDisplay) shopDisplay.textContent = State.settings.shopName || '';
            applyTableDraft(State.settings.tableDraft);
            loadAppVersionInfo();
            updateAppUpdateStatus(State.settings.updateManifestUrl ? 'พร้อมตรวจสอบอัปเดต' : 'ยังไม่ได้ตั้งค่า URL อัปเดต');
            await loadSystemHealth();
            renderSearchPresets();
            syncAdvancedSearchForm();
        }
    } catch (error) {
        console.warn('Load settings error:', error);
        // Don't fail completely, use defaults
    }
}

async function saveSettings() {
    try {
        const shopName = document.getElementById('set-shop-name')?.value || '';
        const province = document.getElementById('set-province')?.value || '';
        const brands = document.getElementById('set-brands')?.value || '';
        const retainYears = document.getElementById('set-retain-years')?.value || '5';
        const updateManifestUrl = document.getElementById('set-update-manifest-url')?.value?.trim() || DEFAULT_UPDATE_MANIFEST_URL;

        await api.saveSettings({ shopName, province, brands, retainYears, updateManifestUrl });
        State.settings = { ...State.settings, shopName, province, brands, retainYears, updateManifestUrl };

        const shopDisplay = document.getElementById('shop-display');
        if (shopDisplay) shopDisplay.textContent = shopName;
        updateAppUpdateStatus('บันทึก URL อัปเดตแล้ว', 'success');
        await loadSystemHealth();

        showNotification('✅ บันทึกการตั้งค่าแล้ว', 'success');
    } catch (error) {
        showNotification('❌ บันทึกล้มเหลว', 'error');
    }
}

function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (!Number.isFinite(value) || value <= 0) return '0 B';

    const units = ['B', 'KB', 'MB', 'GB'];
    let size = value;
    let index = 0;
    while (size >= 1024 && index < units.length - 1) {
        size /= 1024;
        index += 1;
    }
    return `${size.toFixed(size >= 100 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function updateDatabaseTransferStatus(message, tone = 'info') {
    const status = document.getElementById('database-transfer-status');
    if (!status) return;

    const toneColor = tone === 'success'
        ? 'rgba(16, 185, 129, 0.12)'
        : tone === 'error'
            ? 'rgba(239, 68, 68, 0.12)'
            : tone === 'progress'
                ? 'rgba(59, 130, 246, 0.12)'
                : 'rgba(59, 130, 246, 0.08)';
    status.style.background = toneColor;
    status.innerHTML = message;
}

function renderSystemHealth() {
    const panel = document.getElementById('system-health-panel');
    if (!panel) return;

    const health = State.systemHealth;
    if (!health) {
        panel.innerHTML = '<div class="settings-list-item">ยังไม่มีข้อมูลสุขภาพระบบ</div>';
        return;
    }

    const integrityOk = String(health.integrity || '').toLowerCase() === 'ok';
    const backup = health.backup || {};
    const latestBackup = backup.latest || null;
    const retainYears = String(State.settings.retainYears || health.settings?.retainYears || '5');

    panel.innerHTML = `
        <div class="system-health-grid">
            <div class="system-health-metric">
                <span class="system-health-label">ข้อมูลทั้งหมด</span>
                <strong>${Number(health.totalRecords || 0).toLocaleString()} รายการ</strong>
            </div>
            <div class="system-health-metric">
                <span class="system-health-label">ขนาดฐานข้อมูล</span>
                <strong>${formatBytes(health.dbSizeBytes)}</strong>
            </div>
            <div class="system-health-metric">
                <span class="system-health-label">สำรองล่าสุด</span>
                <strong>${latestBackup ? formatDateTime(latestBackup.modifiedAt) : 'ยังไม่พบ'}</strong>
            </div>
            <div class="system-health-metric">
                <span class="system-health-label">อายุข้อมูล</span>
                <strong>${retainYears === '0' ? 'ไม่ลบอัตโนมัติ' : `${retainYears} ปี`}</strong>
            </div>
        </div>
        <div class="settings-list" style="margin-top:16px;">
            <div class="settings-list-item" style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
                <span>สถานะฐานข้อมูล</span>
                <strong class="health-badge ${integrityOk ? 'ok' : 'warn'}">${integrityOk ? 'ปกติ' : String(health.integrity || 'ต้องตรวจสอบ')}</strong>
            </div>
            <div class="settings-list-item" style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
                <span>ไฟล์ฐานข้อมูล</span>
                <strong>${escapeHtml(health.dbPath || '-')}</strong>
            </div>
            <div class="settings-list-item" style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
                <span>โฟลเดอร์สำรอง</span>
                <strong>${escapeHtml(backup.backupDir || '-')}</strong>
            </div>
            <div class="settings-list-item" style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
                <span>จำนวนไฟล์สำรอง</span>
                <strong>${Number(backup.count || 0).toLocaleString()} ไฟล์</strong>
            </div>
            <div class="settings-list-item" style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
                <span>ข้อมูลเข้าวันนี้</span>
                <strong>${Number(health.todayRecords || 0).toLocaleString()} รายการ</strong>
            </div>
            <div class="settings-list-item" style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
                <span>สำรองอัตโนมัติ</span>
                <strong>${String(health.settings?.autoBackupEnabled ?? 'true') === 'false' ? 'ปิด' : 'เปิดทุกวัน'}</strong>
            </div>
        </div>
    `;
}

async function loadSystemHealth() {
    try {
        if (!api.getSystemHealth) return;
        const health = await api.getSystemHealth();
        State.systemHealth = health || null;
        renderSystemHealth();
    } catch (error) {
        console.warn('Load system health error:', error);
    }
}

async function createBackupNow() {
    showLoading('กำลังสำรองฐานข้อมูล...');
    try {
        const result = await api.createBackupNow();
        hideLoading();
        await loadSystemHealth();
        showNotification(`✅ สำรองข้อมูลแล้ว: ${result?.backupPath || ''}`, 'success');
    } catch (error) {
        hideLoading();
        showNotification(`❌ สำรองข้อมูลไม่สำเร็จ: ${error.message}`, 'error');
    }
}

async function importDatabaseFile() {
    if (!api.importDatabaseFile) {
        showNotification('❌ เวอร์ชันนี้ยังไม่รองรับการนำเข้าฐานข้อมูล', 'error');
        return;
    }

    updateDatabaseTransferStatus('<strong>กำลังเปิดหน้าต่างเลือกไฟล์...</strong> เลือกไฟล์ database.db จากเครื่องเดิม', 'progress');
    showLoading('กำลังเตรียมนำเข้าฐานข้อมูล...');

    try {
        const result = await api.importDatabaseFile();
        hideLoading();

        if (!result || result.cancelled) {
            updateDatabaseTransferStatus('<strong>ยกเลิกแล้ว:</strong> ยังไม่มีการเปลี่ยนฐานข้อมูล', 'info');
            showNotification('ยกเลิกการนำเข้าฐานข้อมูล', 'warning');
            return;
        }

        await loadSystemHealth();
        await loadSettings();
        if (typeof loadData === 'function') {
            await loadData({ resetPage: true, reason: 'database-import' });
        }

        const sourceName = escapeHtml(result.sourceInfo?.fileName || 'ไฟล์ฐานข้อมูล');
        const totalRecords = Number(result.totalRecords || 0).toLocaleString();
        const backupPath = escapeHtml(result.backupPath || '-');
        updateDatabaseTransferStatus(
            `<strong>นำเข้าสำเร็จ:</strong> ใช้ ${sourceName} แล้ว — พบข้อมูล ${totalRecords} รายการ<br><span>สำรองฐานข้อมูลเดิมไว้ที่ ${backupPath}</span>`,
            'success'
        );
        showNotification(`✅ นำเข้าฐานข้อมูลสำเร็จ (${totalRecords} รายการ)`, 'success');
    } catch (error) {
        hideLoading();
        const message = escapeHtml(error?.message || 'ไม่ทราบสาเหตุ');
        updateDatabaseTransferStatus(`<strong>นำเข้าไม่สำเร็จ:</strong> ${message}`, 'error');
        showNotification(`❌ นำเข้าฐานข้อมูลไม่สำเร็จ: ${error.message}`, 'error');
        await loadSystemHealth();
    }
}

async function runDatabaseMaintenance(action) {
    showLoading(action === 'vacuum' ? 'กำลังบีบอัดฐานข้อมูล...' : 'กำลังตรวจสอบฐานข้อมูล...');
    try {
        if (action === 'vacuum') {
            await api.vacuumDatabase();
            hideLoading();
            await loadSystemHealth();
            showNotification('✅ บีบอัดฐานข้อมูลเรียบร้อย', 'success');
            return;
        }

        const result = await api.checkIntegrity();
        hideLoading();
        await loadSystemHealth();
        const normalized = typeof result === 'string'
            ? result
            : Array.isArray(result)
                ? (typeof result[0] === 'object' ? String(result[0]?.integrity_check || Object.values(result[0] || {})[0] || 'unknown') : result[0])
                : (result && typeof result === 'object' ? String(result.integrity_check || Object.values(result)[0] || 'unknown') : String(result || 'unknown'));
        showNotification(normalized === 'ok' ? '✅ ฐานข้อมูลปกติ' : `⚠️ ผลตรวจสอบ: ${normalized}`, normalized === 'ok' ? 'success' : 'warning');
    } catch (error) {
        hideLoading();
        showNotification(`❌ ตรวจสอบไม่สำเร็จ: ${error.message}`, 'error');
    }
}

async function checkForUpdatesManual() {
    await runUpdateCheck({ manual: true, allowPrompt: true });
}

async function runUpdateCheck({ manual = false, allowPrompt = true } = {}) {
    const manifestUrl = document.getElementById('set-update-manifest-url')?.value?.trim() || '';
    if (!manifestUrl) {
        updateAppUpdateStatus('ยังไม่ได้ตั้งค่า URL อัปเดต', manual ? 'warning' : 'muted');
        if (manual) showNotification('⚠️ กรุณาใส่ URL อัปเดตก่อน', 'warning');
        return;
    }

    updateAppUpdateStatus('กำลังตรวจสอบอัปเดต...', 'progress');

    try {
        const result = await api.checkForUpdates({ manifestUrl });
        State.settings.updateManifestUrl = manifestUrl;

        if (!result?.available) {
            updateAppUpdateStatus(`ใช้งานเวอร์ชันล่าสุดแล้ว (${result?.currentVersion || '-'})`, 'success');
            if (manual) showNotification('✅ โปรแกรมเป็นเวอร์ชันล่าสุดแล้ว', 'success');
            return;
        }

        const notes = result.notes ? `\n\nรายละเอียด:\n${result.notes}` : '';
        if (!allowPrompt) {
            updateAppUpdateStatus(`พบเวอร์ชันใหม่ ${result.latestVersion}`, 'warning');
            return;
        }

        const { confirmed: updateConfirmed } = await api.confirmDialog({
            title: `พบเวอร์ชันใหม่ ${result.latestVersion}`,
            message: 'ต้องการดาวน์โหลดและติดตั้งตอนนี้หรือไม่?',
            detail: notes.trim(),
            buttons: ['ดาวน์โหลดและติดตั้ง', 'ภายหลัง'],
            defaultId: 0,
            cancelId: 1,
            confirmedIndex: 0
        });
        if (!updateConfirmed) {
            updateAppUpdateStatus(`พบเวอร์ชันใหม่ ${result.latestVersion}`, 'warning');
            return;
        }

        showLoading('กำลังดาวน์โหลดอัปเดต...');
        updateAppUpdateStatus(`กำลังดาวน์โหลดอัปเดต ${result.latestVersion}`, 'progress');
        await api.downloadAndInstallUpdate({ manifestUrl });
        updateAppUpdateStatus(`เปิดตัวติดตั้งเวอร์ชัน ${result.latestVersion} แล้ว`, 'success');
    } catch (error) {
        hideLoading();
        updateAppUpdateStatus(`ตรวจสอบอัปเดตไม่สำเร็จ: ${error.message}`, 'danger');
        if (manual) showNotification(`❌ อัปเดตไม่สำเร็จ: ${error.message}`, 'error');
        return;
    }
}

async function autoCheckForUpdatesOnStartup() {
    if (State.hasAutoCheckedUpdates) return;
    State.hasAutoCheckedUpdates = true;
    await runUpdateCheck({ manual: false, allowPrompt: true });
}

// ==========================================
// STATS & PAGINATION
// ==========================================
async function updateStats() {
    return window.RendererDashboardControllerModule.updateStats({
        api,
        renderDashboard
    });
}

async function loadDashboard() {
    return window.RendererDashboardControllerModule.loadDashboard({
        api,
        renderDashboard
    });
}

function renderDashboard(stats) {
    return window.RendererDashboardControllerModule.renderDashboard({
        drawDashboardChart
    }, stats);
}

function drawDashboardChart(dailyItems, formatShortDate, maxDaily) {
    return window.RendererDashboardControllerModule.drawDashboardChart({}, dailyItems, formatShortDate, maxDaily);
}

function updatePagination() {
    try {
        const maxPage = Math.ceil(State.totalCount / State.pageSize) || 1;
        const pageInfo = document.getElementById('page-info');
        
        // คำนวณช่วงเรคคอร์ดที่แสดง
        const startRecord = (State.currentPage - 1) * State.pageSize + 1;
        const endRecord = Math.min(State.currentPage * State.pageSize, State.totalCount);
        
        if (pageInfo) {
            if (State.totalCount === 0) {
                pageInfo.textContent = 'ไม่พบข้อมูล';
            } else {
                pageInfo.textContent = `แสดง ${startRecord}-${endRecord} จาก ${State.totalCount.toLocaleString()} รายการ (หน้า ${State.currentPage}/${maxPage})`;
            }
        }

        // Sync page-size-select value
        const sizeSelect = document.getElementById('page-size-select');
        if (sizeSelect && sizeSelect.value !== String(State.pageSize)) {
            sizeSelect.value = String(State.pageSize);
        }

        const setBtn = (id, disabled) => { const btn = document.getElementById(id); if (btn) btn.disabled = disabled; };
        setBtn('btn-first', State.currentPage === 1);
        setBtn('btn-prev', State.currentPage === 1);
        setBtn('btn-next', State.currentPage >= maxPage);
        setBtn('btn-last', State.currentPage >= maxPage);
    } catch (e) { /* Silent */ }
}

function prevPage() { if (State.currentPage > 1) { State.currentPage--; loadData(); } }
function nextPage() { const max = Math.ceil(State.totalCount / State.pageSize); if (State.currentPage < max) { State.currentPage++; loadData(); } }
function goToPage(p) { State.currentPage = p; loadData(); }
function goToLastPage() { State.currentPage = Math.ceil(State.totalCount / State.pageSize) || 1; loadData(); }

function changePageSize(newSize) {
    State.pageSize = parseInt(newSize);
    State.currentPage = 1; // Reset to first page
    loadData();
}

// ==========================================
// EXPORT CSV
// ==========================================
async function exportCsv() {
    showLoading('กำลัง Export CSV...');
    try {
        const result = await api.exportCsv(getSearchParams());
        if (result) showNotification(`✅ Export สำเร็จ ${result.count.toLocaleString()} รายการ`, 'success');
    } catch (error) {
        showNotification('❌ Export ไม่สำเร็จ', 'error');
    } finally { hideLoading(); }
}

// ==========================================
// UNDO TOAST
// ==========================================
function showUndoToast(message) {
    return window.RendererUiFeedbackModule.showUndoToast({ undoHandlerName: 'undoLastAction' }, message);
}

async function undoLastAction() {
    const el = document.getElementById('undo-toast');
    if (el) el.classList.remove('show');
    if (!State.lastAction) return;

    try {
        const { type, id, oldStatus, oldReceivedAt, field, oldValue, previous } = State.lastAction;
        if (['markReceived', 'undoReceived', 'markCompleted', 'markReturned'].includes(type)) {
            if (previous?.status === 'pending') await api.undoReceived([id]);
            else if (previous?.status === 'received') await api.markReceived([id]);
            else if (previous?.status === 'completed') await api.markCompleted([id]);
            else if (previous?.status === 'returned') await api.markReturned([id]);
            else await api.undoReceived([id]);
            const record = State.records.find(r => r.id === id);
            if (record) {
                if (previous) Object.assign(record, previous);
                else { record.status = oldStatus; record.receivedAt = oldReceivedAt; }
                renderVisibleRows();
            }
            showNotification('↩️ ยกเลิกแล้ว', 'success');
            updateStats();
        } else if (type === 'updateField') {
            await api.updateField({ id, field, value: oldValue });
            const record = State.records.find(r => r.id === id);
            if (record) { record[field] = oldValue; renderVisibleRows(); }
            showNotification('↩️ ยกเลิกแล้ว', 'success');
        }
    } catch (e) { showNotification('ไม่สามารถยกเลิกได้', 'error'); }
    State.lastAction = null;
}

// ==========================================
// NOTIFICATIONS (User-friendly)
// ==========================================
function showNotification(message, type = 'info', duration = 3000) {
    return window.RendererUiFeedbackModule.showNotification({}, message, type, duration);
}

// ==========================================
// LOADING OVERLAY
// ==========================================
function showLoading(text = 'กำลังประมวลผล...') {
    return window.RendererUiFeedbackModule.showLoading({ setLoadingProgress }, text);
}

function hideLoading() {
    return window.RendererUiFeedbackModule.hideLoading({ setLoadingProgress });
}

function showLoadingProgress(text, percent) {
    return window.RendererUiFeedbackModule.showLoadingProgress({ setLoadingProgress }, text, percent);
}

function setLoadingProgress(percent) {
    return window.RendererUiFeedbackModule.setLoadingProgress({}, percent);
}

// ==========================================
// KEYBOARD SHORTCUTS
// ==========================================
function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        try {
            if ((e.ctrlKey || e.metaKey) && e.key === 'a' && State.currentView === 'list') {
                e.preventDefault();
                const cb = document.getElementById('select-all');
                if (cb) { cb.checked = true; toggleSelectAll(); }
            }
            if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key.toLowerCase() === 'k')) {
                e.preventDefault();
                focusSearchInput(true);
            }
            if (e.key === 'Escape') {
                if (State.isLoading) hideLoading();
                clearSelection();
                toggleSearchHistory(false);
            }
        } catch (e) { /* Silent */ }
    });
}

window.addEventListener('focus', () => {
    if (State.pendingInteractionRecovery) {
        restoreInteractiveStateAfterImport();
    }
});

window.addEventListener('afterprint', () => {
    finishPrintInteraction();
});

// ==========================================
// PROGRESS LISTENER
// ==========================================
function setupImportProgressListener() {
    if (api.onImportProgress) {
        api.onImportProgress((payload) => updateImportProgress(payload));
    }
}

// ==========================================
// UTILITIES
// ==========================================
function escapeHTML(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function escapeRegExp(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightSearchText(text, query) {
    const safeText = escapeHTML(text || '');
    const token = String(query || '').trim();
    if (!token) return safeText;

    const escapedQuery = escapeRegExp(token);
    return safeText.replace(new RegExp(escapedQuery, 'ig'), (match) => `<mark class="search-highlight">${match}</mark>`);
}

// ==========================================
// EXPORT GLOBALS
// ==========================================
Object.assign(globalThis, {
    switchView, setFilter, selectFile, confirmImport, cancelImport, switchSheet,
    saveSettings, exportCsv, markReceived, undoReceived, markCompleted, markReturned, reopenCompletedAsReceived, markCompletedFromReturned, deleteRecord, deleteSelected,
    updateField, toggleSelect, toggleSelectAll, clearSelection, bulkSave,
    handleRowClick, prevPage, nextPage, goToPage, goToLastPage,
    undoLastAction, toggleTheme, showDebug, hideDebug, clearDebug,
    clearSearch, applySearchHistory, toggleAdvancedSearch, applyAdvancedSearch,
    resetAdvancedSearch, saveCurrentSearchPreset, applySearchPreset,
    removeCurrentSearchPreset, openTextPrompt, closeTextPrompt, submitTextPrompt, handleTextPromptKeydown, applyInsightBrand, applySmartSearch,
    clearAllSearchFilters, updateTableDensity, resetTableDensity, applyImportDateSelection,
    applyImportProfile,
    toggleImportSheetSelection, selectAllImportSheets, clearImportSheetSelection,
    addManualEntryRows, addTableRows, setTableAddCount, setTableDeleteCount, deleteTableRowsByCount, resetManualEntryTable,
    updateManualEntryField, updateTableMetaField, removeManualEntryRow,
    toggleTableRowSelection, toggleSelectAllTableRows, applyBulkTableEdit, syncBulkEditInput,
    saveManualEntries, saveTableDraft, openPrintPreview, closePrintPreview, confirmTablePrint, exportPrintPreviewPdf, updatePrintLayout,
    openTableDatePicker, applyTableDateFromPicker,
    startListDraftRecord, updateListDraftField, cancelListDraftRecord, saveListDraftRecord,
    applyQuickAppointmentDate, clearQuickAppointmentDate,
    checkForUpdatesManual,
    loadSystemHealth, createBackupNow, runDatabaseMaintenance,
    renderNetworkMonitor, promptSetNetworkRoomCode, disconnectNetworkClient, allowNetworkClient,
    validateManualEntryTable, copyManualEntryFromAbove, importDatabaseFile
});

// Initialize
document.addEventListener('DOMContentLoaded', init);
