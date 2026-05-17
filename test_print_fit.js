const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  resolvePrintLayout,
  calculatePrintMetrics,
  estimatePrintContentHeightMm
} = require('./print-fit');

function verifyFits(rowCount, requestedLayout = 'auto', columnsWeight = 0.72) {
  const metrics = calculatePrintMetrics({ rowCount, requestedLayout, columnsWeight });
  const estimatedHeight = estimatePrintContentHeightMm(metrics);
  assert.ok(metrics.fitsOnPage, `expected ${rowCount} rows (${requestedLayout}) to fit — overflow: ${metrics.overflowMm.toFixed(2)}mm`);
  assert.ok(estimatedHeight <= metrics.pageHeightMm + 1.0, `content height overflow for ${rowCount} rows: ${estimatedHeight.toFixed(2)}mm > ${metrics.pageHeightMm}mm`);
  return metrics;
}

// --- layout resolution ---
assert.strictEqual(resolvePrintLayout('auto', 12), 'half-left');
assert.strictEqual(resolvePrintLayout('auto', 60), 'half-left', '60 rows auto should resolve to half-left');
assert.strictEqual(resolvePrintLayout('auto', 65), 'half-left', '65 rows auto should still resolve to half-left');
assert.strictEqual(resolvePrintLayout('auto', 66), 'full-page', '66+ rows should resolve to full-page');
assert.strictEqual(resolvePrintLayout('full-page', 20), 'full-page');
assert.strictEqual(resolvePrintLayout('half-left', 70), 'half-left', 'explicit half-left should be respected');

// --- half-left: 60 rows fits ---
const fit60half = verifyFits(60, 'half-left');
assert.strictEqual(fit60half.resolvedLayout, 'half-left');
assert.strictEqual(fit60half.pageWidthMm, 95);
assert.strictEqual(fit60half.pageHeightMm, 270);
assert.ok(fit60half.rowHeightMm >= 1.65, '60-row height should not go below min');
assert.ok(fit60half.rowHeightMm <= 3.0, '60-row height should be compact');
assert.ok(fit60half.tableFontPx >= 5.0, 'table font should stay readable');
assert.ok(fit60half.summaryHeightMm >= 14, 'summary should have enough space for 5 rows');

// --- auto 60 rows → half-left ---
const fit60auto = verifyFits(60, 'auto');
assert.strictEqual(fit60auto.resolvedLayout, 'half-left', 'auto 60 rows should pick half-left');

// --- half-left smaller counts ---
const fit20 = verifyFits(20, 'auto');
assert.strictEqual(fit20.resolvedLayout, 'half-left');
assert.strictEqual(fit20.pageHeightMm, 270, 'half-left must use full A4 height');

// --- full-page still works ---
const fit50full = verifyFits(50, 'full-page');
assert.strictEqual(fit50full.resolvedLayout, 'full-page');
assert.strictEqual(fit50full.pageHeightMm, 277, 'full-page should match A4 content height with 10mm top/bottom margins');
const fit70full = verifyFits(70, 'full-page');
assert.ok(fit70full.rowHeightMm < fit50full.rowHeightMm, '70-row should compress more than 50-row on full-page');

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
assert.ok(rendererPrintPreviewJs.includes('print-overflow-warning'), 'print preview should warn before clipping rows that exceed the selected paper layout');
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
assert.ok(secondaryIndexHtml.includes('<option value="half-left">ครึ่งซ้ายของหน้า A4 (สูงเต็มหน้า)</option>'), 'secondary print selector should include half-left full-height layout');
assert.ok(secondaryIndexHtml.includes('<option value="full-page">เต็มหน้า A4</option>'), 'secondary print selector should include full-page A4 layout');
assert.ok(secondaryIndexHtml.includes('onchange="updatePrintLayout(this.value)"'), 'secondary print selector should trigger the shared print layout recalculation');
assert.ok(secondaryIndexHtml.includes('.print-sheet { width:105mm; height:297mm;'), 'secondary print sheet should use the same fixed print-sheet baseline as the main app');
assert.ok(secondaryIndexHtml.includes('.print-sheet.full-page { width:190mm; height:277mm; }'), 'secondary full-page layout should match the main app printable height');
assert.ok(secondaryIndexHtml.includes('.print-sheet.half-left { width:95mm; height:270mm; }'), 'secondary half-left layout should match the main app printable height');
assert.ok(secondaryIndexHtml.includes('@page { size:A4 portrait; margin:10mm; }'), 'secondary print CSS should use the same A4 safe margin as the main app');
assert.ok(secondaryIndexHtml.includes('body.printing-active main, body.printing-active #titlebar, body.printing-active #toast'), 'secondary print CSS should isolate print mode with printing-active like the main app');
assert.ok(secondaryIndexHtml.includes('body.printing-active .print-preview-dialog { box-shadow:none; border:none; background:transparent; padding:0; max-height:none; overflow:visible; }'), 'secondary print dialog should collapse like the main app while printing');
assert.ok(secondaryIndexHtml.includes('body.printing-active .print-sheet { box-shadow:none; }'), 'secondary print sheet should not force all layouts to center during printing');
assert.ok(secondaryIndexHtml.includes('body.printing-active .print-sheet.half-left { margin:0; }'), 'secondary half-left print sheet should stay aligned to the left edge of the printable area');
assert.ok(secondaryIndexHtml.includes('body.printing-active .print-sheet.full-page { margin:0 auto; }'), 'secondary full-page print sheet should remain centered');
assert.ok(!secondaryIndexHtml.includes('body.printing-active .print-sheet { box-shadow:none; margin:0 auto; }'), 'secondary half-left layout must not inherit centered print margin');
assert.ok(secondaryIndexHtml.includes('body.printing-active .print-preview-toolbar { display:none !important; }'), 'secondary print CSS should hide toolbar during actual printing');
assert.ok(secondaryIndexHtml.includes('body.printing-active .print-preview-modal, body.printing-active .print-preview-modal * { visibility:visible; }'), 'secondary print media CSS should reveal only the print modal while printing');
assert.ok(secondaryIndexHtml.includes('.print-table tbody tr { height:var(--print-row-height); }'), 'secondary print row height should be applied on table rows, not cells');
assert.ok(!secondaryIndexHtml.includes('height:var(--print-row-height,3mm)'), 'secondary print cells should not force a stale fixed 3mm fallback height');
assert.ok(secondaryIndexHtml.includes('table-layout:fixed'), 'secondary print table should use fixed layout to avoid horizontal overflow');
assert.ok(secondaryIndexHtml.includes('td:nth-child(2)') && secondaryIndexHtml.includes('td:nth-child(6)') && secondaryIndexHtml.includes('white-space:nowrap'), 'secondary print should keep plate and note columns on one line like the main app');
assert.ok(!secondaryIndexHtml.includes('@media print { html, body { width:210mm; height:297mm; overflow:hidden;'), 'secondary print CSS should not add extra viewport constraints that diverge from the main app');

console.log('✅ print-fit tests passed');
console.log(`   60-row half-left: rowHeight=${fit60half.rowHeightMm.toFixed(2)}mm font=${fit60half.tableFontPx.toFixed(1)}px summary=${fit60half.summaryHeightMm.toFixed(1)}mm overflow=${fit60half.overflowMm.toFixed(2)}mm`);
