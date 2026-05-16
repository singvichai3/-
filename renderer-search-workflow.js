(function (global) {
  const moduleApi = {
    normalizeLoadOptions(_ctx, options = {}) {
      return {
        includeInsights: options.includeInsights !== false,
        includeTotal: options.includeTotal !== false
      };
    },

    scheduleSearchInsightsRefresh({ State, api, getSearchParams, renderSearchInsights }, delay = 450) {
      if (State.insightsTimer) clearTimeout(State.insightsTimer);

      State.insightsTimer = setTimeout(async () => {
        const seq = ++State.insightsRequestSeq;
        const params = { ...getSearchParams(), includeInsights: true, includeTotal: true };

        try {
          let nextInsights = null;
          if (api.getSearchInsights) {
            nextInsights = await api.getSearchInsights(params);
          } else if (api.loadRecordsBundle) {
            nextInsights = (await api.loadRecordsBundle(params))?.insights;
          }

          if (seq !== State.insightsRequestSeq) return;
          State.searchInsights = nextInsights || { totalMatched: State.totalCount || 0, byType: {}, byStatus: {}, topBrands: [] };
          renderSearchInsights();
        } catch (error) {
          if (seq === State.insightsRequestSeq) {
            console.warn('Search insights refresh error:', error);
          }
        }
      }, delay);
    },

    setupSearchDebounce(ctx) {
      const { State, renderSearchHistory, updateSearchMeta, toggleSearchHistory, loadData, updateSearchClearButton, scheduleSearchInsightsRefresh } = ctx;
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
          if (State.insightsTimer) clearTimeout(State.insightsTimer);
          State.currentPage = 1;
          loadData({ includeInsights: true, includeTotal: true });
        }
        if (e.key === 'Escape') {
          toggleSearchHistory(false);
        }
      });

      searchInput.addEventListener('input', (e) => {
        State.searchQuery = e.target.value.trim();
        State.errorCount = 0;
        updateSearchClearButton();
        renderSearchHistory();
        updateSearchMeta(State.searchQuery ? 'กำลังพิมพ์คำค้น...' : 'พร้อมค้นหา');
        if (State.debounceTimer) clearTimeout(State.debounceTimer);
        if (State.insightsTimer) clearTimeout(State.insightsTimer);
        State.debounceTimer = setTimeout(() => {
          State.currentPage = 1;
          loadData({ includeInsights: false, includeTotal: false });
          scheduleSearchInsightsRefresh();
        }, 80);
      });
    },

    setupSearchUiEvents({ toggleSearchHistory, updateSearchClearButton, updateAdvancedSearchSummary, updateQuickAppointmentDateInput, renderSearchPresets, renderSearchInsights }) {
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
    },

    renderSearchHistory({ State, escapeHTML }) {
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
    },

    toggleSearchHistory({ State }, visible) {
      const panel = document.getElementById('search-history');
      if (!panel) return;

      State.searchUi.historyVisible = visible;
      panel.classList.toggle('visible', visible);
    },

    updateSearchClearButton({ State }) {
      const clearBtn = document.getElementById('search-clear');
      if (!clearBtn) return;
      clearBtn.classList.toggle('visible', Boolean(State.searchQuery));
    },

    updateSearchMeta({ State }, text) {
      const metaEl = document.getElementById('search-meta');
      if (!metaEl) return;

      State.searchUi.lastMeta = text || State.searchUi.lastMeta || 'พร้อมค้นหา';
      metaEl.textContent = State.searchUi.lastMeta;
    },

    getSearchParams({ State }) {
      return {
        query: State.searchQuery,
        type: ['รย', 'จยย'].includes(State.currentFilter) ? State.currentFilter : 'all',
        status: ['pending', 'received'].includes(State.currentFilter) ? State.currentFilter : 'all',
        page: State.currentPage,
        pageSize: State.pageSize,
        ...State.advancedSearch
      };
    },

    getActiveAdvancedSearchCount({ State }) {
      return Object.values(State.advancedSearch).filter(Boolean).length;
    },

    hasAnySearchFilters({ State, getActiveAdvancedSearchCount }) {
      return Boolean(
        State.searchQuery ||
        State.currentFilter !== 'all' ||
        getActiveAdvancedSearchCount() > 0
      );
    },

    updateAdvancedSearchSummary({ getActiveAdvancedSearchCount }) {
      const summary = document.getElementById('advanced-summary');
      const count = getActiveAdvancedSearchCount();
      if (summary) {
        summary.textContent = count > 0 ? `ตัวกรองขั้นสูง ${count} รายการ` : 'ยังไม่ใช้ตัวกรองขั้นสูง';
      }
    },

    renderSearchInsights({ State, escapeHTML, hasAnySearchFilters }) {
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
    },

    syncAdvancedSearchForm({ State, updateQuickAppointmentDateInput, updateAdvancedSearchSummary }) {
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
    },

    clearAllSearchFilters({ State, renderSearchHistory, renderSearchPresets, syncAdvancedSearchForm, updateSearchMeta, loadData, updateSearchClearButton }) {
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
    },

    applyQuickAppointmentDate({ State, updateQuickAppointmentDateInput, updateAdvancedSearchSummary, updateSearchMeta, loadData }, value) {
      const selectedDate = String(value || '').trim();

      State.advancedSearch.importedFrom = selectedDate;
      State.advancedSearch.importedTo = selectedDate;
      updateQuickAppointmentDateInput();
      updateAdvancedSearchSummary();
      updateSearchMeta(selectedDate ? `กรองวันนัด ${selectedDate}` : 'ล้างตัวกรองวันนัดแล้ว');
      State.currentPage = 1;
      loadData();
    },

    clearQuickAppointmentDate({ applyQuickAppointmentDate }) {
      applyQuickAppointmentDate('');
    },

    applyInsightBrand({ State, syncAdvancedSearchForm, loadData }, brand) {
      const nextBrand = String(brand || '').trim();
      State.advancedSearch.brand = nextBrand;
      syncAdvancedSearchForm();
      State.currentPage = 1;
      loadData();
    },

    applySmartSearch({ State, syncAdvancedSearchForm, loadData }, mode) {
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
    },

    applySearchHistory({ State, updateSearchClearButton, updateSearchMeta, toggleSearchHistory, loadData }, query) {
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
    },

    clearSearch({ State, updateSearchClearButton, renderSearchHistory, updateSearchMeta, loadData }) {
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
    },

    focusSearchInput({ renderSearchHistory, toggleSearchHistory }, selectText = false) {
      const searchInput = document.getElementById('search-input');
      if (!searchInput) return;
      searchInput.focus();
      if (selectText) searchInput.select();
      renderSearchHistory();
      toggleSearchHistory(true);
    },

    recoverSearchInteraction({ State, toggleSearchHistory }, options = {}) {
      const searchInput = document.getElementById('search-input');
      if (!searchInput) return;

      const shouldSelect = Boolean(options.selectText);
      State.pendingInteractionRecovery = true;
      toggleSearchHistory(false);

      const restore = () => {
        if (State.currentView !== 'list') return;
        window.focus();
        searchInput.removeAttribute('disabled');
        searchInput.readOnly = false;
        searchInput.style.pointerEvents = 'auto';
        searchInput.focus({ preventScroll: true });
        if (shouldSelect && typeof searchInput.select === 'function') {
          searchInput.select();
        }
        State.pendingInteractionRecovery = false;
      };

      requestAnimationFrame(() => {
        restore();
        setTimeout(restore, 90);
      });
    },

    setFilter({ State, loadData, showNotification }, filter) {
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
  };

  global.RendererSearchWorkflowModule = moduleApi;
})(window);
