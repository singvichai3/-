function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function resolvePrintLayout(requestedLayout = 'auto', rowCount = 0) {
  const normalized = String(requestedLayout || '').trim();
  if (normalized === 'full-page' || normalized === 'half-left') return normalized;
  // auto: ครึ่งหน้าตลอด ยกเว้นเกิน 65 แถวถึงขยายเป็น full-page
  return Number(rowCount || 0) > 65 ? 'full-page' : 'half-left';
}

function getPageSpec(layout) {
  return layout === 'full-page'
      ? {
        layout,
        pageWidthMm: 185,
        pageHeightMm: 270,
        basePaddingMm: 5.8,
        minPaddingMm: 2.6,
        baseGapMm: 1.9,
        minGapMm: 0.65,
        baseHeaderFontPx: 9.5,
        minHeaderFontPx: 6.6,
        baseTableFontPx: 8.1,
        minTableFontPx: 4.8,
        baseSummaryFontPx: 8.6,
        minSummaryFontPx: 5.4,
        baseCellPaddingMm: 0.95,
        minCellPaddingMm: 0.18,
        headerBaseHeightMm: 9.5,
        summaryBaseHeightMm: 22,   // เพิ่มพื้นที่ summary 5 rows
        rowBaseHeightMm: 4.1,
        rowMinHeightMm: 1.9,
        preferredRows: 50,
        hardMaxRows: 80,
        columnsWeight: 0.8
      }
    : {
        layout,
        pageWidthMm: 88,
        pageHeightMm: 260,
        basePaddingMm: 3.0,
        minPaddingMm: 1.2,
        baseGapMm: 1.35,
        minGapMm: 0.38,
        baseHeaderFontPx: 8.6,
        minHeaderFontPx: 5.6,
        baseTableFontPx: 7.25,
        minTableFontPx: 4.7,
        baseSummaryFontPx: 7.8,
        minSummaryFontPx: 5.0,
        baseCellPaddingMm: 0.62,
        minCellPaddingMm: 0.12,
        headerBaseHeightMm: 7.5,
        summaryBaseHeightMm: 20,   // 5 rows สรุป × ~3.5mm ต่อ row
        rowBaseHeightMm: 3.6,
        rowMinHeightMm: 1.65,
        preferredRows: 60,         // target หลักคือ 60 แถว
        hardMaxRows: 65,
        columnsWeight: 0.72
      };
}

function estimatePrintContentHeightMm(metrics) {
  return metrics.paddingMm * 2
    + metrics.gapMm * 2
    + metrics.headerHeightMm
    + metrics.summaryHeightMm
    + (metrics.rowHeightMm * metrics.rowCount);
}

function calculatePrintMetrics({ rowCount = 0, requestedLayout = 'auto', columnsWeight = null } = {}) {
  const safeRows = Math.max(1, Number(rowCount || 0));
  const resolvedLayout = resolvePrintLayout(requestedLayout, safeRows);
  const spec = getPageSpec(resolvedLayout);

  const densityRatio = safeRows / spec.preferredRows;
  const pressure = clamp((densityRatio - 1) / 0.6, 0, 1);
  const compactness = clamp(Number(columnsWeight ?? spec.columnsWeight ?? 1), 0.60, 1.1);

  const paddingMm = (spec.basePaddingMm - ((spec.basePaddingMm - spec.minPaddingMm) * pressure)) * compactness;
  const gapMm = (spec.baseGapMm - ((spec.baseGapMm - spec.minGapMm) * pressure)) * compactness;
  const headerFontPx = (spec.baseHeaderFontPx - ((spec.baseHeaderFontPx - spec.minHeaderFontPx) * pressure)) * compactness;
  const tableFontPx = (spec.baseTableFontPx - ((spec.baseTableFontPx - spec.minTableFontPx) * pressure)) * compactness;
  const summaryFontPx = (spec.baseSummaryFontPx - ((spec.baseSummaryFontPx - spec.minSummaryFontPx) * pressure)) * compactness;
  const cellPressure = clamp(pressure + ((1 - compactness) * 1.55), 0, 1);
  const cellPaddingMm = spec.baseCellPaddingMm - ((spec.baseCellPaddingMm - spec.minCellPaddingMm) * cellPressure);
  const headerHeightMm = (spec.headerBaseHeightMm - ((spec.headerBaseHeightMm - Math.max(4.5, spec.headerBaseHeightMm * 0.65)) * pressure)) * compactness;
  const summaryHeightMm = (spec.summaryBaseHeightMm - ((spec.summaryBaseHeightMm - Math.max(14, spec.summaryBaseHeightMm * 0.72)) * pressure)) * compactness;

  const availableTableHeightMm = spec.pageHeightMm - ((paddingMm * 2) + (gapMm * 2) + headerHeightMm + summaryHeightMm);
  const rawRowHeightMm = availableTableHeightMm / safeRows;
  const rowComfortMaxMm = ((spec.rowBaseHeightMm - ((spec.rowBaseHeightMm - (spec.rowMinHeightMm + 0.7)) * pressure)) * compactness);
  const rowHeightMm = clamp(Math.min(rawRowHeightMm, rowComfortMaxMm), spec.rowMinHeightMm, spec.rowBaseHeightMm);

  const estimatedHeightMm = (paddingMm * 2) + (gapMm * 2) + headerHeightMm + summaryHeightMm + (rowHeightMm * safeRows);
  const overflowMm = Math.max(0, estimatedHeightMm - spec.pageHeightMm);
  const fitsOnPage = overflowMm <= 0.8 && safeRows <= spec.hardMaxRows;

  return {
    resolvedLayout,
    rowCount: safeRows,
    pageWidthMm: spec.pageWidthMm,
    pageHeightMm: spec.pageHeightMm,
    paddingMm,
    gapMm,
    headerFontPx,
    tableFontPx,
    summaryFontPx,
    cellPaddingMm,
    headerHeightMm,
    summaryHeightMm,
    rowHeightMm,
    estimatedHeightMm,
    overflowMm,
    fitsOnPage,
    densityRatio,
    pressure
  };
}

const exported = {
  clamp,
  resolvePrintLayout,
  getPageSpec,
  calculatePrintMetrics,
  estimatePrintContentHeightMm
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = exported;
}

if (typeof window !== 'undefined') {
  window.PrintFit = exported;
}
