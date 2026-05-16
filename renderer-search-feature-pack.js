(function (global) {
  const presetModule = global.RendererSearchPresetModule;

  const moduleApi = {
    saveCurrentSearchPreset(ctx) {
      return presetModule.saveCurrentSearchPreset(ctx);
    },

    applySearchPreset(ctx, index) {
      return presetModule.applySearchPreset(ctx, index);
    },

    removeCurrentSearchPreset(ctx) {
      return presetModule.removeCurrentSearchPreset(ctx);
    },

    applyInsightBrand({ State, syncAdvancedSearchForm, loadData }, brand) {
      const nextBrand = String(brand || '').trim();
      State.advancedSearch.brand = nextBrand;
      syncAdvancedSearchForm();
      State.currentPage = 1;
      loadData();
    },

    applySmartSearch({ State, syncAdvancedSearchForm, loadData, documentRef }, mode, todayOverride = null) {
      const doc = documentRef || (typeof document !== 'undefined' ? document : { querySelectorAll: () => [] });
      const today = todayOverride || new Date().toISOString().split('T')[0];
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

      doc.querySelectorAll('.filter-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.filter === State.currentFilter);
      });

      syncAdvancedSearchForm();
      State.currentPage = 1;
      loadData();
    },

    applySearchHistory({ State, updateSearchClearButton, updateSearchMeta, toggleSearchHistory, loadData, documentRef }, query) {
      const doc = documentRef || (typeof document !== 'undefined' ? document : { getElementById: () => null });
      const searchInput = doc.getElementById('search-input');
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
  };

  global.RendererSearchFeaturePackModule = moduleApi;
})(window);
