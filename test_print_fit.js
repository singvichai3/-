const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  resolvePrintLayout,
  calculatePrintMetrics,
  estimatePrintContentHeightMm,
  calculatePageBreakMetrics
} = require('./print-fit');

function verifyFits(rowCount, requestedLayout = 'auto', columnsWeight = null) {
  const metrics = calculatePrintMetrics({ rowCount, requestedLayout, columnsWeight });
  const estimatedHeight = estimatePrintContentHeightMm(metrics);
  assert.ok(metrics.fitsOnPage, `expected ${rowCount} rows (${requestedLayout}) to fit — overflow: ${metrics.overflowMm.toFixed(2)}mm`);
  assert.ok(estimatedHeight <= metrics.pageHeightMm + 1.0, `content height overflow for ${rowCount} rows: ${estimatedHeight.toFixed(2)}mm > ${metrics.pageHeightMm}mm`);
  return metrics;
}

// --- layout resolution ---
assert.strictEqual(resolvePrintLayout('auto', 12), 'half-left');
assert.strictEqual(resolvePrintLayout('auto', 60), 'half-left', '60 rows auto should resolve to half-left');
assert.strictEqual(resolvePrintLayout('auto', 61), 'full-page', '61+ rows should resolve to full-page so real printers do not clip dense half-left tables');
assert.strictEqual(resolvePrintLayout('full-page', 20), 'full-page');
assert.strictEqual(resolvePrintLayout('half-left', 70), 'half-left', 'explicit half-left should be respected');

// --- half-left: 60 rows fits ---
const fit60half = verifyFits(60, 'half-left');
assert.strictEqual(fit60half.resolvedLayout, 'half-left');
assert.strictEqual(fit60half.pageWidthMm, 88);
assert.strictEqual(fit60half.pageHeightMm, 260);
assert.ok(fit60half.rowHeightMm >= 1.65, '60-row height should not go below min');
assert.ok(fit60half.rowHeightMm <= 3.2, '60-row height should stay compact but still use more of the safe A4 area');
assert.ok(fit60half.tableFontPx >= 5.0, 'table font should stay readable');
assert.ok(fit60half.summaryHeightMm >= 12, 'summary should have enough compact space for 5 rows');

// --- auto 60 rows → half-left ---
const fit60auto = verifyFits(60, 'auto');
assert.strictEqual(fit60auto.resolvedLayout, 'half-left', 'auto 60 rows should pick half-left');

// --- half-left smaller counts ---
const fit20 = verifyFits(20, 'auto');
assert.strictEqual(fit20.resolvedLayout, 'half-left');
assert.strictEqual(fit20.pageHeightMm, 260, 'half-left must use a conservative real-printer-safe height after @page margins');

// --- full-page still works ---
const fit50full = verifyFits(50, 'full-page');
assert.strictEqual(fit50full.resolvedLayout, 'full-page');
assert.strictEqual(fit50full.pageHeightMm, 270, 'full-page should use a conservative A4-safe content height');
const fit70full = verifyFits(70, 'full-page');
assert.ok(fit70full.rowHeightMm < fit50full.rowHeightMm, '70-row should compress more than 50-row on full-page');
const fit80full = verifyFits(80, 'full-page');
assert.ok(fit80full.fitsOnPage, '80-row full-page should fit at the full-page hard max');

// --- overflow and column weight regression guards ---
const overflowHalf = calculatePrintMetrics({ rowCount: 200, requestedLayout: 'half-left' });
assert.strictEqual(overflowHalf.fitsOnPage, false, '200 half-left rows should not be silently treated as fitting');
assert.ok(overflowHalf.overflowMm > 0, 'overflowing layouts should report positive overflowMm');

const cwWide = calculatePrintMetrics({ rowCount: 30, requestedLayout: 'half-left', columnsWeight: 1.0 });
const cwCompact = calculatePrintMetrics({ rowCount: 30, requestedLayout: 'half-left', columnsWeight: 0.6 });
assert.strictEqual(cwWide.paddingMm, cwCompact.paddingMm, 'columnsWeight must not shrink vertical padding');
assert.strictEqual(cwWide.tableFontPx, cwCompact.tableFontPx, 'columnsWeight must not shrink print font vertically');
assert.strictEqual(cwWide.rowHeightMm, cwCompact.rowHeightMm, 'columnsWeight must not alter row height');
assert.strictEqual(cwCompact.columnsWeight, 0.6, 'columnsWeight should still be returned for horizontal rendering');

