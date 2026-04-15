/**
 * renderer.js — Ultra-responsive UI Logic
 * State management + Dark mode + Glassmorphism + Bulletproof error handling
 * Anti-freeze + memory optimization + user-friendly notifications
 */

const DEFAULT_UPDATE_MANIFEST_URL = 'https://raw.githubusercontent.com/OWNER/REPO/main/update.json';

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
    selectedImportDate: '',
    manualEntries: [],
    selectedImportSheets: [],
    sheetNames: [],
    currentSheetIndex: 0,
    fileBuffer: null,
    sheetCount: 0,
    darkMode: true,
    settings: { shopName: 'รับเล่มรถ ตรอ.', province: '', brands: '', retainYears: 5, updateManifestUrl: DEFAULT_UPDATE_MANIFEST_URL },
    virtualScroll: { rowHeight: 52, visibleCount: 0, startIndex: 0, endIndex: 0 },
    lastAction: null,
    isLoading: false,
    errorCount: 0,
    maxErrors: 5,
    searchHistory: [],
    searchUi: { historyVisible: false, lastMeta: 'พร้อมค้นหา', selectedPresetIndex: '' },
    searchInsights: { totalMatched: 0, byType: {}, byStatus: {}, topBrands: [] },
    dashboardChart: null,
    hasAutoCheckedUpdates: false,
    // Request tracking for race condition prevention
    sequenceId: 0,
    pendingRequests: new Map(),
    // Rollback state for optimistic UI
    rollbackStack: new Map(),
    navOrder: ['import', 'dashboard', 'list', 'settings']
};

const IMPORT_PREVIEW_ROW_LIMIT = 300;
const IMPORT_CONFIRM_PLATE_LIMIT = 80;

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
    return ++State.sequenceId;
}

function trackRequest(seqId, rollbackFn) {
    State.pendingRequests.set(seqId, { rollback: rollbackFn, timestamp: Date.now() });
    return seqId;
}

function completeRequest(seqId) {
    State.pendingRequests.delete(seqId);
}

function isStaleRequest(seqId) {
    return seqId < State.sequenceId;
}

// Rollback helper with toast notification
function pushRollback(id, previousState) {
    State.rollbackStack.set(id, { ...previousState, timestamp: Date.now() });
    
    // Clean old rollbacks (> 5 minutes)
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    for (const [key, value] of State.rollbackStack.entries()) {
        if (value.timestamp < fiveMinAgo) {
            State.rollbackStack.delete(key);
        }
    }
}

function executeRollback(id) {
    const rollback = State.rollbackStack.get(id);
    if (!rollback) return false;
    
    const record = State.records.find(r => r.id === id);
    if (!record) return false;
    
    // Restore previous state
    Object.keys(rollback).forEach(key => {
        if (key !== 'timestamp' && record.hasOwnProperty(key)) {
            record[key] = rollback[key];
        }
    });
    
    State.rollbackStack.delete(id);
    return true;
}

// Date formatter - consistent ISO 8601 display
function formatDate(dateStr) {
    if (!dateStr) return '-';
    try {
        // Parse ISO 8601 or Thai format consistently
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return dateStr;
        
        // Use Intl.DateTimeFormat with Thai locale and Buddhist Era
        return new Intl.DateTimeFormat('th-TH', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            timeZone: 'Asia/Bangkok'
        }).format(date);
    } catch (e) {
        return dateStr;
    }
}

// ==========================================
// INITIALIZATION WITH RECOVERY
// ==========================================
async function init() {
    try {
        console.log('🚀 Initializing Ultra-responsive UI...');
        
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
        resetManualEntryTable();
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
        switchView('import');
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
    if (typeof api.onRefreshRequired === 'function') {
        api.onRefreshRequired(() => {
            console.log('🔄 Refresh signal received from worker, reloading data...');
            // Invalidate cache and reload
            State.records = [];
            State.totalCount = 0;
            loadData();
            updateStats();
        });
    }
}

// ==========================================
// VIEW SWITCHING
// ==========================================
function switchView(viewId) {
    try {
        console.log('🔄 switchView called:', viewId);
        State.currentView = viewId;
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

        const viewEl = document.getElementById(`view-${viewId}`);
        const navEl = document.querySelector(`[data-view="${viewId}"]`);

        if (viewEl) viewEl.classList.add('active');
        if (navEl) navEl.classList.add('active');

        if (viewId === 'list') {
            console.log('📋 Loading data for list view...');
            // Setup virtual scroll เมื่อเปิด list view
            setTimeout(() => {
                setupVirtualScroll();
            }, 50);
            loadData();
            updateStats();
        } else if (viewId === 'entry') {
            renderManualEntryTable();
        } else if (viewId === 'dashboard') {
            loadDashboard();
            updateStats();
        }
    } catch (error) {
        console.error('❌ switchView error:', error);
        showNotification('ไม่สามารถสลับหน้าได้', 'error');
    }
}

function normalizeNavOrder(viewIds) {
    const defaults = ['import', 'dashboard', 'list', 'settings'];
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
    const searchInput = document.getElementById('search-input');
    if (!searchInput) return;

    renderSearchHistory();
    updateSearchMeta();

    searchInput.addEventListener('focus', () => {
        renderSearchHistory();
        toggleSearchHistory(true);
    });

    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            if (State.debounceTimer) clearTimeout(State.debounceTimer);
            State.currentPage = 1;
            loadData();
        }
        if (e.key === 'Escape') {
            toggleSearchHistory(false);
        }
    });

    searchInput.addEventListener('input', (e) => {
        State.searchQuery = e.target.value.trim();
        updateSearchClearButton();
        renderSearchHistory();
        updateSearchMeta(State.searchQuery ? 'กำลังพิมพ์คำค้น...' : 'พร้อมค้นหา');
        if (State.debounceTimer) clearTimeout(State.debounceTimer);
        State.debounceTimer = setTimeout(() => {
            State.currentPage = 1;
            loadData();
        }, 150);
    });
}

function updateQuickAppointmentDateInput() {
    const quickDateInput = document.getElementById('quick-appointment-date');
    if (!quickDateInput) return;

    const { importedFrom, importedTo } = State.advancedSearch;
    quickDateInput.value = importedFrom && importedFrom === importedTo ? importedFrom : '';
}

function setupSearchUiEvents() {
    document.addEventListener('click', (event) => {
        const searchBox = document.querySelector('.search-box');
        if (!searchBox?.contains(event.target)) {
            toggleSearchHistory(false);
        }
    });

    updateSearchClearButton();
    updateAdvancedSearchSummary();
    updateQuickAppointmentDateInput();
    renderSearchPresets();
    renderSearchInsights();
}

function loadSearchHistory() {
    try {
        const raw = localStorage.getItem('search-history');
        State.searchHistory = raw ? JSON.parse(raw) : [];
    } catch {
        State.searchHistory = [];
    }
}

function saveSearchHistory() {
    try {
        localStorage.setItem('search-history', JSON.stringify(State.searchHistory.slice(0, 8)));
    } catch {
        // Ignore storage failures
    }
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
    const trimmed = String(query || '').trim();
    if (!trimmed) return;

    State.searchHistory = [trimmed, ...State.searchHistory.filter(item => item !== trimmed)].slice(0, 8);
    saveSearchHistory();
    renderSearchHistory();
}

function renderSearchHistory() {
    const panel = document.getElementById('search-history');
    if (!panel) return;

    const current = State.searchQuery.trim().toLowerCase();
    const items = State.searchHistory.filter(item => !current || item.toLowerCase().includes(current)).slice(0, 6);

    if (items.length === 0) {
        panel.innerHTML = '<div class="search-history-empty">ยังไม่มีประวัติการค้นหา</div>';
        return;
    }

    panel.innerHTML = items.map(item => `
        <button class="search-history-item" type="button" onclick="applySearchHistory(decodeURIComponent('${encodeURIComponent(item)}'))">
            <span class="search-history-icon">↺</span>
            <span>${escapeHTML(item)}</span>
        </button>
    `).join('');
}

function toggleSearchHistory(visible) {
    const panel = document.getElementById('search-history');
    if (!panel) return;

    State.searchUi.historyVisible = visible;
    panel.classList.toggle('visible', visible);
}

function updateSearchClearButton() {
    const clearBtn = document.getElementById('search-clear');
    if (!clearBtn) return;
    clearBtn.classList.toggle('visible', Boolean(State.searchQuery));
}

function updateSearchMeta(text) {
    const metaEl = document.getElementById('search-meta');
    if (!metaEl) return;

    State.searchUi.lastMeta = text || State.searchUi.lastMeta || 'พร้อมค้นหา';
    metaEl.textContent = State.searchUi.lastMeta;
}

function getSearchParams() {
    return {
        query: State.searchQuery,
        type: ['รย', 'จยย'].includes(State.currentFilter) ? State.currentFilter : 'all',
        status: ['pending', 'received'].includes(State.currentFilter) ? State.currentFilter : 'all',
        page: State.currentPage,
        pageSize: State.pageSize,
        ...State.advancedSearch
    };
}

function getActiveAdvancedSearchCount() {
    return Object.values(State.advancedSearch).filter(Boolean).length;
}

function hasAnySearchFilters() {
    return Boolean(
        State.searchQuery ||
        State.currentFilter !== 'all' ||
        getActiveAdvancedSearchCount() > 0
    );
}

function updateAdvancedSearchSummary() {
    const summary = document.getElementById('advanced-summary');
    const count = getActiveAdvancedSearchCount();
    if (summary) {
        summary.textContent = count > 0 ? `ตัวกรองขั้นสูง ${count} รายการ` : 'ยังไม่ใช้ตัวกรองขั้นสูง';
    }
}

