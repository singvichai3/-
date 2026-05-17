(function (global) {
  const moduleApi = {
    getPrintFitApi() {
      return (typeof window !== 'undefined' && window.PrintFit) ? window.PrintFit : null;
    },

    calculatePrintFitMetrics(_ctx, rowCount, requestedLayout) {
      const api = moduleApi.getPrintFitApi();
      if (!api || typeof api.calculatePrintMetrics !== 'function') {
        const fallbackLayout = requestedLayout === 'full-page' ? 'full-page' : 'half-left';
        const targetRows = fallbackLayout === 'full-page' ? 50 : 25;
        const scale = Math.max(0.12, Math.min(1, targetRows / Math.max(rowCount, 1)));
        return {
          resolvedLayout: fallbackLayout,
          pageHeightMm: fallbackLayout === 'full-page' ? 270 : 260,
          fitsOnPage: true,
          overflowMm: 0,
          paddingMm: Math.max(0.9, 4.2 * scale),
          gapMm: Math.max(0.45, 2 * scale),
          headerFontPx: Math.max(4.2, 9.2 * scale),
          tableFontPx: Math.max(3.1, 8.1 * scale),
          summaryFontPx: Math.max(3.5, 8.6 * scale),
          cellPaddingMm: Math.max(0.14, 0.82 * scale),
          rowHeightMm: Math.max(1.9, 3.7 * scale),
          estimatedHeightMm: 0,
          pressure: 0
        };
      }
      return api.calculatePrintMetrics({ rowCount, requestedLayout });
    },

    syncPrintLayoutControls({ State, buildPrintableTableRows }) {
      const printableRows = buildPrintableTableRows();
      const requestedLayout = State.tableMeta.printLayout || 'auto';
      const metrics = moduleApi.calculatePrintFitMetrics(null, printableRows.length || 1, requestedLayout);
      const layout = metrics.resolvedLayout || 'half-left';
      State.tableMeta.printLayout = layout;
      const select = document.getElementById('print-layout-select');
      if (select) select.value = layout;

      const wrap = document.getElementById('print-preview-sheet-wrap');
      const sheet = document.getElementById('print-preview-sheet');
      if (wrap) {
        wrap.classList.remove('half-left', 'full-page');
        wrap.classList.add(layout);
      }
      if (sheet) {
        sheet.classList.remove('half-left', 'full-page');
        sheet.classList.add(layout);
      }
    },

    renderPrintPreviewContent(ctx) {
      const {
        State,
        escapeHTML,
        formatDate,
        formatCurrency,
        buildPrintableTableRows,
        calculateTableSummary,
        TABLE_SERVICE_RATE,
        syncPrintLayoutControls
      } = ctx;
      const container = document.getElementById('print-preview-sheet');
      if (!container) return;

      const printableRows = buildPrintableTableRows();
      const rowCount = Math.max(printableRows.length, 1);
      const summary = calculateTableSummary();
      const stationName = escapeHTML(State.tableMeta.stationName || '-');
      const documentDate = escapeHTML(formatDate(State.tableMeta.documentDate || ''));
      const appointmentDate = escapeHTML(formatDate(State.tableMeta.appointmentDate || ''));

      const requestedLayout = State.tableMeta.printLayout || 'auto';
      const metrics = moduleApi.calculatePrintFitMetrics(null, rowCount, requestedLayout);
      const layout = metrics.resolvedLayout || 'half-left';

      State.tableMeta.printLayout = layout;
      syncPrintLayoutControls();

      const headerFont = metrics.headerFontPx;
      const tableFont = metrics.tableFontPx;
      const summaryFont = metrics.summaryFontPx;
      const cellPadding = `${metrics.cellPaddingMm.toFixed(2)}mm`;
      const topPadding = `${metrics.paddingMm.toFixed(2)}mm`;
      const contentGap = `${metrics.gapMm.toFixed(2)}mm`;
      const rowHeight = `${metrics.rowHeightMm.toFixed(2)}mm`;
      const summaryGap = `${Math.max(0.3, Math.min(metrics.gapMm * 0.34, 0.85)).toFixed(2)}mm`;

      container.dataset.printLayout = layout;
      container.dataset.rowCount = String(rowCount);
      container.dataset.fitsOnPage = metrics.fitsOnPage ? 'true' : 'false';
      container.dataset.overflowMm = metrics.overflowMm.toFixed(2);

      container.style.setProperty('--print-scale', '1');
      container.style.setProperty('--print-padding', topPadding);
      container.style.setProperty('--print-gap', contentGap);
      container.style.setProperty('--print-header-font', `${headerFont.toFixed(2)}px`);
      container.style.setProperty('--print-table-font', `${tableFont.toFixed(2)}px`);
      container.style.setProperty('--print-summary-font', `${summaryFont.toFixed(2)}px`);
      container.style.setProperty('--print-cell-padding', cellPadding);
      container.style.setProperty('--print-row-height', rowHeight);
      container.style.setProperty('--print-summary-gap', summaryGap);

      const rowsHtml = printableRows.length > 0
        ? printableRows.map((row) => `
            <tr>
                <td style="text-align:center;">${row.index}</td>
                <td>${escapeHTML(row.plate)}</td>
                <td style="text-align:center;">${row.type === 'รย' ? '/' : ''}</td>
                <td style="text-align:center;">${row.type === 'จยย' ? '/' : ''}</td>
                <td style="text-align:right;">${formatCurrency(row.taxAmount)}</td>
                <td>${escapeHTML(row.note)}</td>
            </tr>
        `).join('')
        : '<tr><td colspan="6" style="text-align:center;">ยังไม่มีข้อมูลสำหรับพิมพ์</td></tr>';
      const overflowWarningHtml = metrics.fitsOnPage ? '' : `
            <div class="print-overflow-warning">
                ⚠️ ข้อมูลเกินหน้ากระดาษ บางรายการอาจถูกตัด ให้ลดจำนวนแถวหรือเลือกพิมพ์เต็ม A4
            </div>`;

      container.innerHTML = `
        <div class="print-sheet-content">
            <div class="print-sheet-header">
                <div class="print-meta-row">
                    <span><strong>ตรอ.</strong> ${stationName}</span>
                    <span><strong>วันที่</strong> ${documentDate}</span>
                    <span><strong>วันนัด</strong> ${appointmentDate}</span>
                </div>
            </div>
            ${overflowWarningHtml}
            <table class="print-table print-table-compact">
                <thead>
                    <tr>
                        <th style="width:11%">ลำดับ</th>
                        <th style="width:33%">ทะเบียน</th>
                        <th style="width:8%">รย.</th>
                        <th style="width:8%">จยย.</th>
                        <th style="width:22%">ภาษี (บาท)</th>
                        <th style="width:18%">หมายเหตุ</th>
                    </tr>
                </thead>
                <tbody>${rowsHtml}</tbody>
            </table>
            <div class="print-summary">
                <div class="print-summary-row print-summary-counts">
                    <span>รย. <strong>${summary.carCount}</strong> คัน</span>
                    <span>จยย. <strong>${summary.motorcycleCount}</strong> คัน</span>
                    <span>รวม <strong>${summary.serviceCount}</strong> คัน</span>
                </div>
                <div class="print-summary-divider"></div>
                <div class="print-summary-row">
                    <span>ภาษีรวม</span>
                    <strong>${formatCurrency(summary.taxTotal)}</strong>
                </div>
                <div class="print-summary-row">
                    <span>ค่าบริการ รย.${summary.carCount}×${TABLE_SERVICE_RATE} + จยย.${summary.motorcycleCount}×${TABLE_SERVICE_RATE}</span>
                    <strong>${formatCurrency(summary.serviceTotal)}</strong>
                </div>
                <div class="print-summary-row print-summary-grand">
                    <span>ยอดสุทธิ</span>
                    <strong>${formatCurrency(summary.grandTotal)}</strong>
                </div>
            </div>
        </div>
    `;
    },

    openPrintPreview({ buildPrintableTableRows, syncPrintLayoutControls, renderPrintPreviewContent, showNotification }) {
      const printableRows = buildPrintableTableRows();
      if (printableRows.length === 0) {
        showNotification('❌ ยังไม่มีข้อมูลสำหรับพิมพ์', 'error');
        return;
      }

      syncPrintLayoutControls();
      renderPrintPreviewContent();
      document.getElementById('print-preview-modal')?.classList.add('show');
    },

    closePrintPreview() {
      document.getElementById('print-preview-modal')?.classList.remove('show');
    },

    finishPrintInteraction({ closePrintPreview }, shouldClosePreview = true) {
      document.body.classList.remove('printing-active');
      if (shouldClosePreview) closePrintPreview();
    },

    confirmTablePrint() {
      document.body.classList.add('printing-active');
      window.print();
    },

    async exportPrintPreviewPdf({ buildPrintableTableRows, renderPrintPreviewContent, State, api, showNotification, finishPrintInteraction }) {
      const printableRows = buildPrintableTableRows();
      if (printableRows.length === 0) {
        showNotification('❌ ยังไม่มีข้อมูลสำหรับพิมพ์', 'error');
        return;
      }

      try {
        renderPrintPreviewContent();
        document.body.classList.add('printing-active');
        await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 250)));
        const result = await api.exportPrintPdf({ rowCount: printableRows.length, layout: State.tableMeta.printLayout || 'auto' });
        if (result) {
          showNotification(`✅ บันทึก PDF สำเร็จ ${result.rowCount?.toLocaleString?.() || printableRows.length} รายการ`, 'success');
        }
      } catch (error) {
        showNotification(`❌ บันทึก PDF ไม่สำเร็จ: ${error.message}`, 'error');
      } finally {
        finishPrintInteraction(false);
      }
    },

    updatePrintLayout({ updateTableMetaField }, value) {
      updateTableMetaField('printLayout', value);
    }
  };

  global.RendererPrintPreviewModule = moduleApi;
})(window);
