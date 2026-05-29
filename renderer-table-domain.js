(function (global) {
  const moduleApi = {
    formatDateForDisplay(_ctx, isoDate) {
      const value = String(isoDate || '').trim();
      const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!match) return value;
      return `${match[3]}/${match[2]}/${match[1]}`;
    },

    parseDisplayDateToIso(_ctx, value) {
      const text = String(value || '').trim();
      if (!text) return '';

      const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

      const displayMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (!displayMatch) return null;

      const day = Number(displayMatch[1]);
      const month = Number(displayMatch[2]);
      const year = Number(displayMatch[3]);
      const date = new Date(year, month - 1, day);
      if (
        Number.isNaN(date.getTime()) ||
        date.getFullYear() !== year ||
        date.getMonth() !== month - 1 ||
        date.getDate() !== day
      ) {
        return null;
      }

      return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    },

    createDefaultTableMeta({ State, getTodayIsoDate }) {
      const today = getTodayIsoDate();
      return {
        stationName: State.settings.shopName || 'รับเล่มรถ ตรอ.',
        documentDate: today,
        appointmentDate: today,
        addCount: 10,
        deleteCount: 1,
        printLayout: 'auto',
        printStyle: {
          mainTitleFontPx: 9,
          headerLabelFontPx: 9,
          headerValueFontPx: 9,
          subTitleFontPx: 10,
          tableBodyFontPx: 8,
          summaryFontPx: 8,
          tableWidthPct: 100,
          verticalScalePct: 100
        }
      };
    },



    normalizePrintStyleSettings(_ctx, rawStyle = {}) {
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

    createEmptyManualEntryRow({ State, generateUUID }) {
      return {
        id: generateUUID(),
        plate: '',
        type: 'รย',
        taxAmount: '',
        note: '',
        brand: '',
        province: State.settings.province || ''
      };
    },

    normalizeTableDraft({ createDefaultTableMeta, createEmptyManualEntryRow, generateUUID }, rawDraft) {
      const baseMeta = createDefaultTableMeta();
      const draft = rawDraft && typeof rawDraft === 'object' ? rawDraft : {};
      const rows = Array.isArray(draft.rows) ? draft.rows : [];

      return {
        stationName: String(draft.stationName || baseMeta.stationName).trim() || baseMeta.stationName,
        documentDate: String(draft.documentDate || baseMeta.documentDate).trim() || baseMeta.documentDate,
        appointmentDate: String(draft.appointmentDate || baseMeta.appointmentDate).trim() || baseMeta.appointmentDate,
        addCount: Math.max(1, Number(draft.addCount) || 10),
        deleteCount: Math.max(1, Number(draft.deleteCount) || 1),
        printLayout: ['half-left', 'full-page', 'auto'].includes(String(draft.printLayout || '')) ? String(draft.printLayout) : 'auto',
        printStyle: moduleApi.normalizePrintStyleSettings({}, draft.printStyle || baseMeta.printStyle),
        rows: (rows.length > 0 ? rows : Array.from({ length: 10 }, () => createEmptyManualEntryRow())).map((row) => ({
          id: row?.id || generateUUID(),
          plate: String(row?.plate || '').trim(),
          type: row?.type === 'จยย' ? 'จยย' : 'รย',
          taxAmount: String(row?.taxAmount || '').trim(),
          note: String(row?.note || '').trim(),
          brand: String(row?.brand || '').trim(),
          province: String(row?.province || '').trim()
        }))
      };
    },

    getTableDraftPayload({ State, generateUUID }) {
      return {
        stationName: String(State.tableMeta.stationName || '').trim(),
        documentDate: String(State.tableMeta.documentDate || '').trim(),
        appointmentDate: String(State.tableMeta.appointmentDate || '').trim(),
        addCount: Math.max(1, Number(State.tableMeta.addCount) || 10),
        deleteCount: Math.max(1, Number(State.tableMeta.deleteCount) || 1),
        printLayout: ['auto', 'half-left', 'full-page'].includes(String(State.tableMeta.printLayout || '')) ? State.tableMeta.printLayout : 'auto',
        printStyle: moduleApi.normalizePrintStyleSettings({}, State.tableMeta.printStyle),
        rows: State.manualEntries.map((row) => ({
          id: row.id || generateUUID(),
          plate: String(row.plate || '').trim(),
          type: row.type === 'จยย' ? 'จยย' : 'รย',
          taxAmount: String(row.taxAmount || '').trim(),
          note: String(row.note || '').trim(),
          brand: String(row.brand || '').trim(),
          province: String(row.province || '').trim()
        }))
      };
    },

    calculateTableSummary({ State, parseMoney, TABLE_SERVICE_RATE, serviceRates }) {
      let taxTotal = 0;
      let carCount = 0;
      let motorcycleCount = 0;

      State.manualEntries.forEach((row) => {
        const hasContent = moduleApi.rowHasBusinessContent({}, row);
        if (!hasContent) return;

        taxTotal += Math.max(0, parseMoney(row.taxAmount));
        if (row.type === 'จยย') motorcycleCount += 1;
        else carCount += 1;
      });

      const normalizeRate = (value, fallback) => {
        const text = String(value ?? '').replace(/,/g, '').trim();
        if (!text) return fallback;
        const number = Number(text);
        return Number.isFinite(number) && number >= 0 ? number : fallback;
      };
      const legacyRate = normalizeRate(TABLE_SERVICE_RATE, 20);
      const rates = serviceRates && typeof serviceRates === 'object' ? serviceRates : {};
      const transportCarRate = normalizeRate(rates.transportCarRate ?? rates.carRate, legacyRate);
      const transportMotoRate = normalizeRate(rates.transportMotoRate ?? rates.motoRate, legacyRate);
      const shopCarRate = normalizeRate(rates.shopCarRate, 50);
      const shopMotoRate = normalizeRate(rates.shopMotoRate, 40);
      const serviceCount = carCount + motorcycleCount;
      const carServiceTotal = carCount * transportCarRate;
      const motorcycleServiceTotal = motorcycleCount * transportMotoRate;
      const serviceTotal = carServiceTotal + motorcycleServiceTotal;
      const shopCarServiceTotal = carCount * shopCarRate;
      const shopMotoServiceTotal = motorcycleCount * shopMotoRate;
      const shopServiceTotal = shopCarServiceTotal + shopMotoServiceTotal;

      return {
        taxTotal,
        carCount,
        motorcycleCount,
        serviceCount,
        transportCarRate,
        transportMotoRate,
        carServiceTotal,
        motorcycleServiceTotal,
        serviceTotal,
        grandTotal: taxTotal + serviceTotal,
        shopCarRate,
        shopMotoRate,
        shopCarServiceTotal,
        shopMotoServiceTotal,
        shopServiceTotal
      };
    },

    buildPrintableTableRows({ State, parseMoney }) {
      return State.manualEntries
        .map((row, index) => ({
          index: index + 1,
          plate: String(row.plate || '').trim(),
          type: row.type === 'จยย' ? 'จยย' : 'รย',
          taxAmount: parseMoney(row.taxAmount),
          note: String(row.note || '').trim(),
          brand: String(row.brand || '').trim(),
          province: String(row.province || '').trim()
        }))
        .filter((row) => row.plate || row.taxAmount || row.note || row.brand || row.province)
        .map((row, index) => ({ ...row, index: index + 1 }));
    },

    buildTableRecordsForMainList({ State, generateUUID }) {
      const appointmentDate = String(State.tableMeta.appointmentDate || '').trim();
      if (!appointmentDate) return [];

      return State.manualEntries
        .map((row) => ({
          plate: String(row.plate || '').trim(),
          province: String(row.province || '').trim(),
          type: row.type === 'จยย' ? 'จยย' : 'รย',
          brand: String(row.brand || '').trim()
        }))
        .filter((row) => row.plate)
        .map((row) => ({
          id: generateUUID(),
          ...row,
          name: '',
          phone: '',
          status: 'pending',
          importedAt: appointmentDate,
          receivedAt: null
        }));
    },

    normalizePlateKey(_ctx, value) {
      return String(value || '').replace(/\s+/g, '').toUpperCase();
    },

    rowHasBusinessContent(_ctx, row) {
      // Brand/province are helper fields that operators often bulk-fill before
      // entering a plate. Do not treat brand/province-only rows as real records,
      // otherwise selecting rows and bulk editing brand immediately paints those
      // rows with a warning/error marker even though no vehicle entry has started.
      return [row?.plate, row?.taxAmount, row?.note]
        .some((value) => String(value || '').trim() !== '');
    },

    validateManualEntries({ State, parseMoney }) {
      const issues = [];
      const byIndex = {};
      const seenPlates = new Map();
      const duplicatePairs = new Set();
      const rows = Array.isArray(State.manualEntries) ? State.manualEntries : [];

      const addIssue = (index, field, level, message) => {
        if (!byIndex[index]) byIndex[index] = { errors: [], warnings: [], status: 'empty' };
        const bucket = level === 'error' ? byIndex[index].errors : byIndex[index].warnings;
        if (bucket.some((issue) => issue.field === field && issue.message === message)) return;
        const issue = { index, field, level, message };
        issues.push(issue);
        bucket.push(issue);
      };

      rows.forEach((row, index) => {
        const hasContent = moduleApi.rowHasBusinessContent({}, row);
        if (!byIndex[index]) byIndex[index] = { errors: [], warnings: [], status: hasContent ? 'complete' : 'empty' };
        if (!hasContent) return;

        const plate = String(row?.plate || '').trim();
        const province = String(row?.province || '').trim();
        const type = row?.type === 'จยย' ? 'จยย' : (row?.type === 'รย' ? 'รย' : String(row?.type || '').trim());
        const taxText = String(row?.taxAmount || '').trim();

        if (!plate) addIssue(index, 'plate', 'error', `แถว ${index + 1}: ยังไม่ได้ใส่ทะเบียนรถ`);
        if (!['รย', 'จยย'].includes(type)) addIssue(index, 'type', 'error', `แถว ${index + 1}: ประเภทรถต้องเป็น รย. หรือ จยย.`);
        if (!province) addIssue(index, 'province', 'warning', `แถว ${index + 1}: ยังไม่ได้ใส่จังหวัด`);
        if (taxText && (!Number.isFinite(Number(String(taxText).replace(/,/g, ''))) || parseMoney(taxText) < 0)) {
          addIssue(index, 'taxAmount', 'error', `แถว ${index + 1}: ราคาภาษีต้องเป็นตัวเลข 0 ขึ้นไป`);
        }

        const plateKey = moduleApi.normalizePlateKey({}, `${plate}|${province}`);
        if (plateKey && plate) {
          if (seenPlates.has(plateKey)) {
            const firstIndex = seenPlates.get(plateKey);
            const firstPairKey = `${firstIndex}:duplicate`;
            const currentPairKey = `${index}:duplicate`;
            if (!duplicatePairs.has(firstPairKey)) {
              duplicatePairs.add(firstPairKey);
              addIssue(firstIndex, 'plate', 'error', `แถว ${firstIndex + 1}: ทะเบียนซ้ำกับแถวอื่น`);
            }
            if (!duplicatePairs.has(currentPairKey)) {
              duplicatePairs.add(currentPairKey);
              addIssue(index, 'plate', 'error', `แถว ${index + 1}: ทะเบียนซ้ำกับแถว ${firstIndex + 1}`);
            }
          } else {
            seenPlates.set(plateKey, index);
          }
        }
      });

      Object.keys(byIndex).forEach((key) => {
        const item = byIndex[key];
        if (item.errors.length > 0) item.status = 'error';
        else if (item.warnings.length > 0) item.status = 'warning';
        else if (moduleApi.rowHasBusinessContent({}, rows[Number(key)])) item.status = 'complete';
        else item.status = 'empty';
      });

      return {
        issues,
        byIndex,
        errorCount: issues.filter((issue) => issue.level === 'error').length,
        warningCount: issues.filter((issue) => issue.level !== 'error').length,
        filledCount: rows.filter((row) => moduleApi.rowHasBusinessContent({}, row)).length
      };
    },

    getManualEntrySearchIndexes({ State }, query) {
      const needle = String(query || '').trim().toLowerCase();
      const rows = Array.isArray(State.manualEntries) ? State.manualEntries : [];
      if (!needle) return rows.map((_, index) => index);

      return rows
        .map((row, index) => ({ row, index }))
        .filter(({ row, index }) => [
          String(index + 1),
          row?.plate,
          row?.type,
          row?.taxAmount,
          row?.note,
          row?.brand,
          row?.province
        ].some((value) => String(value || '').toLowerCase().includes(needle)))
        .map(({ index }) => index);
    },

    getManualEntryRowStatus({ validationResult }, index) {
      return validationResult?.byIndex?.[index]?.status || 'empty';
    }
  };

  global.RendererTableDomainModule = moduleApi;
})(window);