function renderSearchInsights() {
    const container = document.getElementById('search-insights');
    if (!container) return;

    const insights = State.searchInsights || { totalMatched: 0, byType: {}, byStatus: {}, topBrands: [] };
    const activeBrand = String(State.advancedSearch.brand || '').trim();
    const brandOptions = ['<option value="">แบรนด์เด่นทั้งหมด</option>'];
    (insights.topBrands || []).slice(0, 8).forEach(item => {
        const selected = activeBrand === item.brand ? 'selected' : '';
        brandOptions.push(`<option value="${escapeHTML(item.brand)}" ${selected}>${escapeHTML(item.brand)} (${item.count})</option>`);
    });
    const resetAction = hasAnySearchFilters()
        ? `<button type="button" class="insight-reset-btn" onclick="clearAllSearchFilters()">↺ แสดงทั้งหมด</button>`
        : '';

    container.innerHTML = `
        <div class="insight-card">
            <span class="insight-title">ผลค้นหา</span>
            <strong>${Number(insights.totalMatched || 0).toLocaleString()}</strong>
        </div>
        <div class="insight-card">
            <span class="insight-title">สถานะ</span>
            <span>ค้างรับ ${Number(insights.byStatus?.pending || 0).toLocaleString()} | รับแล้ว ${Number(insights.byStatus?.received || 0).toLocaleString()}</span>
        </div>
        <div class="insight-card">
            <span class="insight-title">ประเภทรถ</span>
            <span>รถยนต์ ${Number(insights.byType?.['รย'] || 0).toLocaleString()} | จยย ${Number(insights.byType?.['จยย'] || 0).toLocaleString()}</span>
        </div>
        <div class="insight-card insight-card-brand-select">
            <span class="insight-title">แบรนด์เด่น</span>
            <div class="insight-select-row">
                <select class="insight-brand-select" onchange="applyInsightBrand(this.value)">${brandOptions.join('')}</select>
                ${resetAction}
            </div>
        </div>
    `;
}

function syncAdvancedSearchForm() {
    const mapping = {
        'adv-plate': 'plate',
        'adv-owner-name': 'ownerName',
        'adv-phone': 'phone',
        'adv-brand': 'brand',
        'adv-province': 'province',
        'adv-imported-from': 'importedFrom',
        'adv-imported-to': 'importedTo',
        'adv-received-from': 'receivedFrom',
        'adv-received-to': 'receivedTo'
    };

    for (const [id, key] of Object.entries(mapping)) {
        const el = document.getElementById(id);
        if (el) el.value = State.advancedSearch[key] || '';
    }

    updateQuickAppointmentDateInput();
    updateAdvancedSearchSummary();
}

function toggleAdvancedSearch(force) {
    const panel = document.getElementById('advanced-search-panel');
    if (!panel) return;
    const shouldOpen = typeof force === 'boolean' ? force : !panel?.classList.contains('visible');
    panel?.classList.toggle('visible', shouldOpen);
    if (shouldOpen) syncAdvancedSearchForm();
}

function applyAdvancedSearch() {
    const getVal = (id) => document.getElementById(id)?.value?.trim() || '';
    State.advancedSearch = {
        plate: getVal('adv-plate'),
        ownerName: getVal('adv-owner-name'),
        phone: getVal('adv-phone'),
        brand: getVal('adv-brand'),
        province: getVal('adv-province'),
        importedFrom: getVal('adv-imported-from'),
        importedTo: getVal('adv-imported-to'),
        receivedFrom: getVal('adv-received-from'),
        receivedTo: getVal('adv-received-to')
    };

    updateQuickAppointmentDateInput();
    updateAdvancedSearchSummary();
    State.currentPage = 1;
    toggleAdvancedSearch(false);
    loadData();
}

function resetAdvancedSearch() {
    State.advancedSearch = {
        plate: '', ownerName: '', phone: '', brand: '', province: '',
        importedFrom: '', importedTo: '', receivedFrom: '', receivedTo: ''
    };
    syncAdvancedSearchForm();
    State.currentPage = 1;
    loadData();
}

function clearAllSearchFilters() {
    const searchInput = document.getElementById('search-input');
    State.searchQuery = '';
    State.currentFilter = 'all';
    State.searchUi.selectedPresetIndex = '';
    State.advancedSearch = {
        plate: '', ownerName: '', phone: '', brand: '', province: '',
        importedFrom: '', importedTo: '', receivedFrom: '', receivedTo: ''
    };

    if (State.debounceTimer) clearTimeout(State.debounceTimer);
    if (searchInput) searchInput.value = '';

    document.querySelectorAll('.filter-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.filter === 'all');
    });

    updateSearchClearButton();
    renderSearchHistory();
    renderSearchPresets();
    syncAdvancedSearchForm();
    updateSearchMeta('แสดงข้อมูลทั้งหมดแล้ว');
    State.currentPage = 1;
    loadData();
}

function applyQuickAppointmentDate(value) {
    const selectedDate = String(value || '').trim();

    State.advancedSearch.importedFrom = selectedDate;
    State.advancedSearch.importedTo = selectedDate;
    updateQuickAppointmentDateInput();
    updateAdvancedSearchSummary();
    updateSearchMeta(selectedDate ? `กรองวันนัด ${selectedDate}` : 'ล้างตัวกรองวันนัดแล้ว');
    State.currentPage = 1;
    loadData();
}

function clearQuickAppointmentDate() {
    applyQuickAppointmentDate('');
}

function renderSearchPresets() {
    const select = document.getElementById('search-preset-select');
    if (!select) return;

    const presets = Array.isArray(State.settings.savedSearches) ? State.settings.savedSearches : [];
    const options = ['<option value="">Preset ค้นหา</option>'];
    presets.forEach((preset, index) => {
        options.push(`<option value="${index}">${escapeHTML(preset.name || `Preset ${index + 1}`)}</option>`);
    });
    select.innerHTML = options.join('');
    select.value = State.searchUi.selectedPresetIndex;
}

async function saveCurrentSearchPreset() {
    if (State.selectedIds.size === 0) {
        showNotification('⚠️ เลือกรถก่อนจึงจะบันทึก preset ได้', 'warning');
        return;
    }

    const name = prompt('ชื่อ preset ค้นหา', State.searchQuery || 'ค้นหาด่วน');
    if (!name || !name.trim()) return;

    const preset = {
        name: name.trim(),
        query: State.searchQuery,
        currentFilter: State.currentFilter,
        advancedSearch: { brand: State.advancedSearch.brand || '' }
    };

    const current = Array.isArray(State.settings.savedSearches) ? State.settings.savedSearches : [];
    const updated = [preset, ...current.filter(item => item.name !== preset.name)].slice(0, 10);
    await api.saveSettings({ savedSearches: updated });
    State.settings.savedSearches = updated;
    State.searchUi.selectedPresetIndex = '0';
    renderSearchPresets();
    showNotification('✅ บันทึก preset ค้นหาแล้ว', 'success');
}

function applySearchPreset(index) {
    if (State.selectedIds.size === 0) {
        showNotification('⚠️ เลือกรถก่อนจึงจะใช้ preset ได้', 'warning');
        return;
    }
    if (index === '') return;
    const presets = Array.isArray(State.settings.savedSearches) ? State.settings.savedSearches : [];
    const preset = presets[Number(index)];
    if (!preset) return;

    State.searchQuery = preset.query || '';
    State.currentFilter = preset.currentFilter || 'all';
    State.advancedSearch = {
        plate: '', ownerName: '', phone: '', brand: '', province: '',
        importedFrom: '', importedTo: '', receivedFrom: '', receivedTo: '',
        brand: preset.advancedSearch?.brand || ''
    };

    const input = document.getElementById('search-input');
    if (input) input.value = State.searchQuery;
    State.searchUi.selectedPresetIndex = String(index);

    document.querySelectorAll('.filter-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.filter === State.currentFilter);
    });

    updateSearchClearButton();
    syncAdvancedSearchForm();
    State.currentPage = 1;
    loadData();
    showNotification(`🔎 ใช้ preset: ${preset.name}`, 'success');
}

async function removeCurrentSearchPreset() {
    if (State.selectedIds.size === 0) {
        showNotification('⚠️ เลือกรถก่อนจึงจะลบ preset ได้', 'warning');
        return;
    }
    if (State.searchUi.selectedPresetIndex === '') {
        showNotification('⚠️ เลือก preset ที่ต้องการลบก่อน', 'warning');
        return;
    }

    const presets = Array.isArray(State.settings.savedSearches) ? State.settings.savedSearches : [];
    const index = Number(State.searchUi.selectedPresetIndex);
    const preset = presets[index];
    if (!preset) return;
    if (!confirm(`ลบ preset "${preset.name}" ?`)) return;

    const updated = presets.filter((_, presetIndex) => presetIndex !== index);
    await api.saveSettings({ savedSearches: updated });
    State.settings.savedSearches = updated;
    State.searchUi.selectedPresetIndex = '';
    renderSearchPresets();
    showNotification('🗑️ ลบ preset แล้ว', 'success');
}

function applyInsightBrand(brand) {
    const nextBrand = String(brand || '').trim();
    State.advancedSearch.brand = nextBrand;
    syncAdvancedSearchForm();
    State.currentPage = 1;
    loadData();
}

function applySmartSearch(mode) {
    const today = new Date().toISOString().split('T')[0];
    if (mode === 'pendingToday') {
        State.currentFilter = 'pending';
        State.advancedSearch.importedFrom = today;
        State.advancedSearch.importedTo = today;
    } else if (mode === 'receivedToday') {
        State.currentFilter = 'received';
        State.advancedSearch.receivedFrom = today;
        State.advancedSearch.receivedTo = today;
    } else if (mode === 'motorOnly') {
        State.currentFilter = 'จยย';
        State.advancedSearch.receivedFrom = '';
        State.advancedSearch.receivedTo = '';
    }

    document.querySelectorAll('.filter-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.filter === State.currentFilter);
    });

    syncAdvancedSearchForm();
    State.currentPage = 1;
    loadData();
}