// --- estimated height increases with rows (compression doesn't kick in until > preferredRows=60) ---
const fit30 = verifyFits(30, 'half-left');
assert.ok(fit60half.estimatedHeightMm > fit30.estimatedHeightMm, '60-row page should be taller than 30-row');
assert.ok(fit60half.rowHeightMm <= fit30.rowHeightMm, '60-row height should not exceed 30-row height');

// --- renderer summary content + PDF export wiring ---
const rendererJs = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8');
const rendererPrintPreviewJs = fs.readFileSync(path.join(__dirname, 'renderer-print-preview.js'), 'utf8');
const preloadJs = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8');
const mainJs = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const secondaryIndexHtml = fs.readFileSync(path.join(__dirname, 'secondary-index.html'), 'utf8');
const secondaryRendererJs = fs.readFileSync(path.join(__dirname, 'secondary-renderer.js'), 'utf8');
const renderLayerCode = `${rendererJs}\n${rendererPrintPreviewJs}`;

assert.ok(
  indexHtml.includes('body.printing-active .print-preview-toolbar,\n        body.printing-active .print-style-controls'),
  'main print output must hide print-style controls, not only the toolbar'
);
assert.ok(
  secondaryIndexHtml.includes('body.printing-active .print-preview-toolbar, body.printing-active .print-style-controls'),
  'secondary print output must hide print-style controls, not only the toolbar'
);

