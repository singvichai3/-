(function (global) {
  const moduleApi = {
    rebuildImportData({ State, parseExcelData }, options = {}) {
      if (!Array.isArray(State.importRawData) || State.importRawData.length === 0) {
        State.importData = [];
        return;
      }

      State.importData = parseExcelData(State.importRawData, {
        selectedDate: options.selectedDate || State.selectedImportDate,
        useSelectedDate: options.useSelectedDate ?? State.importDateOverride,
        importProfile: options.importProfile || State.importProfile
      });
    },

    renderImportSheetSelection({ State, escapeHTML }, sheetBulkTools, sheetSelectionList, sheetSelectionNote) {
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
    },

    showPreview(ctx) {
      const {
        State,
        IMPORT_PREVIEW_ROW_LIMIT,
        IMPORT_PROFILES,
        escapeHTML,
        formatDate,
        renderImportSheetSelection
      } = ctx;

      try {
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
        const importProfileTabs = document.getElementById('import-profile-tabs');
        const importProfileHint = document.getElementById('import-profile-hint');

        fileZone?.classList.add('hidden');
        previewSection?.classList.add('visible');
        if (importProfileTabs) {
          importProfileTabs.querySelectorAll('[data-import-profile]').forEach(button => {
            button.classList.toggle('active', button.dataset.importProfile === State.importProfile);
          });
        }
        if (importProfileHint) {
          importProfileHint.textContent = IMPORT_PROFILES[State.importProfile]?.description || '';
        }
        if (State.sheetCount > 1 && sheetSelector && sheetDropdown) {
          sheetSelector.style.display = 'block';
          sheetDropdown.innerHTML = State.sheetNames.map((name, idx) =>
            `<option value="${idx}" ${idx === State.currentSheetIndex ? 'selected' : ''}>${escapeHTML(name || `Sheet ${idx + 1}`)}</option>`
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
      } catch (e) {
        console.error('Preview error:', e);
      }
    },

    updateStep(_ctx, step) {
      for (let i = 1; i <= 3; i++) {
        const stepEl = document.getElementById(`step-${i}`);
        if (!stepEl) continue;
        stepEl.classList.remove('active', 'complete');
        if (i < step) stepEl.classList.add('complete');
        else if (i === step) stepEl.classList.add('active');
      }
    },

    resetImportProgress() {
      const progressBar = document.getElementById('progress-fill');
      const progressContainer = document.getElementById('import-progress-bar');
      if (progressContainer) progressContainer.style.display = 'block';
      if (progressBar) progressBar.style.width = '0%';
    },

    hideImportProgress() {
      const progressContainer = document.getElementById('import-progress-bar');
      if (progressContainer) progressContainer.style.display = 'none';
    },

    updateImportProgress(_ctx, payload) {
      try {
        const progressBar = document.getElementById('progress-fill');
        const progressText = document.getElementById('import-progress-text');
        const progressContainer = document.getElementById('import-progress-bar');

        if (progressContainer) progressContainer.style.display = 'block';
        if (progressBar) progressBar.style.width = `${payload.progress}%`;
        if (progressText) progressText.textContent = payload.message || `นำเข้า ${payload.imported.toLocaleString()} / ${payload.total.toLocaleString()} รายการ`;
      } catch (e) {
        // Silent fail for progress
      }
    },

    persistPostImportReset(_ctx, payload) {
      try {
        sessionStorage.setItem('post-import-reset', JSON.stringify({
          imported: Number(payload?.imported || 0),
          skipped: Number(payload?.skipped || 0),
          at: Date.now()
        }));
      } catch (error) {
        console.warn('persistPostImportReset error:', error);
      }
    },

    consumePostImportReset() {
      try {
        const raw = sessionStorage.getItem('post-import-reset');
        if (!raw) return null;
        sessionStorage.removeItem('post-import-reset');
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        return parsed;
      } catch (error) {
        console.warn('consumePostImportReset error:', error);
        return null;
      }
    },

    restoreInteractiveStateAfterImport({ State, recoverSearchInteraction }) {
      const overlay = document.getElementById('loading-overlay');
      if (overlay) overlay.classList.remove('show');
      document.body.style.pointerEvents = 'auto';
      document.body.style.userSelect = 'auto';

      const active = document.activeElement;
      if (active && typeof active.blur === 'function') {
        active.blur();
      }

      recoverSearchInteraction({ selectText: false });
    },

    cancelImport({ State, hideImportProgress, updateStep }) {
      State.importData = [];
      State.importRawData = [];
      State.importFilePath = null;
      State.selectedImportDate = '';
      State.importDateOverride = false;
      State.selectedImportSheets = [];
      State.sheetNames = [];
      State.currentSheetIndex = 0;
      State.fileBuffer = null;
      State.sheetCount = 0;
      document.getElementById('file-zone')?.classList.remove('hidden');
      document.getElementById('preview-section')?.classList.remove('visible');
      hideImportProgress();
      updateStep(1);
    },

    setSelectedImportSheets({ State, renderImportSheetSelection, showPreview }, indexes) {
      const validIndexes = Array.from(new Set((indexes || [])
        .map(index => Number(index))
        .filter(index => Number.isInteger(index) && index >= 0 && index < State.sheetCount)))
        .sort((a, b) => a - b);

      State.selectedImportSheets = validIndexes;
      renderImportSheetSelection();
      showPreview();
    },

    toggleImportSheetSelection({ State, setSelectedImportSheets }, index, checked) {
      const next = new Set(State.selectedImportSheets);
      if (checked) next.add(index);
      else next.delete(index);
      setSelectedImportSheets(Array.from(next));
    },

    selectAllImportSheets({ State, setSelectedImportSheets }) {
      setSelectedImportSheets(State.sheetNames.map((_, index) => index));
    },

    clearImportSheetSelection({ setSelectedImportSheets }) {
      setSelectedImportSheets([]);
    },

    applyImportProfile({ State, IMPORT_PROFILES, rebuildImportData, showPreview }, profileId) {
      const nextProfile = Object.prototype.hasOwnProperty.call(IMPORT_PROFILES, profileId) ? profileId : 'standard';
      if (State.importProfile === nextProfile) return;

      State.importProfile = nextProfile;
      rebuildImportData({ importProfile: nextProfile });
      showPreview();
    },

    applyImportDateSelection({ State, rebuildImportData, showPreview }, value) {
      const nextDate = String(value || '').trim();
      if (!nextDate) return;
      State.selectedImportDate = nextDate;
      State.importDateOverride = true;
      rebuildImportData({ selectedDate: nextDate, useSelectedDate: true });
      showPreview();
    },

    async switchSheet({ State, api, showLoading, hideLoading, rebuildImportData, showPreview, showNotification }) {
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
        rebuildImportData();
        showPreview();
      } catch (error) {
        showNotification('❌ ไม่สามารถเปลี่ยน Sheet: ' + error.message, 'error');
        State.currentSheetIndex = previousIndex;
      } finally {
        hideLoading();
      }
    },

    async selectFile({ State, api, rebuildImportData, showPreview, updateStep, showLoading, hideLoading, showNotification }) {
      try {
        const filePath = await api.openExcelDialog();
        if (!filePath) return;

        State.importFilePath = filePath;
        State.selectedImportDate = '';
        State.importDateOverride = false;
        showLoading('กำลังอ่านไฟล์...');

        const result = await api.parseExcel(filePath);
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
        console.error('❌ selectFile error:', error);
        console.error('❌ Error stack:', error.stack);
        showNotification('❌ อ่านไฟล์ไม่สำเร็จ: ' + error.message, 'error');
      } finally {
        hideLoading();
      }
    },

    async confirmImport({
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
    }) {
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
            parseExcelData(result.data || [], {
              importProfile: State.importProfile,
              selectedDate: State.selectedImportDate,
              useSelectedDate: State.importDateOverride
            })
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

      const carCount = recordsToImport.filter(r => r.type === 'รย').length;
      const motorCount = recordsToImport.filter(r => r.type === 'จยย').length;
      const previewPlates = recordsToImport.slice(0, IMPORT_CONFIRM_PLATE_LIMIT).map(r => r.plate).join(', ');
      const selectedSheetNames = selectedSheetIndexes
        .map(index => State.sheetNames[index])
        .filter(Boolean)
        .join(', ');

      const confirmMsg = `📊 สรุปข้อมูลที่จะนำเข้า:\n\n`
        + `${selectedSheetNames ? `📄 Sheet: ${selectedSheetNames}\n` : ''}`
        + `🚗 รถยนต์: ${carCount} คัน\n`
        + `🏍️ จักรยานยนต์: ${motorCount} คัน\n`
        + `📋 รวมทั้งหมด: ${recordsToImport.length} คัน\n\n`
        + `ทะเบียนรถ${recordsToImport.length > IMPORT_CONFIRM_PLATE_LIMIT ? ` (แสดง ${IMPORT_CONFIRM_PLATE_LIMIT} รายการแรก)` : ''}:\n${previewPlates}\n\n`
        + `คุณต้องการนำเข้าข้อมูลนี้หรือไม่?`;

      const confirmResult = api.confirmDialog
        ? await api.confirmDialog({
          title: 'ยืนยันการนำเข้าข้อมูล',
          message: 'ต้องการนำเข้าข้อมูลชุดนี้หรือไม่?',
          detail: confirmMsg,
          buttons: ['นำเข้า', 'ยกเลิก'],
          defaultId: 0,
          cancelId: 1,
          confirmedIndex: 0
        })
        : await api.confirmDialog({
          title: 'ยืนยันการนำเข้าข้อมูล',
          message: confirmMsg,
          buttons: ['นำเข้า', 'ยกเลิก'],
          defaultId: 0,
          cancelId: 1,
          confirmedIndex: 0
        });

      if (!confirmResult?.confirmed) {
        hideLoading();
        return;
      }

      showLoading('กำลังนำเข้าข้อมูล...');
      updateStep(3);
      resetImportProgress();

      try {
        const result = await api.saveRecords({ records: recordsToImport, batchSize: 1000 });

        const imported = result?.imported || 0;
        const skipped = result?.skipped || 0;

        hideImportProgress();
        showLoadingProgress('กำลังกระจายข้อมูลไปยังระบบค้นหา...', 72);

        const deleteCheckbox = document.getElementById('delete-original');
        if (deleteCheckbox?.checked && State.importFilePath) {
          await api.deleteFile(State.importFilePath);
        }

        cancelImport();
        State.isLoading = false;
        State.errorCount = 0;
        showLoadingProgress('กำลังรีเซ็ตหน้าจอเพื่อให้พร้อมใช้งาน...', 100);
        persistPostImportReset({ imported, skipped });
        setTimeout(() => location.reload(), 120);
        return;
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
  };

  global.RendererImportWorkflowModule = moduleApi;
})(window);