function applySearchHistory(query) {
    const searchInput = document.getElementById('search-input');
    State.searchQuery = String(query || '').trim();
    if (searchInput) {
        searchInput.value = State.searchQuery;
        searchInput.focus();
        searchInput.select();
    }
    updateSearchClearButton();
    updateSearchMeta(`ค้นหาล่าสุด: ${State.searchQuery}`);
    toggleSearchHistory(false);
    State.currentPage = 1;
    loadData();
}

function clearSearch() {
    const searchInput = document.getElementById('search-input');
    State.searchQuery = '';
    if (State.debounceTimer) clearTimeout(State.debounceTimer);
    if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
    }
    updateSearchClearButton();
    renderSearchHistory();
    updateSearchMeta('ล้างคำค้นแล้ว');
    State.currentPage = 1;
    loadData();
}

function focusSearchInput(selectText = false) {
    const searchInput = document.getElementById('search-input');
    if (!searchInput) return;
    searchInput.focus();
    if (selectText) searchInput.select();
    renderSearchHistory();
    toggleSearchHistory(true);
}

// ==========================================
// FILTERS
// ==========================================
function setFilter(filter) {
    try {
        State.currentFilter = filter;
        State.currentPage = 1;
        document.querySelectorAll('.filter-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.filter === filter);
        });
        loadData();
    } catch (error) {
        showNotification('ไม่สามารถกรองข้อมูลได้', 'error');
    }
}

// ==========================================
// DATA LOADING WITH ERROR HANDLING
// ==========================================
async function loadData() {
    if (State.isLoading) return;
    State.isLoading = true;
    updateSearchMeta(State.searchQuery ? `กำลังค้นหา "${State.searchQuery}"...` : 'กำลังโหลดรายการ...');

    try {
        if (typeof window.api === 'undefined' || !window.api.loadRecords) {
            console.warn('⚠️ api.loadRecords not available');
            State.isLoading = false;
            return;
        }
        
        console.log('📤 loadData called, filter:', State.currentFilter, 'search:', State.searchQuery);
        
        const params = getSearchParams();

        console.log('📤 Calling api.loadRecords...');
        const [records, count, insights] = await Promise.all([
            api.loadRecords(params),
            api.getRecordsCount(params),
            api.getSearchInsights ? api.getSearchInsights(params) : Promise.resolve({ totalMatched: 0, byType: {}, byStatus: {}, topBrands: [] })
        ]);

        console.log('📥 loadData got records:', records?.length || 0, 'count:', count);

        State.records = records || [];
        State.totalCount = count || 0;
        State.searchInsights = insights || { totalMatched: 0, byType: {}, byStatus: {}, topBrands: [] };
        State.errorCount = 0; // Reset error count on success

        if (State.searchQuery) {
            addRecentSearch(State.searchQuery);
        }

        // Reset virtual scroll เมื่อเปลี่ยนหน้า/search/filter
        State.virtualScroll.startIndex = 0;
        State.virtualScroll.endIndex = Math.min(State.virtualScroll.visibleCount, State.records.length);

        // Scroll to top
        if (State.virtualScroll.container) {
            State.virtualScroll.container.scrollTop = 0;
        }

        console.log('📊 State.totalCount:', State.totalCount, 'State.records.length:', State.records.length, 'State.pageSize:', State.pageSize, 'State.currentPage:', State.currentPage);

        if (State.searchQuery) {
            updateSearchMeta(`พบ ${State.totalCount.toLocaleString()} รายการ สำหรับ "${State.searchQuery}"`);
        } else if (getActiveAdvancedSearchCount() > 0) {
            updateSearchMeta(`พบ ${State.totalCount.toLocaleString()} รายการ จากตัวกรองขั้นสูง`);
        } else {
            updateSearchMeta(`ทั้งหมด ${State.totalCount.toLocaleString()} รายการ`);
        }

        renderTable();
        updatePagination();
        updateSearchClearButton();
        renderSearchInsights();
    } catch (error) {
        console.error('❌ Load data error:', error);
        updateSearchMeta('ค้นหาไม่สำเร็จ');
        showNotification('ไม่สามารถโหลดข้อมูลได้: ' + error.message, 'error');
        State.errorCount++;
        if (State.errorCount < State.maxErrors) {
            setTimeout(() => loadData(), 1000);
        }
    } finally {
        State.isLoading = false;
    }
}

// ==========================================
// VIRTUAL SCROLLING (Anti-freeze)
// ==========================================
function setupVirtualScroll() {
    // ตัว scroll จริงคือ .table-wrapper ไม่ใช่ #virtual-container
    const tableWrapper = document.querySelector('.table-wrapper');
    if (!tableWrapper) {
        console.warn('⚠️ .table-wrapper not found');
        return;
    }

    State.virtualScroll.container = tableWrapper;
    tableWrapper.removeEventListener('scroll', handleScroll);

    // ปิด virtual scroll สำหรับหน้าที่มีจำนวนเรคคอร์ดไม่เกินขนาดหน้าปัจจุบัน
    const useVirtual = State.records.length > State.pageSize;
    if (!useVirtual) {
        State.virtualScroll.visibleCount = State.records.length;
        State.virtualScroll.startIndex = 0;
        State.virtualScroll.endIndex = State.records.length;
        renderTable();
        return;
    }

    const containerHeight = tableWrapper.clientHeight || 600;
    State.virtualScroll.visibleCount = Math.ceil(containerHeight / State.virtualScroll.rowHeight) + 5;

    console.log('📊 Virtual scroll setup: containerHeight=', containerHeight, 'visibleCount=', State.virtualScroll.visibleCount);

    tableWrapper.addEventListener('scroll', handleScroll, { passive: true });

    if (State.records.length > 0) {
        State.virtualScroll.startIndex = 0;
        State.virtualScroll.endIndex = Math.min(State.virtualScroll.visibleCount, State.records.length);
        renderTable();
    }
}

function handleScroll() {
    if (State.virtualScroll._scrolling) return;
    State.virtualScroll._scrolling = true;

    requestAnimationFrame(() => {
        const container = State.virtualScroll.container || document.querySelector('.table-wrapper');
        if (!container) { State.virtualScroll._scrolling = false; return; }

        const scrollTop = container.scrollTop;
        const startIndex = Math.floor(scrollTop / State.virtualScroll.rowHeight);
        const endIndex = Math.min(startIndex + State.virtualScroll.visibleCount, State.records.length);

        if (startIndex !== State.virtualScroll.startIndex || endIndex !== State.virtualScroll.endIndex) {
            State.virtualScroll.startIndex = startIndex;
            State.virtualScroll.endIndex = endIndex;
            renderVisibleRows();
        }
        State.virtualScroll._scrolling = false;
    });
}

function renderTable() {
    const top = document.getElementById('virtual-top');
    const bottom = document.getElementById('virtual-bottom');

    if (!State.virtualScroll.container || State.records.length <= State.pageSize) {
        State.virtualScroll.startIndex = 0;
        State.virtualScroll.endIndex = State.records.length;
        if (top) top.style.height = '0px';
        if (bottom) bottom.style.height = '0px';
        renderVisibleRows();
        return;
    }

    if (State.virtualScroll.endIndex <= State.virtualScroll.startIndex) {
        State.virtualScroll.endIndex = Math.min(State.virtualScroll.visibleCount, State.records.length);
    }

    if (top) top.style.height = `${State.virtualScroll.startIndex * State.virtualScroll.rowHeight}px`;
    if (bottom) bottom.style.height = `${Math.max(State.totalCount - State.virtualScroll.endIndex, 0) * State.virtualScroll.rowHeight}px`;
    renderVisibleRows();
}