assert.ok(renderLayerCode.includes('ภาษีรวม'), 'print summary should show ภาษีรวม');
assert.ok(renderLayerCode.includes('ยอดสุทธิ'), 'print summary should show ยอดสุทธิ');
assert.ok(renderLayerCode.includes('print-summary-counts'), 'print summary should have counts row (รย/จยย/รวม)');
assert.ok(renderLayerCode.includes('print-summary-grand'), 'print summary should have grand total row');
assert.ok(!indexHtml.includes('margin-top: auto;\n            border-top: 1.5px solid #94a3b8;'), 'print summary should no longer be pushed to the page bottom');
assert.ok(indexHtml.includes('บันทึกเป็น PDF'), 'print preview should provide a PDF export button');
assert.ok(preloadJs.includes('exportPrintPdf'), 'preload should expose exportPrintPdf API');
assert.ok(mainJs.includes("ipcMain.handle('export-print-pdf'"), 'main process should handle export-print-pdf');
assert.ok(renderLayerCode.includes('api.exportPrintPdf'), 'renderer should call exportPrintPdf API');
assert.ok(mainJs.includes('printToPDF'), 'main process should generate PDF via printToPDF');
assert.ok(rendererPrintPreviewJs.includes('calculatePageBreakMetrics'), 'print preview should use multi-page splitting instead of single-page overflow warning');
assert.ok(secondaryIndexHtml.includes('https://fonts.googleapis.com/css2?family=Sarabun'), 'secondary app should load the same Sarabun web font as the main app');
assert.ok(secondaryIndexHtml.includes("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com"), 'secondary CSP should allow the same Sarabun font sources as the main app');
assert.ok(secondaryIndexHtml.includes('-webkit-font-smoothing: antialiased'), 'secondary app should use the same font smoothing reset as the main app');
assert.ok(!secondaryIndexHtml.includes("font-family:'Sarabun', Tahoma"), 'secondary print should not use a different Tahoma fallback from the main print template');
assert.ok(secondaryRendererJs.includes("minimumFractionDigits: 2, maximumFractionDigits: 2"), 'secondary print currency formatting should keep two decimals like the main app');
assert.ok(!secondaryRendererJs.includes("minimumFractionDigits: 0, maximumFractionDigits: 2"), 'secondary print currency should not drop .00 decimals while main keeps them');
assert.ok(secondaryIndexHtml.includes('class="print-preview-modal"'), 'secondary print modal should use the same modal class as the main print preview');
assert.ok(secondaryIndexHtml.includes('class="print-preview-dialog"'), 'secondary print preview should use the same dialog wrapper as the main app');
assert.ok(secondaryIndexHtml.includes('class="print-preview-sheet-wrap half-left"'), 'secondary print sheet wrapper should match the main app wrapper class');
assert.ok(secondaryIndexHtml.includes('id="print-layout-select"'), 'secondary print preview should expose the same A4 layout selector as the main app');
assert.ok(secondaryIndexHtml.includes('<option value="auto">อัตโนมัติ (เลือกให้พอดี A4)</option>'), 'secondary print selector should include auto layout');
assert.ok(secondaryIndexHtml.includes('<option value="half-left">ครึ่งซ้ายของหน้า A4 (พอดีพื้นที่พิมพ์)</option>'), 'secondary print selector should include half-left layout that fits the printable A4 area');
assert.ok(secondaryIndexHtml.includes('<option value="full-page">เต็มหน้า A4</option>'), 'secondary print selector should include full-page A4 layout');
assert.ok(secondaryIndexHtml.includes('onchange="updatePrintLayout(this.value)"'), 'secondary print selector should trigger the shared print layout recalculation');
assert.ok(secondaryIndexHtml.includes('width:88mm; height:260mm;'), 'secondary half-left print sheet should use a conservative real-printer-safe box inside A4 margins');
assert.ok(secondaryIndexHtml.includes('.print-sheet { --print-scale:1; --print-padding:5mm;'), 'secondary print fallback variables should live on .print-sheet so JS inline metrics can override them');
assert.ok(secondaryIndexHtml.includes('.print-sheet-content { width:100%; height:100%; min-height:0;'), 'secondary print content should be fixed to the sheet instead of expanding beyond A4');
assert.ok(!secondaryIndexHtml.includes('.print-sheet-content { --print-scale:1;'), 'secondary print content must not override JS-calculated print variables');
assert.ok(secondaryIndexHtml.includes('.print-sheet.full-page { width:185mm; height:270mm; }'), 'secondary full-page layout should use a conservative A4-safe printable box');
assert.ok(secondaryIndexHtml.includes('.print-sheet.half-left { width:88mm; height:260mm; max-height:260mm; }'), 'secondary half-left layout should be conservative enough for real A4 printer margins');
assert.ok(secondaryIndexHtml.includes('@page { size:A4 portrait; margin:10mm; }'), 'secondary print CSS should use the same A4 safe margin as the main app');
assert.ok(secondaryIndexHtml.includes('body.printing-active main, body.printing-active #titlebar, body.printing-active #toast'), 'secondary print CSS should isolate print mode with printing-active like the main app');
assert.ok(secondaryIndexHtml.includes('body.printing-active .print-preview-dialog { box-shadow:none; border:none; background:transparent; padding:0; max-height:none; overflow:visible; height:auto; }'), 'secondary print dialog should collapse like the main app while printing');
assert.ok(secondaryIndexHtml.includes('body.printing-active .print-sheet { box-shadow:none; break-inside:avoid; page-break-inside:avoid; }'), 'secondary print sheet should avoid page breaks without centering half-left layout');
assert.ok(secondaryIndexHtml.includes('body.printing-active .print-sheet.half-left { margin:0; }'), 'secondary half-left print sheet should stay aligned to the left edge of the printable area');
assert.ok(secondaryIndexHtml.includes('body.printing-active .print-sheet.full-page { margin:0 auto; }'), 'secondary full-page print sheet should remain centered');
assert.ok(!secondaryIndexHtml.includes('body.printing-active .print-sheet { box-shadow:none; margin:0 auto; }'), 'secondary half-left layout must not inherit centered print margin');
assert.ok(secondaryIndexHtml.includes('body.printing-active .print-preview-toolbar, body.printing-active .print-style-controls { display:none !important; }'), 'secondary print CSS should hide toolbar and style controls during actual printing');
assert.ok(secondaryIndexHtml.includes('body.printing-active .print-preview-modal, body.printing-active .print-preview-modal * { visibility:visible; }'), 'secondary print media CSS should reveal only the print modal while printing');
assert.ok(rendererPrintPreviewJs.includes('pageHeightMm: fallbackLayout === \'full-page\' ? 270 : 260'), 'print fallback should use the same conservative A4-safe half-left height as the real calculator');
assert.ok(rendererPrintPreviewJs.includes("columnsWeight: requestedLayout === 'full-page' ? 0.8 : 0.72"), 'renderer should pass print column weight into shared fit metrics for A4 auto layout');
assert.ok(rendererPrintPreviewJs.includes('style data-print-metrics="runtime"'), 'print preview should inject runtime metric CSS so calculated sizing visibly overrides static shell CSS');
assert.ok(rendererPrintPreviewJs.includes('const columnHeaderFontPx = style.subTitleFontPx || 10'), 'print preview column headers should use the adjustable subtitle/header size');
assert.ok(rendererPrintPreviewJs.includes('updatePrintStyleSetting'), 'print preview should expose live style controls for title size, subtitle size, table width, and vertical spacing');
assert.ok(indexHtml.includes('id="print-main-title-font"') && indexHtml.includes('id="print-header-label-font"') && indexHtml.includes('id="print-header-value-font"') && indexHtml.includes('id="print-sub-title-font"') && indexHtml.includes('id="print-table-body-font"') && indexHtml.includes('id="print-summary-font"') && indexHtml.includes('id="print-table-width"') && indexHtml.includes('id="print-vertical-scale"'), 'main print preview should include detailed style adjustment controls');
assert.ok(secondaryIndexHtml.includes('id="print-main-title-font"') && secondaryIndexHtml.includes('id="print-header-label-font"') && secondaryIndexHtml.includes('id="print-header-value-font"') && secondaryIndexHtml.includes('id="print-sub-title-font"') && secondaryIndexHtml.includes('id="print-table-body-font"') && secondaryIndexHtml.includes('id="print-summary-font"') && secondaryIndexHtml.includes('id="print-table-width"') && secondaryIndexHtml.includes('id="print-vertical-scale"'), 'secondary print preview should include detailed style adjustment controls');
assert.ok(rendererPrintPreviewJs.includes('print-meta-label') && rendererPrintPreviewJs.includes('print-meta-value'), 'print preview should split header labels and values so values like 123456/date can be sized separately');
assert.ok(rendererPrintPreviewJs.includes('tableBodyFontPx') && rendererPrintPreviewJs.includes('summaryFontPx'), 'print preview should expose table body and summary font controls');
assert.ok(rendererPrintPreviewJs.includes('--print-table-width:${tableWidthPct}%') && rendererPrintPreviewJs.includes('width:var(--print-table-width) !important'), 'runtime print CSS should apply adjustable table width');
assert.ok(rendererPrintPreviewJs.includes('metrics.rowHeightMm * verticalScale'), 'runtime print CSS should apply adjustable vertical spacing');
assert.ok(rendererPrintPreviewJs.includes('.print-table thead th { color:#000 !important; font-size:var(--print-column-header-font) !important;'), 'runtime print CSS should force black adjustable column headers');
assert.ok(indexHtml.includes('--print-column-header-font: 10px;'), 'main print CSS should expose a 10px column header font variable');
assert.ok(indexHtml.includes('color: #000;') && indexHtml.includes('font-size: var(--print-column-header-font);'), 'main print column headers should be black and use the header font variable');
assert.ok(secondaryIndexHtml.includes('--print-column-header-font:10px;'), 'secondary print CSS should expose a 10px column header font variable');
assert.ok(secondaryIndexHtml.includes('.print-table th { background:#f8fafc; color:#000;') && secondaryIndexHtml.includes('font-size:var(--print-column-header-font);'), 'secondary print column headers should be black and use the header font variable');
assert.ok(rendererPrintPreviewJs.includes('<tr style="height:${rowHeight};">'), 'print rows should receive inline calculated row height as a hard override');
assert.ok(rendererPrintPreviewJs.includes('padding:${cellPadding};'), 'print cells should receive inline calculated padding as a hard override');
assert.ok(secondaryRendererJs.includes("classList.contains('show')) renderPrintPreviewContent()"), 'secondary changing print layout while preview is open should re-render immediately');
assert.ok(rendererJs.includes("classList.contains('show')") && rendererJs.includes('renderPrintPreviewContent();'), 'main changing print layout while preview is open should re-render immediately');
assert.ok(secondaryIndexHtml.includes('.print-table tbody tr { height:var(--print-row-height); }'), 'secondary print row height should be applied on table rows, not cells');
assert.ok(!secondaryIndexHtml.includes('height:var(--print-row-height,3mm)'), 'secondary print cells should not force a stale fixed 3mm fallback height');
assert.ok(secondaryIndexHtml.includes('.print-table { width:var(--print-table-width,100%); min-width:0 !important; max-width:100%;'), 'secondary print table must override global table min-width while allowing adjustable table width');
assert.ok(indexHtml.includes('min-width: 0 !important;') && indexHtml.includes('max-width: 100%;'), 'main print table must override global table min-width so preview auto-layout fits inside the A4 sheet');
assert.ok(secondaryIndexHtml.includes('table-layout:fixed'), 'secondary print table should use fixed layout to avoid horizontal overflow');
assert.ok(secondaryIndexHtml.includes('td:nth-child(2)') && secondaryIndexHtml.includes('td:nth-child(6)') && secondaryIndexHtml.includes('white-space:nowrap'), 'secondary print should keep plate and note columns on one line like the main app');
assert.ok(indexHtml.includes('.print-preview-sheet-wrap.multi-page'), 'main CSS should have .multi-page class for stacked A4 sheets');
assert.ok(indexHtml.includes('@media print') && indexHtml.includes('overflow: visible;') && !indexHtml.includes('min-height: 297mm;\n                overflow: hidden;'), 'main print CSS should allow automatic multi-page output instead of clipping to the first page');
assert.ok(secondaryIndexHtml.includes('@media print { html, body { width:210mm; min-height:auto; overflow:visible; }'), 'secondary print CSS should allow multi-page output by removing the previous overflow:hidden constraint');
assert.ok(rendererPrintPreviewJs.includes('body.printing-active #print-preview-sheet-wrap.multi-page { gap:0 !important; }'), 'runtime print CSS should remove preview-only page gaps while printing multiple pages');
assert.ok(rendererPrintPreviewJs.includes('firstSheet.dataset.requestedLayout = requestedLayout'), 'print preview should preserve the user-selected auto/manual layout separately from resolved layout');
assert.ok(!rendererPrintPreviewJs.includes('State.tableMeta.printLayout = layout;'), 'print preview must not overwrite auto with the resolved layout');
assert.ok(rendererPrintPreviewJs.includes("classList.add('multi-page'"), 'print preview should add multi-page class when content overflows one sheet, enabling stacked pages');
assert.ok(rendererPrintPreviewJs.includes('const colPcts ='), 'print preview should calculate print column widths from one rendering source');
assert.ok(rendererPrintPreviewJs.includes('>ภาษี</th>') && !rendererPrintPreviewJs.includes('ภาษี (บาท)'), 'print tax column header should be shortened to ภาษี');
assert.ok(rendererPrintPreviewJs.includes('border-color: #64748b !important') && indexHtml.includes('border: 1.2px solid #64748b;') && secondaryIndexHtml.includes('border:1.2px solid #64748b;'), 'print table borders should be slightly darker/thicker in main, secondary, and runtime CSS');
assert.ok(secondaryIndexHtml.includes('.print-sheet.overflowing'), 'secondary print CSS should visibly expose overflow instead of hiding clipped rows');
assert.ok(mainJs.includes("marginType: 'printableArea'"), 'main PDF export should use printableArea margins consistently with @page');
assert.ok(fs.readFileSync(path.join(__dirname, 'secondary-main.js'), 'utf8').includes("marginType: 'printableArea'"), 'secondary PDF export should use printableArea margins consistently with @page');

