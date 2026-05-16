(function (global) {
  const DEFAULT_LOAD_OPTIONS = { includeInsights: true, includeTotal: true };
  const STUCK_LOADING_THRESHOLD_MS = 35000;

  const moduleApi = {
    createDefaultLoadOptions() {
      return { ...DEFAULT_LOAD_OPTIONS };
    },

    normalizeLoadOptions(_ctx, options = {}) {
      return {
        includeInsights: options.includeInsights !== false,
        includeTotal: options.includeTotal !== false
      };
    },

    setupRefreshListener({ State, api, loadData, updateStats }) {
      if (typeof api?.onRefreshRequired !== 'function') return;

      api.onRefreshRequired(() => {
        if (State.currentView === 'list') {
          if (!State.isLoading) {
            loadData(moduleApi.createDefaultLoadOptions());
          } else {
            State.pendingLoadOptions = moduleApi.createDefaultLoadOptions();
          }
        }

        if (!State.isLoading) {
          updateStats();
        }
      });
    },

    async loadData(ctx, options = {}) {
      const {
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
      } = ctx;

      State.pendingLoadOptions = normalizeLoadOptions(options);
      State.searchRequestSeq += 1;

      if (State.isLoading) {
        if (Date.now() - State.loadingStartedAt > STUCK_LOADING_THRESHOLD_MS) {
          console.warn('⚠️ isLoading stuck > 35s, force-resetting');
          State.isLoading = false;
        } else {
          State.pendingLoadOptions = normalizeLoadOptions(options);
          return;
        }
      }

      State.isLoading = true;
      State.loadingStartedAt = Date.now();

      try {
        if (!api || (!api.loadRecordsBundle && !api.loadRecords)) {
          console.warn('⚠️ api.loadRecords not available');
          return;
        }

        while (State.pendingLoadOptions) {
          const currentOptions = State.pendingLoadOptions;
          const requestSeq = State.searchRequestSeq;
          State.pendingLoadOptions = null;
          updateSearchMeta(State.searchQuery ? `กำลังค้นหา "${State.searchQuery}"...` : 'กำลังโหลดรายการ...');

          try {
            const params = {
              ...getSearchParams(),
              includeInsights: currentOptions.includeInsights,
              includeTotal: currentOptions.includeTotal
            };

            let records = [];
            let count = 0;
            let insights = { totalMatched: 0, byType: {}, byStatus: {}, topBrands: [] };

            if (api.loadRecordsBundle) {
              const bundle = await api.loadRecordsBundle(params);
              records = bundle?.records || [];
              count = typeof bundle?.total === 'number' ? bundle.total : State.totalCount;
              insights = bundle?.insights || insights;
            } else {
              [records, count, insights] = await Promise.all([
                api.loadRecords(params),
                currentOptions.includeTotal ? api.getRecordsCount(params) : Promise.resolve(State.totalCount),
                currentOptions.includeInsights && api.getSearchInsights
                  ? api.getSearchInsights(params)
                  : Promise.resolve(insights)
              ]);
            }

            if (requestSeq !== State.searchRequestSeq) {
              continue;
            }

            State.records = records || [];
            if (currentOptions.includeTotal) {
              State.totalCount = count || 0;
            }
            if (currentOptions.includeInsights) {
              State.searchInsights = insights || { totalMatched: 0, byType: {}, byStatus: {}, topBrands: [] };
            }
            State.errorCount = 0;

            if (State.searchQuery) {
              addRecentSearch(State.searchQuery);
            }

            if (State.virtualScroll.visibleCount <= 0 && State.virtualScroll.container) {
              const ch = State.virtualScroll.container.clientHeight || 600;
              State.virtualScroll.visibleCount = Math.ceil(ch / State.virtualScroll.rowHeight) + 5;
            }
            State.virtualScroll.startIndex = 0;
            State.virtualScroll.endIndex = Math.min(
              State.virtualScroll.visibleCount || State.records.length,
              State.records.length
            );

            if (State.virtualScroll.container) {
              State.virtualScroll.container.scrollTop = 0;
            }

            if (!currentOptions.includeTotal && State.searchQuery) {
              updateSearchMeta(`กำลังกรองรายการสำหรับ "${State.searchQuery}"...`);
            } else if (State.searchQuery) {
              updateSearchMeta(`พบ ${State.totalCount.toLocaleString()} รายการ สำหรับ "${State.searchQuery}"`);
            } else if (getActiveAdvancedSearchCount() > 0) {
              updateSearchMeta(`พบ ${State.totalCount.toLocaleString()} รายการ จากตัวกรองขั้นสูง`);
            } else {
              updateSearchMeta(`ทั้งหมด ${State.totalCount.toLocaleString()} รายการ`);
            }

            renderTable();
            updatePagination();
            updateSearchClearButton();
            if (currentOptions.includeInsights) {
              renderSearchInsights();
            }
          } catch (error) {
            if (requestSeq !== State.searchRequestSeq) {
              continue;
            }

            console.error('❌ Load data error:', error);
            updateSearchMeta('ค้นหาไม่สำเร็จ');
            State.errorCount += 1;
            if (State.errorCount < State.maxErrors) {
              showNotification('ไม่สามารถโหลดข้อมูลได้: ' + error.message, 'error');
              setTimeout(() => loadData(currentOptions), 1000);
            } else {
              showNotification(
                '⚠️ โหลดข้อมูลไม่ได้ซ้ำหลายครั้ง — กด Ctrl+R หรือปิดแล้วเปิดใหม่',
                'error',
                8000
              );
              updateSearchMeta('โหลดข้อมูลไม่สำเร็จ — กด Ctrl+R เพื่อรีโหลด');
            }
          }
        }
      } finally {
        State.isLoading = false;
        if (State.pendingLoadOptions) {
          const queuedOptions = State.pendingLoadOptions;
          State.pendingLoadOptions = null;
          setTimeout(() => {
            if (!State.isLoading) {
              loadData(queuedOptions);
            }
          }, 0);
        }
      }
    }
  };

  global.RendererSearchLoadCoordinationModule = moduleApi;
})(window);
