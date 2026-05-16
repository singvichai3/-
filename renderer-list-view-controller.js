(function (global) {
  const moduleApi = {
    switchView(ctx, viewId, options = {}) {
      const {
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
        showNotification,
        documentRef = document,
        schedule = typeof setTimeout === 'function' ? setTimeout : ((fn) => fn())
      } = ctx;

      try {
        console.log('🔄 switchView called:', viewId);
        State.currentView = viewId;
        documentRef.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        documentRef.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

        const viewEl = documentRef.getElementById(`view-${viewId}`);
        const navEl = documentRef.querySelector(`[data-view="${viewId}"]`);

        if (viewEl) viewEl.classList.add('active');
        if (navEl) navEl.classList.add('active');

        if (viewId === 'list') {
          console.log('📋 Loading data for list view...');
          if (!options.keepLoadingOverlay) {
            hideLoading();
          }
          if (!options.preserveLoadingState) {
            State.isLoading = false;
          }
          schedule(() => {
            setupVirtualScroll();
          }, 50);
          if (!options.skipListRefresh) {
            loadData();
            updateStats();
          }
        } else if (viewId === 'table') {
          renderManualEntryTable();
          syncTableMetaInputs();
          syncBulkEditInput();
          syncPrintLayoutControls();
        } else if (viewId === 'dashboard') {
          loadDashboard();
          updateStats();
        } else if (viewId === 'network') {
          if (typeof renderNetworkMonitor === 'function') renderNetworkMonitor();
        }
      } catch (error) {
        console.error('❌ switchView error:', error);
        showNotification('ไม่สามารถสลับหน้าได้', 'error');
      }
    },

    setFilter({ State, loadData, showNotification, documentRef = document }, filter) {
      try {
        State.currentFilter = filter;
        State.currentPage = 1;
        documentRef.querySelectorAll('.filter-tab').forEach(tab => {
          tab.classList.toggle('active', tab.dataset.filter === filter);
        });
        loadData();
      } catch (error) {
        showNotification('ไม่สามารถกรองข้อมูลได้', 'error');
      }
    }
  };

  global.RendererListViewControllerModule = moduleApi;
})(window);