// --- multi-page calculatePageBreakMetrics ---
(function testCalculatePageBreakMetrics() {
  // Small row count (50) should produce single page
  const sp = calculatePageBreakMetrics({ rowCount: 50, requestedLayout: 'half-left' });
  assert.strictEqual(sp.totalPages, 1, '50 half-left rows should fit in 1 page');
  assert.ok(sp.singlePage, '50 half-left rows should be singlePage');
  assert.strictEqual(sp.pages.length, 1, '50 half-left should have 1 page entry');
  assert.strictEqual(sp.pages[0].startRow, 0, 'single page should start at 0');
  assert.strictEqual(sp.pages[0].endRow, 50, 'single page should end at 50');

  // Large row count (300) should produce multiple pages
  const mp = calculatePageBreakMetrics({ rowCount: 300, requestedLayout: 'full-page' });
  assert.ok(mp.totalPages > 1, `300 full-page rows should need ${mp.totalPages} pages`);
  assert.ok(!mp.singlePage, '300 rows should not be singlePage');
  assert.strictEqual(mp.pages.length, mp.totalPages, 'pages array length should match totalPages');

  // Each page metrics should fit within page height
  mp.pages.forEach((page, idx) => {
    assert.ok(page.metrics.fitsOnPage, `page ${idx} metrics should fit on page (rows=${page.pageRowCount})`);
    assert.ok(page.pageRowCount > 0, `page ${idx} should have at least 1 row`);
    assert.strictEqual(page.endRow - page.startRow, page.pageRowCount, `page ${idx} endRow-startRow should equal pageRowCount`);
    // Rows should be contiguous
    if (idx > 0) {
      assert.strictEqual(page.startRow, mp.pages[idx - 1].endRow, `page ${idx} should start where previous ended`);
    }
  });

  // Last page may have fewer rows
  if (mp.totalPages > 1) {
    const lastPage = mp.pages[mp.totalPages - 1];
    const secondLast = mp.pages[mp.totalPages - 2];
    assert.ok(lastPage.pageRowCount <= secondLast.pageRowCount, 'last page should have <= rows of previous page');
  }

  // Total rows should be covered
  const totalCovered = mp.pages.reduce((sum, p) => sum + p.pageRowCount, 0);
  assert.strictEqual(totalCovered, 300, 'sum of rows across pages should equal total row count');

  // Edge: 0 rows should return 1 page with 0 rows
  const zero = calculatePageBreakMetrics({ rowCount: 0 });
  assert.strictEqual(zero.totalPages, 1, '0 rows should return 1 page');
  assert.ok(zero.singlePage, '0 rows should be singlePage');
  assert.strictEqual(zero.pages[0].pageRowCount, 0, '0 rows page should have 0 rows');

  // Edge: 1 row yields 1 page
  const one = calculatePageBreakMetrics({ rowCount: 1, requestedLayout: 'half-left' });
  assert.strictEqual(one.totalPages, 1, '1 row should return 1 page');

  // half-left with 200 rows should split into multiple pages
  const hl200 = calculatePageBreakMetrics({ rowCount: 200, requestedLayout: 'half-left' });
  assert.ok(hl200.totalPages > 1, '200 half-left rows should need multiple pages');
  assert.ok(!hl200.singlePage, '200 half-left rows should not be singlePage');
  // Each page must have rowsPerPage <= hardMaxRows=60
  hl200.pages.forEach((page, idx) => {
    assert.ok(page.pageRowCount <= 60, `page ${idx} rows ${page.pageRowCount} should not exceed hardMaxRows 60`);
  });

  console.log(`   Multi-page: 300 full-page rows → ${mp.totalPages} pages (${mp.rowsPerPage} rows/page), 200 half-left rows → ${hl200.totalPages} pages (${hl200.rowsPerPage} rows/page)`);
})();

// --- multi-page CSS and renderer assertions ---
assert.ok(rendererPrintPreviewJs.includes('calculatePageBreakMetrics'), 'renderer-print-preview should call calculatePageBreakMetrics for multi-page');
assert.ok(secondaryIndexHtml.includes('.print-preview-sheet-wrap.multi-page'), 'secondary CSS should have .multi-page class for stacked sheets');
assert.ok(secondaryIndexHtml.includes('.print-page-counter'), 'secondary CSS should have .print-page-counter for page number display');
assert.ok(rendererPrintPreviewJs.includes('pageCounterHtml'), 'renderer should generate page counter HTML');
assert.ok(rendererPrintPreviewJs.includes('multi-page'), 'renderer should handle multi-page class on wrap');
assert.ok(rendererPrintPreviewJs.includes('summaryHtml'), 'renderer should conditionally render summary on last page only');

console.log('✅ print-fit tests passed');
console.log(`   60-row half-left: rowHeight=${fit60half.rowHeightMm.toFixed(2)}mm font=${fit60half.tableFontPx.toFixed(1)}px summary=${fit60half.summaryHeightMm.toFixed(1)}mm overflow=${fit60half.overflowMm.toFixed(2)}mm`);
