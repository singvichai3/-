(function (global) {
  const moduleApi = {
    getPrintFitApi() {
      return (typeof window !== 'undefined' && window.PrintFit) ? window.PrintFit : null;
    },

    normalizePrintStyleSettings(rawStyle = {}) {
      const style = rawStyle && typeof rawStyle === 'object' ? rawStyle : {};
      const clamp = (value, fallback, min, max) => {
        const number = Number(value);
        if (!Number.isFinite(number)) return fallback;
        return Math.min(max, Math.max(min, number));
      };
      return {
        mainTitleFontPx: clamp(style.mainTitleFontPx, 9, 6, 18),
        headerLabelFontPx: clamp(style.headerLabelFontPx, style.mainTitleFontPx || 9, 6, 18),
        headerValueFontPx: clamp(style.headerValueFontPx, style.mainTitleFontPx || 9, 6, 18),
        subTitleFontPx: clamp(style.subTitleFontPx, 10, 6, 18),
        tableBodyFontPx: clamp(style.tableBodyFontPx, 8, 5, 16),
        summaryFontPx: clamp(style.summaryFontPx, 8, 5, 16),
        tableWidthPct: clamp(style.tableWidthPct, 100, 60, 100),
        verticalScalePct: clamp(style.verticalScalePct, 100, 60, 140)
      };
    },

    getPrintStyleSettings(State) {
      if (!State.tableMeta.printStyle) State.tableMeta.printStyle = {};
      const normalized = moduleApi.normalizePrintStyleSettings(State.tableMeta.printStyle);
      State.tableMeta.printStyle = normalized;
      return normalized;
    },

    syncPrintStyleControls(State) {
      const style = moduleApi.getPrintStyleSettings(State);
      Object.entries({
        'print-main-title-font': style.mainTitleFontPx,
        'print-header-label-font': style.headerLabelFontPx,
        'print-header-value-font': style.headerValueFontPx,
        'print-sub-title-font': style.subTitleFontPx,
        'print-table-body-font': style.tableBodyFontPx,
        'print-summary-font': style.summaryFontPx,
        'print-table-width': style.tableWidthPct,
        'print-vertical-scale': style.verticalScalePct
      }).forEach(([id, value]) => {
        const input = document.getElementById(id);
        if (input) input.value = String(value);
      });
    },

    calculatePrintFitMetrics(_ctx, rowCount, requestedLayout) {
      const api = moduleApi.getPrintFitApi();
      if (!api || typeof api.calculatePrintMetrics !== 'function') {
        const fallbackLayout = requestedLayout === 'full-page' ? 'full-page' : 'half-left';
        const targetRows = fallbackLayout === 'full-page' ? 60 : 55;
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
      return api.calculatePrintMetrics({ rowCount, requestedLayout, columnsWeight: requestedLayout === 'full-page' ? 0.8 : 0.72 });
    },

    syncPrintLayoutControls({ State, buildPrintableTableRows }) {
      const printableRows = buildPrintableTableRows();
      const requestedLayout = State.tableMeta.printLayout || 'auto';
      const metrics = moduleApi.calculatePrintFitMetrics(null, printableRows.length || 1, requestedLayout);
      const layout = metrics.resolvedLayout || 'half-left';
      const select = document.getElementById('print-layout-select');
      if (select) select.value = ['auto', 'half-left', 'full-page'].includes(requestedLayout) ? requestedLayout : 'auto';
      moduleApi.syncPrintStyleControls(State);

      const wrap = document.getElementById('print-preview-sheet-wrap');
      const sheet = document.getElementById('print-preview-sheet');
      if (wrap) {
        wrap.classList.remove('half-left', 'full-page');
        wrap.classList.add(layout);
      }
      if (sheet) {
        sheet.classList.remove('half-left', 'full-page');
        sheet.classList.add(layout);
        sheet.dataset.requestedLayout = requestedLayout;
        sheet.dataset.resolvedLayout = layout;
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
        syncPrintLayoutControls,
        showShopService = false,
        stackedSecondaryHeader = false
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

      syncPrintLayoutControls();

      const style = moduleApi.getPrintStyleSettings(State);
      const verticalScale = style.verticalScalePct / 100;
      const headerFont = style.mainTitleFontPx || metrics.headerFontPx;
      const headerLabelFont = style.headerLabelFontPx || headerFont;
      const headerValueFont = style.headerValueFontPx || headerFont;
      const tableFont = style.tableBodyFontPx || metrics.tableFontPx;
      const summaryFont = style.summaryFontPx || metrics.summaryFontPx;
      const columnHeaderFontPx = style.subTitleFontPx || 10;
      const tableWidthPct = style.tableWidthPct || 100;
      const cellPadding = `${Math.max(0.1, metrics.cellPaddingMm * verticalScale).toFixed(2)}mm`;
      const topPadding = `${Math.max(0.5, metrics.paddingMm * verticalScale).toFixed(2)}mm`;
      const contentGap = `${Math.max(0.2, metrics.gapMm * verticalScale).toFixed(2)}mm`;
      const rowHeight = `${Math.max(1, metrics.rowHeightMm * verticalScale).toFixed(2)}mm`;
      const summaryGap = `${Math.max(0.2, Math.min(metrics.gapMm * 0.34 * verticalScale, 1.15)).toFixed(2)}mm`;

      container.dataset.printLayout = layout;
      container.dataset.rowCount = String(rowCount);
      container.dataset.fitsOnPage = metrics.fitsOnPage ? 'true' : 'false';
      container.dataset.overflowMm = metrics.overflowMm.toFixed(2);
      container.classList.toggle('overflowing', !metrics.fitsOnPage);

      container.style.setProperty('--print-scale', '1');
      container.style.setProperty('--print-padding', topPadding);
      container.style.setProperty('--print-gap', contentGap);
      container.style.setProperty('--print-header-font', `${headerFont.toFixed(2)}px`);
      container.style.setProperty('--print-table-font', `${tableFont.toFixed(2)}px`);
      container.style.setProperty('--print-header-label-font', `${headerLabelFont.toFixed(2)}px`);
      container.style.setProperty('--print-header-value-font', `${headerValueFont.toFixed(2)}px`);
      container.style.setProperty('--print-summary-font', `${summaryFont.toFixed(2)}px`);
      container.style.setProperty('--print-column-header-font', `${columnHeaderFontPx}px`);
      container.style.setProperty('--print-cell-padding', cellPadding);
      container.style.setProperty('--print-row-height', rowHeight);
      container.style.setProperty('--print-summary-gap', summaryGap);
      container.style.setProperty('--print-table-width', `${tableWidthPct}%`);

      const colPcts = {
        index: 10,
        plate: 28,
        car: 7,
        moto: 7,
        tax: 22,
        note: 26
      };

      const rowsHtml = printableRows.length > 0
        ? printableRows.map((row) => `
            <tr style="height:${rowHeight};">
                <td style="width:${colPcts.index}%; text-align:center; padding:${cellPadding};">${row.index}</td>
                <td style="width:${colPcts.plate}%; padding:${cellPadding};">${escapeHTML(row.plate)}</td>
                <td style="width:${colPcts.car}%; text-align:center; padding:${cellPadding};">${row.type === 'รย' ? '/' : ''}</td>
                <td style="width:${colPcts.moto}%; text-align:center; padding:${cellPadding};">${row.type === 'จยย' ? '/' : ''}</td>
                <td style="width:${colPcts.tax}%; text-align:right; padding:${cellPadding};">${formatCurrency(row.taxAmount)}</td>
                <td style="width:${colPcts.note}%; padding:${cellPadding};">${escapeHTML(row.note)}</td>
            </tr>
        `).join('')
        : `<tr style="height:${rowHeight};"><td colspan="6" style="text-align:center; padding:${cellPadding};">ยังไม่มีข้อมูลสำหรับพิมพ์</td></tr>`;
      const overflowWarningHtml = metrics.fitsOnPage ? '' : `
            <div class="print-overflow-warning">
                ⚠️ ข้อมูลเกินหน้ากระดาษ ${metrics.overflowMm.toFixed(1)}mm — เลือก “เต็มหน้า A4” หรือลดจำนวนแถว
            </div>`;
      const headerHtml = stackedSecondaryHeader ? `
            <div class="print-sheet-header print-sheet-header-stacked">
                <div class="print-meta-station-line"><span class="print-meta-value">${stationName}</span></div>
                <div class="print-meta-date-line">
                    <span><strong class="print-meta-label">วันที่</strong> <span class="print-meta-value">${documentDate}</span></span>
                    <span><strong class="print-meta-label">วันนัด</strong> <span class="print-meta-value">${appointmentDate}</span></span>
                </div>
            </div>` : `
            <div class="print-sheet-header">
                <div class="print-meta-row">
                    <span><strong class="print-meta-label">ตรอ.</strong> <span class="print-meta-value">${stationName}</span></span>
                    <span><strong class="print-meta-label">วันที่</strong> <span class="print-meta-value">${documentDate}</span></span>
                    <span><strong class="print-meta-label">วันนัด</strong> <span class="print-meta-value">${appointmentDate}</span></span>
                </div>
            </div>`;
      const shopServiceHtml = showShopService ? `
                <div class="print-summary-shop-divider"></div>
                <div class="print-summary-shop-title">การคิดค่าบริการร้าน</div>
                <div class="print-summary-row print-summary-shop-detail">
                    <span>รย. ${summary.carCount}×${summary.shopCarRate}=</span>
                    <strong>${formatCurrency(summary.shopCarServiceTotal)}</strong>
                </div>
                <div class="print-summary-row print-summary-shop-detail">
                    <span>จยย. ${summary.motorcycleCount}×${summary.shopMotoRate}=</span>
                    <strong>${formatCurrency(summary.shopMotoServiceTotal)}</strong>
                </div>
                <div class="print-summary-row print-summary-shop-total">
                    <span>รวม=</span>
                    <strong>${formatCurrency(summary.shopServiceTotal)}</strong>
                </div>` : '';

      const forcedMetricStyles = `
        <style data-print-metrics="runtime">
          #print-preview-sheet .print-sheet-content { padding: calc(${topPadding} * .52) calc(${topPadding} * .82) calc(${topPadding} * .18) calc(${topPadding} * .82) !important; gap: ${contentGap} !important; }
          #print-preview-sheet .print-sheet-header { font-size: ${headerFont.toFixed(2)}px !important; }
          #print-preview-sheet .print-meta-label { font-size: ${headerLabelFont.toFixed(2)}px !important; font-weight: 700 !important; }
          #print-preview-sheet .print-meta-value { font-size: ${headerValueFont.toFixed(2)}px !important; font-weight: 500 !important; }
          #print-preview-sheet .print-table { font-size: ${tableFont.toFixed(2)}px !important; width: ${tableWidthPct}% !important; margin-left: auto !important; margin-right: auto !important; }
          #print-preview-sheet .print-table thead th { color: #000 !important; font-size: ${columnHeaderFontPx}px !important; font-weight: 700 !important; }
          #print-preview-sheet .print-table th, #print-preview-sheet .print-table td { border-color: #64748b !important; border-width: 1.2px !important; padding: ${cellPadding} !important; }
          #print-preview-sheet .print-table tbody tr { height: ${rowHeight} !important; }
          #print-preview-sheet .print-summary { font-size: ${summaryFont.toFixed(2)}px !important; gap: ${summaryGap} !important; }
          #print-preview-sheet.overflowing .print-sheet-content { overflow: visible !important; }
        </style>`;

      container.innerHTML = `
        ${forcedMetricStyles}
        <div class="print-sheet-content">
            ${headerHtml}
            ${overflowWarningHtml}
            <table class="print-table print-table-compact" style="width:${tableWidthPct}%; margin-left:auto; margin-right:auto;">
                <thead>
                    <tr>
                        <th style="width:${colPcts.index}%">ลำดับ</th>
                        <th style="width:${colPcts.plate}%">ทะเบียน</th>
                        <th style="width:${colPcts.car}%">รย.</th>
                        <th style="width:${colPcts.moto}%">จยย.</th>
                        <th style="width:${colPcts.tax}%">ภาษี</th>
                        <th style="width:${colPcts.note}%">หมายเหตุ</th>
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
                    <span>ค่าขนส่ง รย.${summary.carCount}×${summary.transportCarRate} + จยย.${summary.motorcycleCount}×${summary.transportMotoRate}</span>
                    <strong>${formatCurrency(summary.serviceTotal)}</strong>
                </div>
                <div class="print-summary-row print-summary-grand">
                    <span>ยอดสุทธิ</span>
                    <strong>${formatCurrency(summary.grandTotal)}</strong>
                </div>${shopServiceHtml}
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
        const sheet = document.getElementById('print-preview-sheet');
        const resolvedLayout = sheet ? (sheet.dataset.resolvedLayout || sheet.dataset.printLayout || 'half-left') : 'half-left';
        const result = await api.exportPrintPdf({ rowCount: printableRows.length, layout: resolvedLayout });
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
    },

    updatePrintStyleSetting({ State, renderPrintPreviewContent }, key, value) {
      const allowedKeys = ['mainTitleFontPx', 'headerLabelFontPx', 'headerValueFontPx', 'subTitleFontPx', 'tableBodyFontPx', 'summaryFontPx', 'tableWidthPct', 'verticalScalePct'];
      if (!allowedKeys.includes(String(key))) return;
      const current = moduleApi.getPrintStyleSettings(State);
      State.tableMeta.printStyle = moduleApi.normalizePrintStyleSettings({ ...current, [key]: value });
      moduleApi.syncPrintStyleControls(State);
      if (document.getElementById('print-preview-modal')?.classList.contains('show')) {
        renderPrintPreviewContent();
      }
    }
  };

  global.RendererPrintPreviewModule = moduleApi;
})(window);