function renderVisibleRows() {
    const tbody = document.getElementById('table-body');
    if (!tbody) return;

    const { startIndex, endIndex } = State.virtualScroll;
    const visibleRecords = State.records.slice(startIndex, endIndex);

    if (visibleRecords.length === 0) {
        tbody.innerHTML = `<tr><td colspan="12" class="empty-state">ไม่พบข้อมูลรายการ</td></tr>`;
        return;
    }

    let html = '';
    let lastGroup = '';

    if (State.listDraftRecord) {
        html += createDraftRowHTML();
    }

    for (let i = 0; i < visibleRecords.length; i++) {
        const r = visibleRecords[i];
        const globalIndex = startIndex + i + 1;
        const importedDateKey = String(r.importedAt || '').slice(0, 10);
        const groupKey = `${importedDateKey}|${r.type || ''}`;

        if (groupKey !== lastGroup) {
            const typeIcon = r.type === 'รย' ? '🚗' : '🏍️';
            const typeLabel = r.type === 'รย' ? 'รถยนต์' : (r.type === 'จยย' ? 'จักรยานยนต์' : r.type);
            html += `<tr class="group-header"><td colspan="12">${formatDate(r.importedAt)} ${typeIcon} ${typeLabel}</td></tr>`;
            lastGroup = groupKey;
        }
        html += createRowHTML(r, globalIndex);
    }

    tbody.innerHTML = html;
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
            <td><span class="type-badge-sm ${row.type === 'จยย' ? 'motor' : 'car'}">${row.type === 'จยย' ? '🏍️ จยย.' : '🚗 รถยนต์'}</span></td>
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
        const statusClass = r.status === 'received' ? 'received' : 'pending';
        const statusText = r.status === 'received' ? '🟢 รับแล้ว' : '🔴 ยังไม่รับ';
        const receivedTime = formatDateTime(r.receivedAt);
        const rowClass = [selected ? 'selected' : '', r.status === 'received' ? 'row-received' : ''].filter(Boolean).join(' ');
        const safeType = r.type === 'จยย' ? 'จยย' : 'รย';

        return `
        <tr class="${rowClass}" data-id="${r.id}" onclick="handleRowClick(event, '${r.id}')">
            <td><input type="checkbox" ${selected ? 'checked' : ''} onclick="event.stopPropagation(); toggleSelect('${r.id}')"></td>
            <td>${index}</td>
            <td><input class="inline-input mono list-plate-input" value="${escapeHTML(r.plate || '')}" onchange="updateField('${r.id}', 'plate', this.value)" placeholder="ทะเบียน"></td>
            <td><input class="inline-input list-province-input" value="${escapeHTML(r.province || '')}" onchange="updateField('${r.id}', 'province', this.value)" placeholder="จังหวัด"></td>
            <td><span class="type-badge-sm ${safeType === 'จยย' ? 'motor' : 'car'}">${safeType === 'จยย' ? '🏍️ จยย.' : '🚗 รถยนต์'}</span></td>
            <td class="brand-cell"><input class="inline-input" value="${escapeHTML(r.brand || '')}" onchange="updateField('${r.id}', 'brand', this.value)" placeholder="ยี่ห้อ"></td>
            <td class="status-cell"><span class="status-badge ${statusClass}">${statusText}</span></td>
            <td class="mono">${formatDate(r.importedAt)}</td>
            <td class="mono">${receivedTime}</td>
            <td>
                <div class="action-btns">
                    ${r.status === 'received' ?
                        `<button class="btn btn-sm" onclick="event.stopPropagation(); undoReceived('${r.id}')">ยกเลิก</button>` :
                        `<button class="btn btn-sm btn-success" onclick="event.stopPropagation(); markReceived('${r.id}')">✅ รับแล้ว</button>`
                    }
                </div>
            </td>
            <td><input class="inline-input" value="${escapeHTML(r.name || '')}" onchange="updateField('${r.id}', 'name', this.value)" placeholder="ชื่อ"></td>
            <td><input class="inline-input mono" value="${escapeHTML(r.phone || '')}" onchange="updateField('${r.id}', 'phone', this.value)" placeholder="เบอร์โทร"></td>
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
    const seqId = getNextSequenceId();
    const record = State.records.find(r => r.id === id);
    if (!record) return;
    
    const oldValue = record[field];

    // Optimistic update
    record[field] = value;
    pushRollback(id, { [field]: oldValue });
    renderVisibleRows();

    try {
        trackRequest(seqId);
        await api.updateField({ id, field, value, sequenceId: seqId });
        
        if (isStaleRequest(seqId)) {
            console.log('⏭️ Stale request detected, discarding response');
            return;
        }
        
        State.lastAction = { type: 'updateField', id, field, value, oldValue };
    } catch (error) {
        console.error('❌ updateField failed, rolling back:', error);
        
        // Rollback optimistic update
        if (executeRollback(id)) {
            showNotification('❌ อัปเดตไม่สำเร็จ: ' + error.message + ' (กู้คืนแล้ว)', 'error');
            renderVisibleRows();
        } else {
            showNotification('❌ อัปเดตไม่สำเร็จ: ' + error.message, 'error');
            loadData(); // Full reload if rollback fails
        }
    } finally {
        completeRequest(seqId);
    }
}

async function markReceived(id) {
    const seqId = getNextSequenceId();
    const record = State.records.find(r => r.id === id);
    if (!record) return;

    const oldStatus = record.status;
    const oldReceivedAt = record.receivedAt;

    // Optimistic update
    record.status = 'received';
    record.receivedAt = new Date().toISOString();
    pushRollback(id, { status: oldStatus, receivedAt: oldReceivedAt });
    renderVisibleRows();

    try {
        trackRequest(seqId);
        await api.markReceived([id], seqId);
        
        if (isStaleRequest(seqId)) {
            console.log('⏭️ Stale request detected, discarding response');
            return;
        }
        
        State.lastAction = { type: 'markReceived', id, oldStatus, oldReceivedAt };
        showUndoToast('✅ รับเล่มแล้ว');
        updateStats();
    } catch (error) {
        console.error('❌ markReceived failed, rolling back:', error);
        
        // Rollback optimistic update
        if (executeRollback(id)) {
            showNotification('❌ รับเล่มไม่สำเร็จ: ' + error.message + ' (กู้คืนแล้ว)', 'error');
            renderVisibleRows();
        } else {
            showNotification('❌ รับเล่มไม่สำเร็จ: ' + error.message, 'error');
            loadData();
        }
    } finally {
        completeRequest(seqId);
    }
}

async function undoReceived(id) {
    const seqId = getNextSequenceId();
    const record = State.records.find(r => r.id === id);
    if (!record) return;

    const oldStatus = record.status;
    const oldReceivedAt = record.receivedAt;

    // Optimistic
    record.status = 'pending';
    record.receivedAt = null;
    pushRollback(id, { status: oldStatus, receivedAt: oldReceivedAt });
    renderVisibleRows();

    try {
        trackRequest(seqId);
        await api.undoReceived([id], seqId);
        
        if (isStaleRequest(seqId)) {
            console.log('⏭️ Stale request detected, discarding response');
            return;
        }
        
        State.rollbackStack.delete(id);
        showNotification('🔄 ยกเลิกแล้ว', 'success');
        updateStats();
    } catch (error) {
        console.error('❌ undoReceived failed, rolling back:', error);
        
        if (executeRollback(id)) {
            showNotification('❌ ยกเลิกไม่สำเร็จ: ' + error.message + ' (กู้คืนแล้ว)', 'error');
            renderVisibleRows();
        } else {
            showNotification('❌ ยกเลิกไม่สำเร็จ: ' + error.message, 'error');
            loadData();
        }
    } finally {
        completeRequest(seqId);
    }
}

async function deleteRecord(id) {
    const seqId = getNextSequenceId();
    if (!confirm('ยืนยันลบรายการนี้?')) return;

    // Optimistic delete
    const index = State.records.findIndex(r => r.id === id);
    if (index === -1) return;
    
    const removed = State.records[index];
    pushRollback(id, { ...removed, _deleted: true });
    
    State.records.splice(index, 1);
    State.totalCount--;
    renderVisibleRows();
    updatePagination();

    try {
        trackRequest(seqId);
        await api.deleteRecords([id], seqId);
        
        if (isStaleRequest(seqId)) {
            console.log('⏭️ Stale request detected, discarding response');
            return;
        }
        
        State.rollbackStack.delete(id);
        showUndoToast('🗑️ ลบแล้ว');
        updateStats();
    } catch (error) {
        console.error('❌ deleteRecord failed, rolling back:', error);
        
        // Rollback: re-insert the record
        if (executeRollback(id)) {
            const rollback = State.rollbackStack.get(id) || { ...removed };
            if (rollback._deleted) {
                delete rollback._deleted;
                State.records.splice(index, 0, rollback);
                State.totalCount++;
            }
            State.rollbackStack.delete(id);
            showNotification('❌ ลบไม่สำเร็จ: ' + error.message + ' (กู้คืนแล้ว)', 'error');
            renderVisibleRows();
            updatePagination();
        } else {
            showNotification('❌ ลบไม่สำเร็จ: ' + error.message, 'error');
            loadData();
        }
    } finally {
        completeRequest(seqId);
    }
}

async function deleteSelected() {
    const seqId = getNextSequenceId();
    if (State.selectedIds.size === 0) {
        showNotification('⚠️ กรุณาเลือกรายการที่จะลบ', 'warning');
        return;
    }

    if (!confirm(`ยืนยันลบ ${State.selectedIds.size} รายการ?`)) return;

    const ids = Array.from(State.selectedIds);
    
    // Save state for rollback
    const removedRecords = ids.map(id => {
        const record = State.records.find(r => r.id === id);
        return record ? { ...record } : null;
    }).filter(Boolean);
    
    // Optimistic
    const oldRecords = [...State.records];
    const oldCount = State.totalCount;
    
    State.records = State.records.filter(r => !State.selectedIds.has(r.id));
    State.totalCount = State.records.length;
    renderVisibleRows();
    updatePagination();

    try {
        trackRequest(seqId);
        await api.deleteRecords(ids, seqId);
        
        if (isStaleRequest(seqId)) {
            console.log('⏭️ Stale request detected, discarding response');
            return;
        }
        
        showNotification(`🗑️ ลบ ${ids.length} รายการสำเร็จ`, 'success');
        clearSelection();
        updateStats();
    } catch (error) {
        console.error('❌ deleteSelected failed, rolling back:', error);
        
        // Rollback: restore all records
        State.records = oldRecords;
        State.totalCount = oldCount;
        showNotification('❌ ลบไม่สำเร็จ: ' + error.message + ' (กู้คืนแล้ว)', 'error');
        renderVisibleRows();
        updatePagination();
    } finally {
        completeRequest(seqId);
    }
}

// ==========================================
// SELECTION & BULK ACTIONS
// ==========================================
function handleRowClick(event, id) {
    if (event.ctrlKey || event.metaKey) toggleSelect(id);
}

function updateBulkBar() {
    const bulkBar = document.getElementById('bulk-bar');
    const countEl = document.getElementById('selected-count');
    if (State.selectedIds.size > 0) {
        bulkBar?.classList.add('visible');
        if (countEl) countEl.textContent = State.selectedIds.size;
    } else {
        bulkBar?.classList.remove('visible');
    }
}

function toggleSelect(id) {
    if (State.selectedIds.has(id)) State.selectedIds.delete(id);
    else State.selectedIds.add(id);
    updateBulkBar();
    renderVisibleRows();
}

function toggleSelectAll() {
    const selectAllCheckbox = document.getElementById('select-all');
    const { startIndex, endIndex } = State.virtualScroll;
    const visibleRecords = State.records.slice(startIndex, endIndex);
    if (selectAllCheckbox?.checked) visibleRecords.forEach(r => State.selectedIds.add(r.id));
    else visibleRecords.forEach(r => State.selectedIds.delete(r.id));
    updateBulkBar();
    renderVisibleRows();
}

function updateBulkBar() {
    const bulkBar = document.getElementById('bulk-bar');
    const countEl = document.getElementById('selected-count');
    if (State.selectedIds.size > 0) {
        bulkBar?.classList.add('visible');
        if (countEl) countEl.textContent = State.selectedIds.size;
    } else {
        bulkBar?.classList.remove('visible');
    }
}

function clearSelection() {
    State.selectedIds.clear();
    updateBulkBar();
    renderVisibleRows();
    const selectAllCheckbox = document.getElementById('select-all');
    if (selectAllCheckbox) selectAllCheckbox.checked = false;
}

async function bulkSave() {
    const brand = document.getElementById('bulk-brand')?.value;
    if (!brand || State.selectedIds.size === 0) return;

    showLoading();
    try {
        const ids = Array.from(State.selectedIds);
        await Promise.all(ids.map(id => api.updateField({ id, field: 'brand', value: brand })));
        showNotification(`✅ อัปเดต ${State.selectedIds.size} รายการ`, 'success');
        clearSelection();
        loadData();
    } catch (error) {
        showNotification('❌ ไม่สำเร็จ', 'error');
    } finally { hideLoading(); }
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
    
    console.log('📂 File dropped:', file.name, 'Size:', (file.size / 1024).toFixed(2), 'KB');
    showLoading('กำลังอ่านไฟล์...');
    
    try {
        // Read as ArrayBuffer and convert to plain array for IPC
        const arrayBuffer = await file.arrayBuffer();
        const byteArray = Array.from(new Uint8Array(arrayBuffer));
        State.fileBuffer = { type: 'Buffer', data: byteArray };
        
        console.log('📤 Sending to parseExcel...');
        const result = await api.parseExcel(State.fileBuffer);
        console.log('📥 parseExcel result:', JSON.stringify(result, null, 2));
        
        if (!result.success) throw new Error(result.error);
        
        State.sheetNames = result.sheetNames || [result.sheetName];
        State.sheetCount = result.sheetCount || 1;
        State.currentSheetIndex = 0;
        State.selectedImportSheets = State.sheetCount > 1 ? [] : [0];
        State.importRawData = result.data || [];
        
        console.log('📊 Parsing Excel data...');
        State.importData = parseExcelData(State.importRawData);
        console.log('✅ Parsed', State.importData.length, 'records');
        
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
    try {
        console.log('📂 Opening file dialog...');
        const filePath = await api.openExcelDialog();
        if (!filePath) {
            console.log('⚠️ User canceled file selection');
            return;
        }

        console.log('📁 File selected:', filePath);
        State.importFilePath = filePath;
        showLoading('กำลังอ่านไฟล์...');

        console.log('📤 Parsing Excel file...');
        const result = await api.parseExcel(filePath);
        console.log('📥 parseExcel result:', JSON.stringify(result, null, 2));
        
        if (!result.success) throw new Error(result.error);

        State.sheetNames = result.sheetNames || [result.sheetName];
        State.sheetCount = result.sheetCount || 1;
        State.currentSheetIndex = 0;
        State.selectedImportSheets = State.sheetCount > 1 ? [] : [0];
        State.importRawData = result.data || [];
        
        console.log('📊 Parsing Excel data...');
        State.importData = parseExcelData(State.importRawData);
        console.log('✅ Parsed', State.importData.length, 'records');
        
        showPreview();
        updateStep(2);
        showNotification(
            State.sheetCount > 1
                ? `📚 พบ ${State.sheetCount} Sheet กรุณาเลือก Sheet ที่ต้องการนำเข้าก่อน`
                : `📄 พบข้อมูล ${State.importData.length} รายการ`,
            'success'
        );
    } catch (error) {
        console.error('❌ selectFile error:', error);
        console.error('❌ Error stack:', error.stack);
        showNotification('❌ อ่านไฟล์ไม่สำเร็จ: ' + error.message, 'error');
    } finally { 
        hideLoading(); 
    }
}

function parseExcelData(data, options = {}) {
    const records = [];
    
    console.log('🔍 parseExcelData called');
    console.log('📊 Data type:', typeof data);
    console.log('📊 Is array:', Array.isArray(data));
    console.log('📊 Data length:', Array.isArray(data) ? data.length : 'N/A');
    
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
    
    console.log('📊 First 3 rows preview:', JSON.stringify(data.slice(0, 3), null, 2));
    
    const normalize = (value) => {
        if (value === null || value === undefined) return '';
        return String(value).trim();
    };

    const parseDateString = (value) => {
        const text = normalize(value);
        if (!text) return '';

        const thaiMatch = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
        if (thaiMatch) {
            let day = thaiMatch[1].padStart(2, '0');
            let month = thaiMatch[2].padStart(2, '0');
            let year = parseInt(thaiMatch[3], 10);
            
            // Handle 2-digit years (e.g., "69" means BE 2569 -> CE 2026)
            if (year < 100) {
                // Excel sheets commonly shorten Buddhist Era years, e.g. 69 => 2569
                year += 2500;
            }
            // Convert Buddhist Era to Common Era
            if (year > 2400) year -= 543;
            return `${year}-${month}-${day}`;
        }

        const parsed = new Date(text);
        if (!isNaN(parsed.getTime())) {
            return parsed.toISOString().split('T')[0];
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

    const findAppointmentDate = () => {
        const secondRow = Array.isArray(data[1]) ? data[1] : [];
        const secondRowDateText = secondRow.slice(2, 6).map(cell => normalize(cell)).join(' ');
        const secondRowDate = parseDateString(secondRowDateText);
        if (secondRowDate) return secondRowDate;

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
    const appointmentDate = options.selectedDate || findAppointmentDate() || dateCandidates[0] || '';

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

    const defaultDate = appointmentDate || new Date().toISOString().split('T')[0];
    State.selectedImportDate = defaultDate;
    console.log('📅 Default date:', defaultDate);
    console.log('🔍 Header index map:', headerIndexMap);

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

            let importedAt = defaultDate;
            const rowDate = normalize(row[headerIndexMap.date]);
            if (rowDate) {
                const parsedRowDate = parseDateString(rowDate);
                if (parsedRowDate) importedAt = parsedRowDate;
            }

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

    console.log('✅ Total records parsed:', records.length);
    return records;
}

function showPreview() {
    try {
        console.log('💪 showPreview called, importData length:', State.importData.length);
        const fileZone = document.getElementById('file-zone');
        const previewSection = document.getElementById('preview-section');
        const importCount = document.getElementById('import-count');
        const typeBadges = document.getElementById('type-badges');
        const previewNote = document.getElementById('preview-note');
        const previewTbody = document.getElementById('preview-tbody');
        const sheetSelector = document.getElementById('sheet-selector');
        const sheetDropdown = document.getElementById('sheet-dropdown');
        const sheetBulkTools = document.getElementById('sheet-bulk-tools');
        const sheetSelectionNote = document.getElementById('sheet-selection-note');
        const sheetSelectionList = document.getElementById('sheet-selection-list');
        const importButton = document.getElementById('btn-import');

        fileZone?.classList.add('hidden');
        previewSection?.classList.add('visible');
        console.log('👋 previewSection visible');

        // Setup sheet selector if multiple sheets exist
        if (State.sheetCount > 1 && sheetSelector && sheetDropdown) {
            sheetSelector.style.display = 'block';
            sheetDropdown.innerHTML = State.sheetNames.map((name, idx) =>
                `<option value="${idx}" ${idx === State.currentSheetIndex ? 'selected' : ''}>${name}</option>`
            ).join('');
        } else if (sheetSelector) {
            sheetSelector.style.display = 'none';
        }

        renderImportSheetSelection(sheetBulkTools, sheetSelectionList, sheetSelectionNote);

        if (importButton) {
            importButton.disabled = false;
            importButton.title = State.sheetCount > 1 && State.selectedImportSheets.length === 0
                ? 'กดเพื่อนำเข้าหลังจากเลือก Sheet อย่างน้อย 1 รายการ'
                : '';
        }

        if (importCount) importCount.textContent = State.importData.length.toLocaleString();

        const carCount = State.importData.filter(r => r.type === 'รย').length;
        const motorCount = State.importData.filter(r => r.type === 'จยย').length;
        if (typeBadges) {
            typeBadges.innerHTML = `
                <span class="type-badge car">🚗 รถยนต์ ${carCount.toLocaleString()} คัน</span>
                <span class="type-badge motor">🏍️ จักรยานยนต์ ${motorCount.toLocaleString()} คัน</span>
            `;
        }

        if (previewNote) {
            if (State.importData.length > IMPORT_PREVIEW_ROW_LIMIT) {
                previewNote.classList.add('visible');
                previewNote.textContent = `แสดงตัวอย่าง ${IMPORT_PREVIEW_ROW_LIMIT.toLocaleString()} จาก ${State.importData.length.toLocaleString()} รายการแรก เพื่อให้หน้าไม่ค้างเวลานำเข้าไฟล์ใหญ่`;
            } else {
                previewNote.classList.remove('visible');
                previewNote.textContent = '';
            }
        }

        if (previewTbody) {
            const previewRows = State.importData.slice(0, IMPORT_PREVIEW_ROW_LIMIT);
            console.log('📊 Rendering preview rows:', previewRows.length, 'of', State.importData.length);
            previewTbody.innerHTML = previewRows.map((r, i) => `
                <tr>
                    <td>${i + 1}</td>
                    <td class="mono">${escapeHTML(r.plate)}</td>
                    <td>${r.type === 'รย' ? '🚗 รย.' : '🏍️ จยย.'}</td>
                    <td>${escapeHTML(r.province || '')}</td>
                    <td>${escapeHTML(r.brand || '')}</td>
                    <td>${formatDate(r.importedAt)}</td>
                </tr>
            `).join('');
        }
    } catch (e) { console.error('Preview error:', e); }
}

async function confirmImport() {
    const selectedSheetIndexes = State.sheetCount > 1
        ? Array.from(new Set(State.selectedImportSheets)).sort((a, b) => a - b)
        : [State.currentSheetIndex];

    if (selectedSheetIndexes.length === 0) {
        showNotification('❌ กรุณาเลือกอย่างน้อย 1 Sheet', 'error');
        return;
    }

    if (State.importData.length === 0) {
        showNotification('❌ ไม่มีข้อมูลที่จะนำเข้า', 'error');
        return;
    }

    let recordsToImport = [];
    try {
        showLoading(selectedSheetIndexes.length > 1 ? 'กำลังเตรียมข้อมูลจากหลาย Sheet...' : 'กำลังเตรียมข้อมูล...');

        for (const sheetIndex of selectedSheetIndexes) {
            if (sheetIndex === State.currentSheetIndex) {
                recordsToImport = recordsToImport.concat(State.importData);
                continue;
            }

            let input;
            if (State.fileBuffer) {
                input = { data: State.fileBuffer, sheetIndex };
            } else if (State.importFilePath) {
                input = { data: State.importFilePath, sheetIndex };
            } else {
                throw new Error('ไม่มีข้อมูลไฟล์');
            }

            const result = await api.parseExcelSheet(input);
            if (!result.success) throw new Error(result.error);
            recordsToImport = recordsToImport.concat(
                parseExcelData(result.data || [])
            );
        }
    } catch (error) {
        hideLoading();
        showNotification('❌ เตรียมข้อมูลนำเข้าไม่สำเร็จ: ' + error.message, 'error');
        return;
    }

    if (recordsToImport.length === 0) {
        hideLoading();
        showNotification('❌ ไม่มีข้อมูลที่จะนำเข้า', 'error');
        return;
    }

    // แสดงสรุปข้อมูลก่อนนำเข้า
    const carCount = recordsToImport.filter(r => r.type === 'รย').length;
    const motorCount = recordsToImport.filter(r => r.type === 'จยย').length;
    const previewPlates = recordsToImport.slice(0, IMPORT_CONFIRM_PLATE_LIMIT).map(r => r.plate).join(', ');
    const selectedSheetNames = selectedSheetIndexes
        .map(index => State.sheetNames[index])
        .filter(Boolean)
        .join(', ');

    const confirmMsg = `📊 สรุปข้อมูลที่จะนำเข้า:\n\n` +
        `${selectedSheetNames ? `📄 Sheet: ${selectedSheetNames}\n` : ''}` +
        `🚗 รถยนต์: ${carCount} คัน\n` +
        `🏍️ จักรยานยนต์: ${motorCount} คัน\n` +
        `📋 รวมทั้งหมด: ${recordsToImport.length} คัน\n\n` +
        `ทะเบียนรถ${recordsToImport.length > IMPORT_CONFIRM_PLATE_LIMIT ? ` (แสดง ${IMPORT_CONFIRM_PLATE_LIMIT} รายการแรก)` : ''}:\n${previewPlates}\n\n` +
        `คุณต้องการนำเข้าข้อมูลนี้หรือไม่?`;

    if (!confirm(confirmMsg)) {
        console.log('🚫 Import cancelled by user');
        hideLoading();
        return;
    }

    console.log(`📦 Starting import with ${recordsToImport.length} records...`);
    showLoading('กำลังนำเข้าข้อมูล...');
    updateStep(3);
    resetImportProgress();

    try {
        const result = await api.saveRecords({ records: recordsToImport, batchSize: 1000 });
        console.log('✅ Import result:', result);
        
        const imported = result?.imported || 0;
        const skipped = result?.skipped || 0;

        hideImportProgress();
        hideLoading();

        if (imported > 0 || skipped > 0) {
            const importedPlates = recordsToImport.slice(0, imported).map(r => r.plate).join(', ');
            let successMsg = `✅ นำเข้าสำเร็จ!\n\n` +
                `✔️ นำเข้า: ${imported.toLocaleString()} คัน\n` +
                `⏭️ ข้ามซ้ำ: ${skipped.toLocaleString()} คัน\n`;

            if (imported > 0 && imported <= 50) {
                successMsg += `\nทะเบียนที่นำเข้า:\n${importedPlates}`;
            } else if (imported > 50) {
                successMsg += `\n(แสดงเฉพาะ 50 คันแรก)`;
            }

            if (skipped > 0) {
                successMsg += `\n\n⚠️ รายการที่ถูกข้ามหมายถึงทะเบียนที่มีอยู่ในวันที่เดียวกันแล้ว`;
            }

            showNotification(successMsg, 'success');
        } else {
            showNotification('⚠️ ไม่มีข้อมูลที่ถูกนำเข้า', 'warning');
        }

        const deleteCheckbox = document.getElementById('delete-original');
        if (deleteCheckbox?.checked && State.importFilePath) {
            await api.deleteFile(State.importFilePath);
        }

        cancelImport();
        console.log('🔄 Switching to list view after import...');
        switchView('list');
        console.log('🔄 Updating stats...');
        updateStats();
    } catch (error) {
        console.error('❌ Import failed:', error);
        hideImportProgress();
        hideLoading();
        showNotification('❌ นำเข้าไม่สำเร็จ: ' + error.message, 'error');
        updateStep(2);
    } finally { 
        hideLoading();
    }
}

function updateImportProgress(payload) {
    try {
        const progressBar = document.getElementById('progress-fill');
        const progressText = document.getElementById('import-progress-text');
        const progressContainer = document.getElementById('import-progress-bar');

        if (progressContainer) progressContainer.style.display = 'block';
        if (progressBar) progressBar.style.width = `${payload.progress}%`;
        if (progressText) progressText.textContent = payload.message || `นำเข้า ${payload.imported.toLocaleString()} / ${payload.total.toLocaleString()} รายการ`;
    } catch (e) { /* Silent fail for progress */ }
}

function resetImportProgress() {
    const progressBar = document.getElementById('progress-fill');
    const progressContainer = document.getElementById('import-progress-bar');
    if (progressContainer) progressContainer.style.display = 'block';
    if (progressBar) progressBar.style.width = '0%';
}

function hideImportProgress() {
    const progressContainer = document.getElementById('import-progress-bar');
    if (progressContainer) progressContainer.style.display = 'none';
}

function cancelImport() {
    State.importData = [];
    State.importRawData = [];
    State.importFilePath = null;
    State.selectedImportDate = '';
    State.selectedImportSheets = [];
    State.sheetNames = [];
    State.currentSheetIndex = 0;
    State.fileBuffer = null;
    State.sheetCount = 0;
    document.getElementById('file-zone')?.classList.remove('hidden');
    document.getElementById('preview-section')?.classList.remove('visible');
    hideImportProgress();
    updateStep(1);
}

function updateStep(step) {
    for (let i = 1; i <= 3; i++) {
        const stepEl = document.getElementById(`step-${i}`);
        if (!stepEl) continue;
        stepEl.classList.remove('active', 'complete');
        if (i < step) stepEl.classList.add('complete');
        else if (i === step) stepEl.classList.add('active');
    }
}

async function switchSheet() {
    const dropdown = document.getElementById('sheet-dropdown');
    if (!dropdown) return;
    
    const previousIndex = State.currentSheetIndex;
    const newIndex = parseInt(dropdown.value, 10);
    if (newIndex === State.currentSheetIndex) return;
    
    State.currentSheetIndex = newIndex;
    showLoading('กำลังอ่าน Sheet...');
    
    try {
        let input;
        if (State.fileBuffer) {
            input = { data: State.fileBuffer, sheetIndex: newIndex };
        } else if (State.importFilePath) {
            input = { data: State.importFilePath, sheetIndex: newIndex };
        } else {
            throw new Error('ไม่มีข้อมูลไฟล์');
        }
        
        const result = await api.parseExcelSheet(input);
        if (!result.success) throw new Error(result.error);

        State.importRawData = result.data || [];
        State.importData = parseExcelData(State.importRawData);
        showPreview();
    } catch (error) {
        showNotification('❌ ไม่สามารถเปลี่ยน Sheet: ' + error.message, 'error');
        State.currentSheetIndex = previousIndex;
    } finally {
        hideLoading();
    }
}

function applyImportDateSelection(value) {
    const nextDate = String(value || '').trim();
    if (!nextDate) return;
    State.selectedImportDate = nextDate;
    State.importData = parseExcelData(State.importRawData, { selectedDate: nextDate });
    showPreview();
}

function setSelectedImportSheets(indexes) {
    const validIndexes = Array.from(new Set((indexes || [])
        .map(index => Number(index))
        .filter(index => Number.isInteger(index) && index >= 0 && index < State.sheetCount)))
        .sort((a, b) => a - b);

    State.selectedImportSheets = validIndexes;
    renderImportSheetSelection();
    showPreview();
}

function renderImportSheetSelection(sheetBulkTools, sheetSelectionList, sheetSelectionNote) {
    const toolsEl = sheetBulkTools || document.getElementById('sheet-bulk-tools');
    const listEl = sheetSelectionList || document.getElementById('sheet-selection-list');
    const noteEl = sheetSelectionNote || document.getElementById('sheet-selection-note');
    if (!toolsEl || !listEl) return;

    if (State.sheetCount <= 1) {
        toolsEl.classList.remove('visible');
        listEl.classList.remove('visible');
        listEl.innerHTML = '';
        if (noteEl) {
            noteEl.style.display = 'none';
            noteEl.textContent = '';
        }
        return;
    }

    toolsEl.classList.add('visible');
    listEl.classList.add('visible');
    if (noteEl) {
        noteEl.style.display = 'block';
        noteEl.textContent = State.selectedImportSheets.length > 0
            ? `เลือกแล้ว ${State.selectedImportSheets.length} จาก ${State.sheetCount} Sheet` 
            : `พบ ${State.sheetCount} Sheet ในไฟล์นี้ กรุณาเลือกอย่างน้อย 1 Sheet ก่อนนำเข้า`;
    }
    listEl.innerHTML = State.sheetNames.map((name, index) => {
        const checked = State.selectedImportSheets.includes(index) ? 'checked' : '';
        const previewLabel = index === State.currentSheetIndex ? 'กำลังแสดงตัวอย่างอยู่' : 'พร้อมนำเข้า';
        return `
            <label class="sheet-option">
                <input type="checkbox" ${checked} onchange="toggleImportSheetSelection(${index}, this.checked)">
                <span class="sheet-option-label">
                    <span class="sheet-option-name">${escapeHTML(name || `Sheet ${index + 1}`)}</span>
                    <span class="sheet-option-meta">${previewLabel}</span>
                </span>
            </label>
        `;
    }).join('');
}

function toggleImportSheetSelection(index, checked) {
    const next = new Set(State.selectedImportSheets);
    if (checked) next.add(index);
    else next.delete(index);
    setSelectedImportSheets(Array.from(next));
}

function selectAllImportSheets() {
    setSelectedImportSheets(State.sheetNames.map((_, index) => index));
}

function clearImportSheetSelection() {
    setSelectedImportSheets([]);
}

function createEmptyManualEntryRow() {
    return {
        id: generateUUID(),
        plate: '',
        province: State.settings.province || '',
        type: 'รย',
        brand: '',
        importedAt: new Date().toISOString().split('T')[0],
        name: '',
        phone: ''
    };
}

function updateManualEntryCount() {
    const badge = document.getElementById('manual-entry-count');
    if (!badge) return;
    badge.textContent = `${State.manualEntries.length.toLocaleString()} แถวพร้อมกรอก`;
}

function renderManualEntryTable() {
    const tbody = document.getElementById('manual-entry-body');
    if (!tbody) return;

    tbody.innerHTML = State.manualEntries.map((row, index) => {
        const hasAnyValue = [row.plate, row.province, row.brand, row.importedAt, row.name, row.phone]
            .some(value => String(value || '').trim() !== '');
        const isInvalid = hasAnyValue && (!String(row.plate || '').trim() || !String(row.importedAt || '').trim());

        return `
            <tr class="${isInvalid ? 'row-invalid' : ''}">
                <td>${index + 1}</td>
                <td><input type="text" value="${escapeHTML(row.plate)}" oninput="updateManualEntryField(${index}, 'plate', this.value)" placeholder="เช่น 1กข 1234"></td>
                <td><input type="text" value="${escapeHTML(row.province)}" oninput="updateManualEntryField(${index}, 'province', this.value)" placeholder="จังหวัด"></td>
                <td>
                    <select onchange="updateManualEntryField(${index}, 'type', this.value)">
                        <option value="รย" ${row.type === 'รย' ? 'selected' : ''}>รย</option>
                        <option value="จยย" ${row.type === 'จยย' ? 'selected' : ''}>จยย</option>
                    </select>
                </td>
                <td><input type="text" value="${escapeHTML(row.brand)}" oninput="updateManualEntryField(${index}, 'brand', this.value)" placeholder="ยี่ห้อ"></td>
                <td><input type="date" value="${escapeHTML(row.importedAt)}" oninput="updateManualEntryField(${index}, 'importedAt', this.value)"></td>
                <td><input type="text" value="${escapeHTML(row.name)}" oninput="updateManualEntryField(${index}, 'name', this.value)" placeholder="ชื่อผู้รับ"></td>
                <td><input type="text" value="${escapeHTML(row.phone)}" oninput="updateManualEntryField(${index}, 'phone', this.value)" placeholder="เบอร์โทร"></td>
                <td><button class="btn btn-sm" type="button" onclick="removeManualEntryRow(${index})">ลบ</button></td>
            </tr>
        `;
    }).join('');

    updateManualEntryCount();
}

function addManualEntryRows(count = 1) {
    const nextCount = Math.max(1, Number(count) || 1);
    for (let index = 0; index < nextCount; index++) {
        State.manualEntries.push(createEmptyManualEntryRow());
    }
    renderManualEntryTable();
}

function resetManualEntryTable() {
    State.manualEntries = Array.from({ length: 8 }, () => createEmptyManualEntryRow());
    renderManualEntryTable();
}

function updateManualEntryField(index, field, value) {
    if (!State.manualEntries[index]) return;
    State.manualEntries[index][field] = value;
}

function removeManualEntryRow(index) {
    State.manualEntries.splice(index, 1);
    if (State.manualEntries.length === 0) {
        State.manualEntries.push(createEmptyManualEntryRow());
    }
    renderManualEntryTable();
}

async function saveManualEntries() {
    const preparedRows = [];
    let invalidRows = 0;

    for (const row of State.manualEntries) {
        const normalizedRow = {
            plate: String(row.plate || '').trim(),
            province: String(row.province || '').trim(),
            type: String(row.type || 'รย').trim() || 'รย',
            brand: String(row.brand || '').trim(),
            importedAt: String(row.importedAt || '').trim(),
            name: String(row.name || '').trim(),
            phone: String(row.phone || '').trim()
        };

        const hasAnyValue = Object.values(normalizedRow).some(value => String(value || '').trim() !== '');
        if (!hasAnyValue) continue;

        if (!normalizedRow.plate || !normalizedRow.importedAt) {
            invalidRows++;
            continue;
        }

        preparedRows.push({
            id: generateUUID(),
            ...normalizedRow,
            status: 'pending',
            receivedAt: null
        });
    }

    if (preparedRows.length === 0) {
        showNotification('❌ ไม่มีข้อมูลที่พร้อมบันทึก', 'error');
        return;
    }

    if (invalidRows > 0) {
        showNotification(`⚠️ มี ${invalidRows} แถวที่ยังไม่ครบ ระบบจะบันทึกเฉพาะแถวที่มีทะเบียนและวันนัด`, 'warning');
    }

    showLoading('กำลังบันทึกข้อมูลที่กรอก...');
    try {
        const result = await api.saveRecords({ records: preparedRows, batchSize: 500 });
        const imported = result?.imported || 0;
        const skipped = result?.skipped || 0;

        showNotification(`✅ บันทึกสำเร็จ ${imported.toLocaleString()} รายการ${skipped > 0 ? `, ข้ามซ้ำ ${skipped.toLocaleString()} รายการ` : ''}`, 'success');
        resetManualEntryTable();
        State.records = [];
        State.totalCount = 0;
        updateStats();
        switchView('list');
        loadData();
    } catch (error) {
        showNotification('❌ บันทึกข้อมูลไม่สำเร็จ: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

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
            loadAppVersionInfo();
            updateAppUpdateStatus(State.settings.updateManifestUrl ? 'พร้อมตรวจสอบอัปเดต' : 'ยังไม่ได้ตั้งค่า URL อัปเดต');
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

        showNotification('✅ บันทึกการตั้งค่าแล้ว', 'success');
    } catch (error) {
        showNotification('❌ บันทึกล้มเหลว', 'error');
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

        const confirmed = window.confirm(`พบเวอร์ชันใหม่ ${result.latestVersion}${notes}\n\nต้องการดาวน์โหลดและติดตั้งตอนนี้หรือไม่?`);
        if (!confirmed) {
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
    try {
        const stats = await api.getDashboardStats();
        const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = (val || 0).toLocaleString(); };
        setEl('stat-today', stats.today);
        setEl('stat-pending', stats.pending);
        setEl('stat-received', stats.received);
        renderDashboard(stats);
    } catch (e) { /* Silent */ }
}

async function loadDashboard() {
    try {
        const stats = await api.getDashboardStats();
        renderDashboard(stats);
    } catch (error) {
        console.error('Dashboard error:', error);
    }
}

function renderDashboard(stats) {
    const shell = document.getElementById('dashboard-shell');
    if (!shell) return;

    const byType = Array.isArray(stats?.byType) ? stats.byType : [];
    const carCount = byType.find(item => item.type === 'รย')?.count || 0;
    const motorCount = byType.find(item => item.type === 'จยย')?.count || 0;
    const total = Number(stats?.total || 0);
    const pending = Number(stats?.pending || 0);
    const received = Number(stats?.received || 0);
    const completionRate = total > 0 ? Math.round((received / total) * 100) : 0;
    const pendingRate = total > 0 ? Math.round((pending / total) * 100) : 0;
    const dailyItems = (stats?.daily || []).slice(-14);
    const maxDaily = Math.max(1, ...dailyItems.map(item => Number(item.count || 0)));
    const thaiMonths = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

    const formatShortDate = (value) => {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return value || '-';
        return `${date.getDate()} ${thaiMonths[date.getMonth()]}`;
    };

    shell.innerHTML = `
        <div class="dashboard-grid">
            <div class="settings-card" style="padding:18px;">
                <div class="insight-title">รายการทั้งหมด</div>
                <div style="font-size:30px; font-weight:700; margin-top:8px;">${total.toLocaleString()}</div>
                <div class="advanced-summary" style="margin-top:8px;">ภาพรวมข้อมูลในระบบ</div>
            </div>
            <div class="settings-card" style="padding:18px;">
                <div class="insight-title">ยังไม่รับ</div>
                <div style="font-size:30px; font-weight:700; margin-top:8px; color: var(--red-500);">${pending.toLocaleString()}</div>
                <div class="advanced-summary" style="margin-top:8px;">คิดเป็น ${pendingRate}% ของทั้งหมด</div>
            </div>
            <div class="settings-card" style="padding:18px;">
                <div class="insight-title">รับแล้ว</div>
                <div style="font-size:30px; font-weight:700; margin-top:8px; color: var(--emerald-500);">${received.toLocaleString()}</div>
                <div class="advanced-summary" style="margin-top:8px;">สำเร็จ ${completionRate}%</div>
            </div>
            <div class="settings-card" style="padding:18px;">
                <div class="insight-title">เข้าวันนี้</div>
                <div style="font-size:30px; font-weight:700; margin-top:8px; color: var(--blue-500);">${Number(stats?.today || 0).toLocaleString()}</div>
                <div class="advanced-summary" style="margin-top:8px;">รายการที่นำเข้าวันนี้</div>
            </div>
        </div>
        <div class="dashboard-panels">
            <div class="dashboard-chart-card">
                <h3 style="margin-bottom:14px;">แนวโน้ม 14 วันล่าสุด</h3>
                <canvas id="dashboard-chart" width="960" height="320"></canvas>
            </div>
            <div style="display:grid; gap: 18px;">
                <div class="settings-card">
                    <h3 style="margin-bottom:14px;">สัดส่วนประเภทรถ</h3>
                    <div class="settings-list">
                        <div class="settings-list-item" style="display:flex; justify-content:space-between; align-items:center;">
                            <span>🚗 รถยนต์</span>
                            <strong>${Number(carCount).toLocaleString()}</strong>
                        </div>
                        <div class="settings-list-item" style="display:flex; justify-content:space-between; align-items:center;">
                            <span>🏍️ จักรยานยนต์</span>
                            <strong>${Number(motorCount).toLocaleString()}</strong>
                        </div>
                    </div>
                </div>
                <div class="settings-card">
                    <h3 style="margin-bottom:14px;">มุมมองผู้จัดการ</h3>
                    <div class="settings-list">
                        <div class="settings-list-item">ถ้ายังค้างรับสูงกว่า 30% ควรไล่ติดตามคิวที่ค้างก่อน</div>
                        <div class="settings-list-item">วันที่มีรับเข้าเยอะจะเห็นแท่งกราฟสูงขึ้นทันที</div>
                        <div class="settings-list-item">สามารถกลับไปหน้า รายการทั้งหมด เพื่อแก้ข้อมูลผิดและติดตามสถานะต่อได้ทันที</div>
                    </div>
                </div>
            </div>
        </div>
    `;

    drawDashboardChart(dailyItems, formatShortDate, maxDaily);
}

function drawDashboardChart(dailyItems, formatShortDate, maxDaily) {
    const canvas = document.getElementById('dashboard-chart');
    if (!canvas) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    const ratio = window.devicePixelRatio || 1;
    const cssWidth = canvas.clientWidth || 960;
    const cssHeight = 280;
    canvas.width = Math.floor(cssWidth * ratio);
    canvas.height = Math.floor(cssHeight * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    const isLight = document.body.getAttribute('data-theme') === 'light';
    const stroke = isLight ? '#2563eb' : '#60a5fa';
    const fill = isLight ? 'rgba(37, 99, 235, 0.12)' : 'rgba(96, 165, 250, 0.16)';
    const grid = isLight ? 'rgba(100, 116, 139, 0.18)' : 'rgba(148, 163, 184, 0.16)';
    const text = isLight ? '#334155' : '#cbd5e1';
    const accent = isLight ? '#10b981' : '#34d399';

    context.clearRect(0, 0, cssWidth, cssHeight);

    if (!dailyItems.length) {
        context.fillStyle = text;
        context.font = '600 14px Sarabun';
        context.fillText('ยังไม่มีข้อมูลย้อนหลังสำหรับแสดงกราฟ', 24, 40);
        return;
    }

    const padding = { top: 18, right: 20, bottom: 42, left: 34 };
    const chartWidth = cssWidth - padding.left - padding.right;
    const chartHeight = cssHeight - padding.top - padding.bottom;
    const stepX = dailyItems.length > 1 ? chartWidth / (dailyItems.length - 1) : chartWidth;

    context.strokeStyle = grid;
    context.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = padding.top + (chartHeight / 4) * i;
        context.beginPath();
        context.moveTo(padding.left, y);
        context.lineTo(padding.left + chartWidth, y);
        context.stroke();
    }

    const points = dailyItems.map((item, index) => {
        const value = Number(item.count || 0);
        const x = padding.left + stepX * index;
        const y = padding.top + chartHeight - (value / Math.max(1, maxDaily)) * chartHeight;
        return { x, y, value, label: formatShortDate(item.date) };
    });

    context.beginPath();
    context.moveTo(points[0].x, padding.top + chartHeight);
    points.forEach((point) => context.lineTo(point.x, point.y));
    context.lineTo(points[points.length - 1].x, padding.top + chartHeight);
    context.closePath();
    context.fillStyle = fill;
    context.fill();

    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    points.forEach((point) => context.lineTo(point.x, point.y));
    context.strokeStyle = stroke;
    context.lineWidth = 3;
    context.stroke();

    points.forEach((point) => {
        context.beginPath();
        context.arc(point.x, point.y, 4.5, 0, Math.PI * 2);
        context.fillStyle = '#ffffff';
        context.fill();
        context.strokeStyle = accent;
        context.lineWidth = 2;
        context.stroke();
    });

    context.fillStyle = text;
    context.font = '12px Sarabun';
    context.textAlign = 'center';
    points.forEach((point) => {
        context.fillText(point.label, point.x, cssHeight - 14);
    });

    context.textAlign = 'left';
    context.font = '700 12px Sarabun';
    context.fillText(String(maxDaily), 4, padding.top + 6);
    context.fillText('0', 12, padding.top + chartHeight);
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
    const el = document.getElementById('undo-toast');
    if (!el) return;
    el.innerHTML = `${message}<button class="toast-undo-btn" onclick="undoLastAction()">↩️ ยกเลิก</button>`;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 5000);
}

async function undoLastAction() {
    const el = document.getElementById('undo-toast');
    if (el) el.classList.remove('show');
    if (!State.lastAction) return;

    try {
        const { type, id, oldStatus, oldReceivedAt, field, oldValue } = State.lastAction;
        if (type === 'markReceived') {
            await api.undoReceived([id]);
            const record = State.records.find(r => r.id === id);
            if (record) { record.status = oldStatus; record.receivedAt = oldReceivedAt; renderVisibleRows(); }
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
function showNotification(message, type = 'info') {
    const toast = document.getElementById('toast');
    if (!toast) return;

    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    toast.innerHTML = `<span class="toast-icon">${icons[type] || ''}</span><span>${message}</span>`;
    toast.className = `show ${type}`;
    setTimeout(() => toast.className = '', 3000);
}

// ==========================================
// LOADING OVERLAY
// ==========================================
function showLoading(text = 'กำลังประมวลผล...') {
    const overlay = document.getElementById('loading-overlay');
    const textEl = document.getElementById('loading-text');
    if (overlay) overlay.classList.add('show');
    if (textEl) textEl.textContent = text;
}

function hideLoading() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.classList.remove('show');
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

function formatDate(iso) {
    if (!iso) return '-';
    try {
        const text = String(iso).trim();
        const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        const date = isoMatch
            ? new Date(Date.UTC(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3])))
            : new Date(text);
        if (Number.isNaN(date.getTime())) return text;

        return new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            timeZone: isoMatch ? 'UTC' : 'Asia/Bangkok'
        }).format(date);
    } catch {
        return String(iso);
    }
}

function formatDateTime(iso) {
    if (!iso) return '-';
    try {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return String(iso);

        const dateText = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            timeZone: 'Asia/Bangkok'
        }).format(d);
        const time = d.toLocaleTimeString('th-TH', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Asia/Bangkok'
        });
        return `${dateText} ${time}`;
    } catch {
        return String(iso);
    }
}

// ==========================================
// EXPORT GLOBALS
// ==========================================
Object.assign(globalThis, {
    switchView, setFilter, selectFile, confirmImport, cancelImport, switchSheet,
    saveSettings, exportCsv, markReceived, undoReceived, deleteRecord, deleteSelected,
    updateField, toggleSelect, toggleSelectAll, clearSelection, bulkSave,
    handleRowClick, prevPage, nextPage, goToPage, goToLastPage,
    undoLastAction, toggleTheme, showDebug, hideDebug, clearDebug,
    clearSearch, applySearchHistory, toggleAdvancedSearch, applyAdvancedSearch,
    resetAdvancedSearch, saveCurrentSearchPreset, applySearchPreset,
    removeCurrentSearchPreset, applyInsightBrand, applySmartSearch,
    clearAllSearchFilters, updateTableDensity, resetTableDensity, applyImportDateSelection,
    toggleImportSheetSelection, selectAllImportSheets, clearImportSheetSelection,
    addManualEntryRows, resetManualEntryTable, updateManualEntryField,
    removeManualEntryRow, saveManualEntries,
    startListDraftRecord, updateListDraftField, cancelListDraftRecord, saveListDraftRecord,
    applyQuickAppointmentDate, clearQuickAppointmentDate,
    checkForUpdatesManual
});

// Initialize
document.addEventListener('DOMContentLoaded', init);
