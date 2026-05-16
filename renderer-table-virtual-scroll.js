(function (global) {
  const moduleApi = {
    setupVirtualScroll({ State, documentRef = document, handleScroll, renderTable, consoleRef = console }) {
      const tableWrapper = documentRef.querySelector('.table-wrapper');
      if (!tableWrapper) {
        consoleRef.warn('⚠️ .table-wrapper not found');
        return;
      }

      State.virtualScroll.container = tableWrapper;
      tableWrapper.removeEventListener('scroll', handleScroll);

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
      tableWrapper.addEventListener('scroll', handleScroll, { passive: true });

      if (State.records.length > 0) {
        State.virtualScroll.startIndex = 0;
        State.virtualScroll.endIndex = Math.min(State.virtualScroll.visibleCount, State.records.length);
        renderTable();
      }
    },

    handleScroll({ State, documentRef = document, requestAnimationFrameRef = requestAnimationFrame, renderVisibleRows }) {
      if (State.virtualScroll._scrolling) return;
      State.virtualScroll._scrolling = true;

      requestAnimationFrameRef(() => {
        const container = State.virtualScroll.container || documentRef.querySelector('.table-wrapper');
        if (!container) {
          State.virtualScroll._scrolling = false;
          return;
        }

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
    },

    renderTable({ State, documentRef = document, renderVisibleRows }) {
      const top = documentRef.getElementById('virtual-top');
      const bottom = documentRef.getElementById('virtual-bottom');

      if (!State.virtualScroll.container || State.records.length <= State.pageSize) {
        State.virtualScroll.startIndex = 0;
        State.virtualScroll.endIndex = State.records.length;
        if (top) top.style.height = '0px';
        if (bottom) bottom.style.height = '0px';
        renderVisibleRows();
        return;
      }

      if (State.virtualScroll.visibleCount <= 0) {
        const ch = State.virtualScroll.container.clientHeight || 600;
        State.virtualScroll.visibleCount = Math.ceil(ch / State.virtualScroll.rowHeight) + 5;
      }

      if (State.virtualScroll.endIndex <= State.virtualScroll.startIndex) {
        State.virtualScroll.endIndex = Math.min(State.virtualScroll.visibleCount, State.records.length);
      }

      if (top) top.style.height = `${State.virtualScroll.startIndex * State.virtualScroll.rowHeight}px`;
      if (bottom) bottom.style.height = `${Math.max(State.totalCount - State.virtualScroll.endIndex, 0) * State.virtualScroll.rowHeight}px`;
      renderVisibleRows();
    },

    renderVisibleRows({
      State,
      documentRef = document,
      formatDate,
      createDraftRowHTML = () => '',
      createRowHTML = () => ''
    }) {
      const tbody = documentRef.getElementById('table-body');
      if (!tbody) return;

      const { startIndex, endIndex } = State.virtualScroll;
      const visibleRecords = State.records.slice(startIndex, endIndex);

      if (visibleRecords.length === 0) {
        tbody.innerHTML = '<tr><td colspan="12" class="empty-state">ไม่พบข้อมูลรายการ</td></tr>';
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
  };

  global.RendererTableVirtualScrollModule = moduleApi;
})(window);
