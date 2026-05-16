(function (global) {
  const moduleApi = {
    renderSearchPresets({ State, escapeHTML }) {
      const select = document.getElementById('search-preset-select');
      if (!select) return;

      const presets = Array.isArray(State.settings.savedSearches) ? State.settings.savedSearches : [];
      const options = ['<option value="">Preset ค้นหา</option>'];
      presets.forEach((preset, index) => {
        options.push(`<option value="${index}">${escapeHTML(preset.name || `Preset ${index + 1}`)}</option>`);
      });
      select.innerHTML = options.join('');
      select.value = State.searchUi.selectedPresetIndex;
    },

    async saveCurrentSearchPreset({ State, api, openTextPrompt, renderSearchPresets, showNotification }) {
      const name = await openTextPrompt({
        title: 'บันทึก preset ค้นหา',
        message: 'ตั้งชื่อ preset สำหรับใช้ค้นหาซ้ำ',
        placeholder: 'เช่น ค้างรับวันนี้',
        defaultValue: State.searchQuery || 'ค้นหาด่วน',
        confirmText: 'บันทึก',
        cancelText: 'ยกเลิก'
      });
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
    },

    applySearchPreset({ State, syncAdvancedSearchForm, loadData, updateSearchClearButton, showNotification }, index) {
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
    },

    async removeCurrentSearchPreset({ State, api, renderSearchPresets, showNotification }) {
      if (State.searchUi.selectedPresetIndex === '') {
        showNotification('⚠️ เลือก preset ที่ต้องการลบก่อน', 'warning');
        return;
      }

      const presets = Array.isArray(State.settings.savedSearches) ? State.settings.savedSearches : [];
      const index = Number(State.searchUi.selectedPresetIndex);
      const preset = presets[index];
      if (!preset) return;
      const { confirmed: presetConfirmed } = await api.confirmDialog({
        title: 'ลบ preset',
        message: `ลบ preset \"${preset.name}\" ?`,
        buttons: ['ลบ', 'ยกเลิก'],
        defaultId: 1,
        cancelId: 1
      });
      if (!presetConfirmed) return;

      const updated = presets.filter((_, presetIndex) => presetIndex !== index);
      await api.saveSettings({ savedSearches: updated });
      State.settings.savedSearches = updated;
      State.searchUi.selectedPresetIndex = '';
      renderSearchPresets();
      showNotification('🗑️ ลบ preset แล้ว', 'success');
    },

    closeTextPrompt(_ctx, result = null) {
      const modal = document.getElementById('text-prompt-modal');
      if (!modal || typeof modal._resolver !== 'function') return;

      const resolver = modal._resolver;
      modal._resolver = null;
      modal.classList.remove('show');

      const titleEl = document.getElementById('text-prompt-title');
      const messageEl = document.getElementById('text-prompt-message');
      const inputEl = document.getElementById('text-prompt-input');
      const confirmBtn = document.getElementById('text-prompt-confirm');
      const cancelBtn = document.getElementById('text-prompt-cancel');

      if (titleEl) titleEl.textContent = 'กรอกข้อความ';
      if (messageEl) messageEl.textContent = '';
      if (inputEl) {
        inputEl.value = '';
        inputEl.placeholder = '';
        delete inputEl.dataset.emptyError;
      }
      if (confirmBtn) confirmBtn.textContent = 'ตกลง';
      if (cancelBtn) cancelBtn.textContent = 'ยกเลิก';

      resolver(result);
    },

    openTextPrompt({ closeTextPrompt }, options = {}) {
      const modal = document.getElementById('text-prompt-modal');
      const titleEl = document.getElementById('text-prompt-title');
      const messageEl = document.getElementById('text-prompt-message');
      const inputEl = document.getElementById('text-prompt-input');
      const confirmBtn = document.getElementById('text-prompt-confirm');
      const cancelBtn = document.getElementById('text-prompt-cancel');

      if (!modal || !inputEl || !confirmBtn || !cancelBtn) {
        return Promise.resolve(options.defaultValue || '');
      }

      if (typeof modal._resolver === 'function') {
        closeTextPrompt(null);
      }

      if (titleEl) titleEl.textContent = options.title || 'กรอกข้อความ';
      if (messageEl) messageEl.textContent = options.message || '';
      inputEl.value = options.defaultValue || '';
      inputEl.placeholder = options.placeholder || '';
      inputEl.dataset.emptyError = options.emptyError || 'กรุณากรอกข้อมูล';
      confirmBtn.textContent = options.confirmText || 'ตกลง';
      cancelBtn.textContent = options.cancelText || 'ยกเลิก';
      modal.classList.add('show');

      return new Promise((resolve) => {
        modal._resolver = resolve;
        requestAnimationFrame(() => {
          inputEl.focus();
          inputEl.select();
        });
      });
    },

    submitTextPrompt({ closeTextPrompt, showNotification }) {
      const inputEl = document.getElementById('text-prompt-input');
      if (!inputEl) {
        closeTextPrompt(null);
        return;
      }

      const value = String(inputEl.value || '');
      if (!value.trim()) {
        showNotification(inputEl.dataset.emptyError || 'กรุณากรอกข้อมูล', 'warning');
        inputEl.focus();
        return;
      }

      closeTextPrompt(value);
    },

    handleTextPromptKeydown({ submitTextPrompt, closeTextPrompt }, event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        submitTextPrompt();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        closeTextPrompt(null);
      }
    }
  };

  global.RendererSearchPresetModule = moduleApi;
})(window);
