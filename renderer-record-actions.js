(function (global) {
  const moduleApi = {
    getNextSequenceId({ State }) {
      return ++State.sequenceId;
    },

    trackRequest({ State }, seqId, rollbackFn) {
      State.pendingRequests.set(seqId, { rollback: rollbackFn, timestamp: Date.now() });
      return seqId;
    },

    completeRequest({ State }, seqId) {
      State.pendingRequests.delete(seqId);
    },

    isStaleRequest({ State }, seqId) {
      return seqId < State.sequenceId;
    },

    pushRollback({ State }, id, previousState) {
      State.rollbackStack.set(id, { ...previousState, timestamp: Date.now() });

      const fiveMinAgo = Date.now() - 5 * 60 * 1000;
      for (const [key, value] of State.rollbackStack.entries()) {
        if (value.timestamp < fiveMinAgo) {
          State.rollbackStack.delete(key);
        }
      }
    },

    executeRollback({ State }, id) {
      const rollback = State.rollbackStack.get(id);
      if (!rollback) return false;

      const record = State.records.find(r => r.id === id);
      if (!record) return false;

      Object.keys(rollback).forEach(key => {
        if (key !== 'timestamp' && Object.prototype.hasOwnProperty.call(record, key)) {
          record[key] = rollback[key];
        }
      });

      State.rollbackStack.delete(id);
      return true;
    },

    async updateField(ctx, id, field, value) {
      const { State, getNextSequenceId, pushRollback, renderVisibleRows, trackRequest, api, isStaleRequest, executeRollback, showNotification, loadData, completeRequest } = ctx;
      const seqId = getNextSequenceId();
      const record = State.records.find(r => r.id === id);
      if (!record) return;

      const oldValue = record[field];
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

        if (executeRollback(id)) {
          showNotification('❌ อัปเดตไม่สำเร็จ: ' + error.message + ' (กู้คืนแล้ว)', 'error');
          renderVisibleRows();
        } else {
          showNotification('❌ อัปเดตไม่สำเร็จ: ' + error.message, 'error');
          loadData();
        }
      } finally {
        completeRequest(seqId);
      }
    },

    async transitionStatus(ctx, id, targetStatus, apiMethodName, successMessage, actionType) {
      const { State, getNextSequenceId, pushRollback, renderVisibleRows, trackRequest, api, isStaleRequest, showUndoToast, updateStats, executeRollback, showNotification, loadData, completeRequest } = ctx;
      const seqId = getNextSequenceId();
      const record = State.records.find(r => r.id === id);
      if (!record) return;

      const previous = {
        status: record.status,
        receivedAt: record.receivedAt,
        completedAt: record.completedAt,
        returnedAt: record.returnedAt
      };
      const now = new Date().toISOString();
      record.status = targetStatus;
      if (targetStatus === 'pending') {
        record.receivedAt = null;
        record.completedAt = null;
        record.returnedAt = null;
      } else if (targetStatus === 'received') {
        record.receivedAt = record.receivedAt || now;
        record.completedAt = null;
        record.returnedAt = null;
      } else if (targetStatus === 'completed') {
        record.receivedAt = record.receivedAt || now;
        record.completedAt = record.completedAt || now;
        record.returnedAt = null;
      } else if (targetStatus === 'returned') {
        record.receivedAt = record.receivedAt || now;
        record.completedAt = record.completedAt || now;
        record.returnedAt = record.returnedAt || now;
      }
      pushRollback(id, previous);
      renderVisibleRows();

      try {
        trackRequest(seqId);
        await api[apiMethodName]([id], seqId);

        if (isStaleRequest(seqId)) {
          console.log(`⏭️ Stale ${apiMethodName} request detected, discarding response`);
          return;
        }

        State.lastAction = { type: actionType, id, previous };
        showUndoToast(successMessage);
        updateStats();
      } catch (error) {
        console.error(`❌ ${apiMethodName} failed, rolling back:`, error);

        if (executeRollback(id)) {
          showNotification('❌ เปลี่ยนสถานะไม่สำเร็จ: ' + error.message + ' (กู้คืนแล้ว)', 'error');
          renderVisibleRows();
        } else {
          showNotification('❌ เปลี่ยนสถานะไม่สำเร็จ: ' + error.message, 'error');
          loadData();
        }
      } finally {
        completeRequest(seqId);
      }
    },

    async markReceived(ctx, id) {
      return moduleApi.transitionStatus(ctx, id, 'received', 'markReceived', '✅ รับเล่มแล้ว', 'markReceived');
    },

    async undoReceived(ctx, id) {
      return moduleApi.transitionStatus(ctx, id, 'pending', 'undoReceived', '🔄 ย้อนกลับเป็นยังไม่รับแล้ว', 'undoReceived');
    },

    async markCompleted(ctx, id) {
      return moduleApi.transitionStatus(ctx, id, 'completed', 'markCompleted', '✅ ดำเนินการเสร็จแล้ว', 'markCompleted');
    },

    async markReturned(ctx, id) {
      return moduleApi.transitionStatus(ctx, id, 'returned', 'markReturned', '✅ คืนเล่มแล้ว', 'markReturned');
    },

    async deleteRecord(ctx, id) {
      const { State, api, getNextSequenceId, pushRollback, renderTable, updatePagination, trackRequest, isStaleRequest, clearSelection, reloadCurrentListPage, recoverSearchInteraction, showUndoToast, updateStats, executeRollback, showNotification, loadData, completeRequest } = ctx;
      const { confirmed } = await api.confirmDialog({
        title: 'ยืนยันลบรายการ',
        message: 'ยืนยันลบรายการนี้?',
        buttons: ['ลบ', 'ยกเลิก'],
        defaultId: 1,
        cancelId: 1
      });
      if (!confirmed) return;
      const seqId = getNextSequenceId();

      const index = State.records.findIndex(r => r.id === id);
      if (index === -1) return;

      const removed = State.records[index];
      pushRollback(id, { ...removed, _deleted: true });

      State.records.splice(index, 1);
      State.totalCount = Math.max(0, State.totalCount - 1);
      renderTable();
      updatePagination();

      try {
        trackRequest(seqId);
        await api.deleteRecords([id], seqId);

        if (isStaleRequest(seqId)) {
          console.log('⏭️ Stale delete-record request, skipping reload');
          clearSelection();
          recoverSearchInteraction();
          return;
        }

        State.rollbackStack.delete(id);
        clearSelection();
        await reloadCurrentListPage();
        recoverSearchInteraction();
        showUndoToast('🗑️ ลบแล้ว');
        updateStats();
      } catch (error) {
        console.error('❌ deleteRecord failed, rolling back:', error);

        if (executeRollback(id)) {
          const rollback = State.rollbackStack.get(id) || { ...removed };
          if (rollback._deleted) {
            delete rollback._deleted;
            State.records.splice(index, 0, rollback);
            State.totalCount++;
          }
          State.rollbackStack.delete(id);
          recoverSearchInteraction();
          showNotification('❌ ลบไม่สำเร็จ: ' + error.message + ' (กู้คืนแล้ว)', 'error');
          renderTable();
          updatePagination();
        } else {
          recoverSearchInteraction();
          showNotification('❌ ลบไม่สำเร็จ: ' + error.message, 'error');
          loadData();
        }
      } finally {
        completeRequest(seqId);
      }
    },

    async deleteSelected(ctx) {
      const { State, getNextSequenceId, showNotification, api, renderTable, updatePagination, trackRequest, isStaleRequest, clearSelection, reloadCurrentListPage, recoverSearchInteraction, updateStats, completeRequest } = ctx;
      const seqId = getNextSequenceId();
      if (State.selectedIds.size === 0) {
        showNotification('⚠️ กรุณาเลือกรายการที่จะลบ', 'warning');
        return;
      }

      const { confirmed: deleteConfirmed } = await api.confirmDialog({
        title: 'ยืนยันลบรายการ',
        message: `ยืนยันลบ ${State.selectedIds.size} รายการ?`,
        buttons: ['ลบ', 'ยกเลิก'],
        defaultId: 1,
        cancelId: 1
      });
      if (!deleteConfirmed) return;

      const ids = Array.from(State.selectedIds);
      const deletedCount = ids.length;
      const oldRecords = [...State.records];
      const oldCount = State.totalCount;

      State.records = State.records.filter(r => !State.selectedIds.has(r.id));
      State.totalCount = Math.max(0, oldCount - deletedCount);
      renderTable();
      updatePagination();

      try {
        trackRequest(seqId);
        await api.deleteRecords(ids, seqId);

        if (isStaleRequest(seqId)) {
          console.log('⏭️ Stale delete-selected request, skipping reload');
          clearSelection();
          recoverSearchInteraction();
          return;
        }

        clearSelection();
        await reloadCurrentListPage();
        recoverSearchInteraction();
        showNotification(`🗑️ ลบ ${ids.length} รายการสำเร็จ`, 'success');
        updateStats();
      } catch (error) {
        console.error('❌ deleteSelected failed, rolling back:', error);
        State.records = oldRecords;
        State.totalCount = oldCount;
        recoverSearchInteraction();
        showNotification('❌ ลบไม่สำเร็จ: ' + error.message + ' (กู้คืนแล้ว)', 'error');
        renderTable();
        updatePagination();
      } finally {
        completeRequest(seqId);
      }
    },

    async reloadCurrentListPage({ State, loadData }) {
      const maxPage = Math.max(1, Math.ceil(State.totalCount / State.pageSize));
      if (State.currentPage > maxPage) {
        State.currentPage = maxPage;
      }

      if (State.currentView === 'list') {
        await loadData({ includeInsights: true, includeTotal: true });
      }
    },

    handleRowClick({ toggleSelect }, event, id) {
      if (event.ctrlKey || event.metaKey) toggleSelect(id);
    },

    updateBulkBar({ State }) {
      const bulkBar = document.getElementById('bulk-bar');
      const countEl = document.getElementById('selected-count');
      if (State.selectedIds.size > 0) {
        bulkBar?.classList.add('visible');
        if (countEl) countEl.textContent = State.selectedIds.size;
      } else {
        bulkBar?.classList.remove('visible');
      }
    },

    toggleSelect({ State, updateBulkBar, renderVisibleRows }, id) {
      if (State.selectedIds.has(id)) State.selectedIds.delete(id);
      else State.selectedIds.add(id);
      updateBulkBar();
      renderVisibleRows();
    },

    toggleSelectAll({ State, updateBulkBar, renderVisibleRows }) {
      const selectAllCheckbox = document.getElementById('select-all');
      const { startIndex, endIndex } = State.virtualScroll;
      const visibleRecords = State.records.slice(startIndex, endIndex);
      if (selectAllCheckbox?.checked) visibleRecords.forEach(r => State.selectedIds.add(r.id));
      else visibleRecords.forEach(r => State.selectedIds.delete(r.id));
      updateBulkBar();
      renderVisibleRows();
    },

    clearSelection({ State, updateBulkBar, renderVisibleRows }) {
      State.selectedIds.clear();
      updateBulkBar();
      renderVisibleRows();
      const selectAllCheckbox = document.getElementById('select-all');
      if (selectAllCheckbox) selectAllCheckbox.checked = false;
    },

    async bulkSave({ State, showLoading, api, showNotification, clearSelection, renderVisibleRows, hideLoading }) {
      const brand = document.getElementById('bulk-brand')?.value;
      if (!brand || State.selectedIds.size === 0) return;

      showLoading();
      try {
        const ids = Array.from(State.selectedIds);
        await api.bulkUpdateField({ ids, field: 'brand', value: brand });

        State.records = State.records.map(record => (
          ids.includes(record.id) ? { ...record, brand } : record
        ));

        showNotification(`✅ อัปเดต ${State.selectedIds.size} รายการ`, 'success');
        clearSelection();
        renderVisibleRows();
      } catch (error) {
        showNotification('❌ ไม่สำเร็จ', 'error');
      } finally {
        hideLoading();
      }
    }
  };

  global.RendererRecordActionsModule = moduleApi;
})(window);
