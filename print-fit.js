function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function resolvePrintLayout(requestedLayout = 'auto', rowCount = 0) {
  const normalized = String(requestedLayout || '').trim();
  if (normalized === 'full-page' || normalized === 'half-left') return normalized;
  const safeRows = Math.max(1, Number(rowCount || 0));
  const halfSpec = getPageSpec('half-left');
  if (safeRows > halfSpec.hardMaxRows) return 'full-page';
  const halfMinOverhead = (halfSpec.minPaddingMm * 2)
    + (halfSpec.minGapMm * 2)
    + Math.max(4.5, halfSpec.headerBaseHeightMm * 0.65)
    + Math.max(14, halfSpec.summaryBaseHeightMm * 0.72);
  const halfTableSpace = halfSpec.pageHeightMm - halfMinOverhead;
  return safeRows * halfSpec.rowMinHeightMm <= halfTableSpace ? 'half-left' : 'full-page';
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
        // Half-left means the left side of an A4 sheet, but use a conservative
        // real-printer box so Windows drivers do not clip at the selected paper edge.
        pageWidthMm: 88,
        pageHeightMm: 260,
        basePaddingMm: 4.8,
        minPaddingMm: 2.4,
        baseGapMm: 1.9,
        minGapMm: 0.65,
        baseHeaderFontPx: 9.2,
        minHeaderFontPx: 5.8,
        baseTableFontPx: 8.0,
        minTableFontPx: 4.8,
        baseSummaryFontPx: 8.2,
        minSummaryFontPx: 5.2,
        baseCellPaddingMm: 0.72,
        minCellPaddingMm: 0.16,
        headerBaseHeightMm: 7.8,
        summaryBaseHeightMm: 18,   // 5 rows สรุปแบบ compact
        rowBaseHeightMm: 3.2,
        rowMinHeightMm: 1.65,
        preferredRows: 55,
        hardMaxRows: 60,
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
  const effectiveColumnsWeight = clamp(Number(columnsWeight ?? spec.columnsWeight ?? 1), 0.60, 1.0);

  const paddingMm = spec.basePaddingMm - ((spec.basePaddingMm - spec.minPaddingMm) * pressure);
  const gapMm = spec.baseGapMm - ((spec.baseGapMm - spec.minGapMm) * pressure);
  const headerFontPx = spec.baseHeaderFontPx - ((spec.baseHeaderFontPx - spec.minHeaderFontPx) * pressure);
  const tableFontPx = spec.baseTableFontPx - ((spec.baseTableFontPx - spec.minTableFontPx) * pressure);
  const summaryFontPx = spec.baseSummaryFontPx - ((spec.baseSummaryFontPx - spec.minSummaryFontPx) * pressure);
  const cellPaddingMm = spec.baseCellPaddingMm - ((spec.baseCellPaddingMm - spec.minCellPaddingMm) * pressure);
  const headerHeightMm = spec.headerBaseHeightMm - ((spec.headerBaseHeightMm - Math.max(4.5, spec.headerBaseHeightMm * 0.65)) * pressure);
  const summaryHeightMm = spec.summaryBaseHeightMm - ((spec.summaryBaseHeightMm - Math.max(14, spec.summaryBaseHeightMm * 0.72)) * pressure);

  const fixedHeightMm = (paddingMm * 2) + (gapMm * 2) + headerHeightMm + summaryHeightMm;
  const availableForRowsMm = spec.pageHeightMm - fixedHeightMm;
  const rawRowHeightMm = availableForRowsMm / safeRows;

  let rowHeightMm;
  let estimatedHeightMm;
  let overflowMm;
  let fitsOnPage;

  if (rawRowHeightMm < spec.rowMinHeightMm || safeRows > spec.hardMaxRows) {
    rowHeightMm = spec.rowMinHeightMm;
    estimatedHeightMm = fixedHeightMm + (rowHeightMm * safeRows);
    overflowMm = Math.max(0, estimatedHeightMm - spec.pageHeightMm);
    fitsOnPage = false;
  } else if (rawRowHeightMm > spec.rowBaseHeightMm) {
    rowHeightMm = spec.rowBaseHeightMm;
    estimatedHeightMm = fixedHeightMm + (rowHeightMm * safeRows);
    overflowMm = 0;
    fitsOnPage = true;
  } else {
    rowHeightMm = rawRowHeightMm;
    estimatedHeightMm = spec.pageHeightMm;
    overflowMm = 0;
    fitsOnPage = true;
  }

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
    pressure,
    columnsWeight: effectiveColumnsWeight
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
