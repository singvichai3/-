(function (global) {
  const EMPTY_ADVANCED_SEARCH = {
    plate: '',
    ownerName: '',
    phone: '',
    brand: '',
    province: '',
    importedFrom: '',
    importedTo: '',
    receivedFrom: '',
    receivedTo: ''
  };

  const moduleApi = {
    createEmptyAdvancedSearch() {
      return { ...EMPTY_ADVANCED_SEARCH };
    },

    updateQuickAppointmentDateInput({ State }) {
      const quickDateInput = document.getElementById('quick-appointment-date');
      if (!quickDateInput) return;

      const { importedFrom, importedTo } = State.advancedSearch;
      quickDateInput.value = importedFrom && importedFrom === importedTo ? importedFrom : '';
    },

    loadSearchHistory({ State }) {
      try {
        const raw = localStorage.getItem('search-history');
        State.searchHistory = raw ? JSON.parse(raw) : [];
      } catch {
        State.searchHistory = [];
      }
    },

    saveSearchHistory({ State }) {
      try {
        localStorage.setItem('search-history', JSON.stringify(State.searchHistory.slice(0, 8)));
      } catch {
        // Ignore storage failures
      }
    },

    addRecentSearch({ State, saveSearchHistory, renderSearchHistory }, query) {
      const trimmed = String(query || '').trim();
      if (!trimmed) return;

      State.searchHistory = [trimmed, ...State.searchHistory.filter(item => item !== trimmed)].slice(0, 8);
      saveSearchHistory();
      renderSearchHistory();
    },

    toggleAdvancedSearch({ syncAdvancedSearchForm }, force) {
      const panel = document.getElementById('advanced-search-panel');
      if (!panel) return;
      const shouldOpen = typeof force === 'boolean' ? force : !panel.classList.contains('visible');
      panel.classList.toggle('visible', shouldOpen);
      if (shouldOpen) syncAdvancedSearchForm();
    },

    applyAdvancedSearch({ State, updateQuickAppointmentDateInput, updateAdvancedSearchSummary, toggleAdvancedSearch, loadData }) {
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
    },

    resetAdvancedSearch({ State, syncAdvancedSearchForm, loadData }) {
      State.advancedSearch = moduleApi.createEmptyAdvancedSearch();
      syncAdvancedSearchForm();
      State.currentPage = 1;
      loadData();
    }
  };

  global.RendererSearchStateModule = moduleApi;
})(window);
