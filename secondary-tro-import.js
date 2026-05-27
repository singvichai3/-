(function (global) {
  const THAI_PROVINCES = [
    'กรุงเทพมหานคร','กระบี่','กาญจนบุรี','กาฬสินธุ์','กำแพงเพชร','ขอนแก่น','จันทบุรี','ฉะเชิงเทรา','ชลบุรี','ชัยนาท','ชัยภูมิ','ชุมพร','เชียงราย','เชียงใหม่','ตรัง','ตราด','ตาก','นครนายก','นครปฐม','นครพนม','นครราชสีมา','นครศรีธรรมราช','นครสวรรค์','นนทบุรี','นราธิวาส','น่าน','บึงกาฬ','บุรีรัมย์','ปทุมธานี','ประจวบคีรีขันธ์','ปราจีนบุรี','ปัตตานี','พระนครศรีอยุธยา','พะเยา','พังงา','พัทลุง','พิจิตร','พิษณุโลก','เพชรบุรี','เพชรบูรณ์','แพร่','ภูเก็ต','มหาสารคาม','มุกดาหาร','แม่ฮ่องสอน','ยโสธร','ยะลา','ร้อยเอ็ด','ระนอง','ระยอง','ราชบุรี','ลพบุรี','ลำปาง','ลำพูน','เลย','ศรีสะเกษ','สกลนคร','สงขลา','สตูล','สมุทรปราการ','สมุทรสงคราม','สมุทรสาคร','สระแก้ว','สระบุรี','สิงห์บุรี','สุโขทัย','สุพรรณบุรี','สุราษฎร์ธานี','สุรินทร์','หนองคาย','หนองบัวลำภู','อ่างทอง','อำนาจเจริญ','อุดรธานี','อุตรดิตถ์','อุทัยธานี','อุบลราชธานี'
  ];

  const PROVINCE_ALIASES = new Map([
    ['กรุงเทพ', 'กรุงเทพมหานคร'],
    ['กทม', 'กรุงเทพมหานคร'],
    ['กทม.', 'กรุงเทพมหานคร'],
    ['กท', 'กรุงเทพมหานคร'],
    ['กบ', 'กระบี่'],
    ['กจ', 'กาญจนบุรี'],
    ['กส', 'กาฬสินธุ์'],
    ['กพ', 'กำแพงเพชร'],
    ['ขก', 'ขอนแก่น'],
    ['จบ', 'จันทบุรี'],
    ['ฉช', 'ฉะเชิงเทรา'],
    ['ชบ', 'ชลบุรี'],
    ['ชน', 'ชัยนาท'],
    ['ชย', 'ชัยภูมิ'],
    ['ชพ', 'ชุมพร'],
    ['ชร', 'เชียงราย'],
    ['ชม', 'เชียงใหม่'],
    ['ตง', 'ตรัง'],
    ['ตร', 'ตราด'],
    ['ตก', 'ตาก'],
    ['นย', 'นครนายก'],
    ['นฐ', 'นครปฐม'],
    ['นพ', 'นครพนม'],
    ['นม', 'นครราชสีมา'],
    ['นศ', 'นครศรีธรรมราช'],
    ['นว', 'นครสวรรค์'],
    ['นบ', 'นนทบุรี'],
    ['นธ', 'นราธิวาส'],
    ['นน', 'น่าน'],
    ['บก', 'บึงกาฬ'],
    ['บร', 'บุรีรัมย์'],
    ['ปท', 'ปทุมธานี'],
    ['ปข', 'ประจวบคีรีขันธ์'],
    ['ปจ', 'ปราจีนบุรี'],
    ['ปน', 'ปัตตานี'],
    ['อย', 'พระนครศรีอยุธยา'],
    ['พย', 'พะเยา'],
    ['พง', 'พังงา'],
    ['พท', 'พัทลุง'],
    ['พจ', 'พิจิตร'],
    ['พล', 'พิษณุโลก'],
    ['พบ', 'เพชรบุรี'],
    ['พช', 'เพชรบูรณ์'],
    ['พร', 'แพร่'],
    ['ภก', 'ภูเก็ต'],
    ['มค', 'มหาสารคาม'],
    ['มห', 'มุกดาหาร'],
    ['มส', 'แม่ฮ่องสอน'],
    ['ยส', 'ยโสธร'],
    ['ยล', 'ยะลา'],
    ['รอ', 'ร้อยเอ็ด'],
    ['รน', 'ระนอง'],
    ['รย', 'ระยอง'],
    ['รบ', 'ราชบุรี'],
    ['ลบ', 'ลพบุรี'],
    ['ลป', 'ลำปาง'],
    ['ลพ', 'ลำพูน'],
    ['ลย', 'เลย'],
    ['ศก', 'ศรีสะเกษ'],
    ['สน', 'สกลนคร'],
    ['สข', 'สงขลา'],
    ['สต', 'สตูล'],
    ['สป', 'สมุทรปราการ'],
    ['สส', 'สมุทรสงคราม'],
    ['สค', 'สมุทรสาคร'],
    ['สก', 'สระแก้ว'],
    ['สบ', 'สระบุรี'],
    ['สห', 'สิงห์บุรี'],
    ['สท', 'สุโขทัย'],
    ['สพ', 'สุพรรณบุรี'],
    ['สฎ', 'สุราษฎร์ธานี'],
    ['สร', 'สุรินทร์'],
    ['นค', 'หนองคาย'],
    ['นภ', 'หนองบัวลำภู'],
    ['อท', 'อ่างทอง'],
    ['อจ', 'อำนาจเจริญ'],
    ['อด', 'อุดรธานี'],
    ['อต', 'อุตรดิตถ์'],
    ['อน', 'อุทัยธานี'],
    ['อบ', 'อุบลราชธานี'],
    ['อยุธยา', 'พระนครศรีอยุธยา'],
    ['โคราช', 'นครราชสีมา']
  ]);

  const PROVINCE_MATCHERS = [...THAI_PROVINCES, ...PROVINCE_ALIASES.keys()]
    .sort((left, right) => right.length - left.length);

  function normalizeWhitespace(value) {
    return String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[\t\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeProvince(value) {
    const raw = normalizeWhitespace(value).trim();
    if (PROVINCE_ALIASES.has(raw)) return PROVINCE_ALIASES.get(raw);
    const text = raw.replace(/^จ\.?\s*/, '').trim();
    return PROVINCE_ALIASES.get(text) || text;
  }

  function normalizePlateText(value) {
    return normalizeWhitespace(value)
      .replace(/^ทะเบียน(?:รถ)?\s*/i, '')
      .replace(/[–—−]/g, '-')
      .replace(/\s*-\s*/g, ' ')
      .replace(/^(?:จ\.?\s*)/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function splitPlateProvince(rawValue) {
    const original = normalizeWhitespace(rawValue);
    if (!original) {
      return { ok: false, raw: '', plate: '', province: '', status: 'error', message: 'ไม่มีข้อมูลทะเบียน' };
    }

    const cleaned = original
      .replace(/^ทะเบียน(?:รถ)?\s*/i, '')
      .replace(/จังหวัด\s*/g, '')
      .replace(/\s+จ\.\s*/g, ' ')
      .replace(/^จ\.\s*/g, '')
      .replace(/[–—−]/g, '-')
      .trim();

    for (const provinceName of PROVINCE_MATCHERS) {
      const escaped = provinceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`(^|\\s|\\d)(${escaped})\\s*$`, 'u');
      const match = cleaned.match(pattern);
      if (!match) continue;
      const province = normalizeProvince(match[2]);
      const provinceStart = match.index + match[1].length;
      const plate = normalizePlateText(cleaned.slice(0, provinceStart).trim());
      if (!plate) {
        return { ok: false, raw: original, plate: '', province, status: 'error', message: 'พบจังหวัดแต่ไม่พบทะเบียน' };
      }
      return { ok: true, raw: original, plate, province, status: 'ready', message: 'พร้อมนำเข้า' };
    }

    const fallbackPlate = normalizePlateText(cleaned);
    return {
      ok: Boolean(fallbackPlate),
      raw: original,
      plate: fallbackPlate,
      province: '',
      status: fallbackPlate ? 'review' : 'error',
      message: fallbackPlate ? 'ไม่พบจังหวัดจากท้ายข้อความ' : 'ไม่พบทะเบียน'
    };
  }

  function findHeaderRow(rows) {
    const limit = Math.min(rows.length, 20);
    for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
      const row = rows[rowIndex] || [];
      const plateColumnIndex = row.findIndex((cell) => normalizeWhitespace(cell).includes('เลขทะเบียน'));
      if (plateColumnIndex >= 0) {
        return { rowIndex, plateColumnIndex, headers: row.map(normalizeWhitespace) };
      }
    }
    return null;
  }

  function findBanduHeaderRow(rows) {
    const required = ['ลำดับ', 'ทะเบียน', 'ประเภท', 'ภาษี', 'เงินเพิ่ม', 'ขนส่ง', 'รวม'];
    const limit = Math.min(rows.length, 20);
    for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
      const headers = (rows[rowIndex] || []).map(normalizeWhitespace);
      const findStrictHeader = (name) => headers.findIndex((header) => header === name);
      const hasRequired = required.every((name) => findStrictHeader(name) >= 0);
      if (!hasRequired) continue;
      const columnMap = {};
      for (const name of required.concat(['หมายเหตุ'])) {
        columnMap[name] = findStrictHeader(name);
      }
      const mappedColumns = required.map((name) => columnMap[name]);
      if (new Set(mappedColumns).size !== required.length) continue;
      return { rowIndex, headers, columnMap };
    }
    return null;
  }

  function findColumn(headers, keywords) {
    return headers.findIndex((header) => keywords.some((keyword) => String(header || '').includes(keyword)));
  }

  function normalizeNumberText(value) {
    const text = normalizeWhitespace(value).replace(/,/g, '');
    if (!text) return '';
    const number = Number(text);
    if (!Number.isFinite(number)) return '';
    return String(Math.round(number * 100) / 100);
  }

  function mapBanduVehicleType(value) {
    const text = normalizeWhitespace(value).replace(/\s+/g, '');
    if (text === 'รย.12' || text === 'รย12') return 'จยย';
    if (['รย.1', 'รย.2', 'รย.3', 'รย1', 'รย2', 'รย3'].includes(text)) return 'รย';
    return '';
  }

  function isValidIsoDate(year, month, day) {
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }

  function extractDateFromSheetName(sheetName) {
    const text = normalizeWhitespace(sheetName);
    const match = text.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
    if (!match) return '';
    const day = Number(match[1]);
    const month = Number(match[2]);
    let year = Number(match[3]);
    if (!day || !month || month > 12) return '';
    if (year < 100) year += 2500;
    if (year > 2400) year -= 543;
    if (year < 1900 || year > 2200) return '';
    if (!isValidIsoDate(year, month, day)) return '';
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function summarizeRows(importedRows, extra = {}) {
    const readyCount = importedRows.filter((row) => row.status === 'ready').length;
    const reviewCount = importedRows.filter((row) => row.status === 'review').length;
    const errorCount = importedRows.filter((row) => row.status === 'error').length;
    return { ...extra, totalRows: importedRows.length, readyCount, reviewCount, errorCount, rows: importedRows };
  }

  function extractTroRowsFromAoA(rows, options = {}) {
    const header = findHeaderRow(rows);
    if (!header) {
      throw new Error('ไม่พบหัวตาราง “เลขทะเบียน” ในไฟล์ Excel');
    }

    const maxRows = Math.max(1, Math.min(Number(options.maxRows || 1000), 5000));
    const resultCol = findColumn(header.headers, ['ผลการตรวจ']);
    const sentAtCol = findColumn(header.headers, ['เวลาที่ส่งรายงาน', 'วันที่', 'เวลา']);
    const stationCol = findColumn(header.headers, ['ชื่อ สถานตรวจสภาพรถ', 'สถานตรวจสภาพรถ', 'ตรอ']);
    const licenseCol = findColumn(header.headers, ['เลขที่ใบอนุญาต']);
    const inspectionIdCol = findColumn(header.headers, ['ลำดับการตรวจ']);
    const importedRows = [];

    for (let index = header.rowIndex + 1; index < rows.length && importedRows.length < maxRows; index += 1) {
      const row = rows[index] || [];
      const rawPlate = normalizeWhitespace(row[header.plateColumnIndex]);
      if (!rawPlate) continue;
      const parsed = splitPlateProvince(rawPlate);
      const inspectionResult = normalizeWhitespace(resultCol >= 0 ? row[resultCol] : '');
      const sentAt = normalizeWhitespace(sentAtCol >= 0 ? row[sentAtCol] : '');
      const stationName = normalizeWhitespace(stationCol >= 0 ? row[stationCol] : '');
      const licenseNo = normalizeWhitespace(licenseCol >= 0 ? row[licenseCol] : '');
      const inspectionId = normalizeWhitespace(inspectionIdCol >= 0 ? row[inspectionIdCol] : '');
      importedRows.push({
        id: `tro-row-${index + 1}-${importedRows.length + 1}`,
        sourceRow: index + 1,
        raw: parsed.raw,
        plate: parsed.plate,
        province: parsed.province,
        type: 'รย',
        taxAmount: '',
        brand: '',
        note: '',
        inspectionResult,
        sentAt,
        stationName,
        licenseNo,
        inspectionId,
        selected: parsed.ok,
        status: parsed.status,
        message: parsed.message
      });
    }

    const stations = Array.from(new Set(importedRows.map((row) => row.stationName).filter(Boolean)));
    return summarizeRows(importedRows, {
      format: 'technic-yont',
      formatLabel: 'ตรอ.เทคนิคยนต์',
      headerRow: header.rowIndex + 1,
      plateColumn: header.plateColumnIndex + 1,
      stationName: stations[0] || ''
    });
  }

  function extractBanduRowsFromAoA(rows, options = {}) {
    const header = findBanduHeaderRow(rows);
    if (!header) {
      throw new Error('ไม่พบหัวตาราง ตรอ.บ้านดู่ “ลำดับ/ทะเบียน/ประเภท/ภาษี/เงินเพิ่ม/ขนส่ง/รวม” ในไฟล์ Excel');
    }

    const maxRows = Math.max(1, Math.min(Number(options.maxRows || 1000), 5000));
    const importedRows = [];
    const col = header.columnMap;
    const stationHeaderText = normalizeWhitespace(rows.slice(0, header.rowIndex).map((row) => row.join(' ')).join(' '));

    for (let index = header.rowIndex + 1; index < rows.length && importedRows.length < maxRows; index += 1) {
      const row = rows[index] || [];
      const sequence = normalizeWhitespace(row[col['ลำดับ']]);
      const rawPlate = normalizeWhitespace(row[col['ทะเบียน']]);
      if (!/^\d+$/.test(sequence) || !rawPlate) continue;
      const parsed = splitPlateProvince(rawPlate);
      const rawVehicleType = normalizeWhitespace(row[col['ประเภท']]);
      const type = mapBanduVehicleType(rawVehicleType);
      const typeNeedsReview = !type;
      const taxAmount = normalizeNumberText(row[col['รวม']]);
      const rowStatus = typeNeedsReview && parsed.status !== 'error' ? 'review' : parsed.status;
      const rowSelected = parsed.ok && !typeNeedsReview;
      importedRows.push({
        id: `bandu-row-${index + 1}-${importedRows.length + 1}`,
        sourceRow: index + 1,
        raw: parsed.raw,
        plate: parsed.plate,
        province: parsed.province,
        type: type || 'รย',
        rawVehicleType,
        taxAmount,
        brand: '',
        note: '',
        sourceTax: normalizeNumberText(row[col['ภาษี']]),
        sourcePenalty: normalizeNumberText(row[col['เงินเพิ่ม']]),
        sourceTransport: normalizeNumberText(row[col['ขนส่ง']]),
        sourceTotal: taxAmount,
        stationName: stationHeaderText,
        selected: rowSelected,
        status: rowStatus,
        message: typeNeedsReview
          ? `ต้องตรวจประเภทรถ (${rawVehicleType || 'ไม่ระบุ'}) ก่อนนำเข้า`
          : (parsed.ok ? `พร้อมนำเข้า (${rawVehicleType || 'ไม่ระบุ'} → ${type}, ราคาภาษี=${taxAmount || '0'})` : parsed.message)
      });
    }

    return summarizeRows(importedRows, {
      format: 'bandu-ppn',
      formatLabel: 'ตรอ.บ้านดู่ PPN',
      headerRow: header.rowIndex + 1,
      plateColumn: (col['ทะเบียน'] || 0) + 1,
      stationName: stationHeaderText.includes('ตรอ.บ้านดู่') ? 'ตรอ.บ้านดู่ PPN' : ''
    });
  }

  function detectWorksheetFormat(rows) {
    if (findBanduHeaderRow(rows)) return 'bandu-ppn';
    if (findHeaderRow(rows)) return 'technic-yont';
    return '';
  }

  function extractRowsByDetectedFormat(rows, options = {}) {
    const format = options.format || detectWorksheetFormat(rows);
    if (format === 'bandu-ppn') return extractBanduRowsFromAoA(rows, options);
    return extractTroRowsFromAoA(rows, options);
  }

  function parseTroReportWorkbook(filePath, options = {}) {
    if (typeof require !== 'function') throw new Error('parseTroReportWorkbook ใช้ได้ใน main process เท่านั้น');
    const fs = require('fs');
    const path = require('path');
    const XLSX = require('xlsx');
    if (!fs.existsSync(filePath)) throw new Error('ไม่พบไฟล์ที่เลือก');
    const resolvedPath = path.resolve(filePath);
    if (!/\.(xlsx|xls)$/i.test(resolvedPath)) throw new Error('รองรับเฉพาะไฟล์ Excel .xlsx หรือ .xls');
    const stat = fs.statSync(resolvedPath);
    const maxBytes = Number(options.maxBytes || 25 * 1024 * 1024);
    if (stat.size > maxBytes) throw new Error('ไฟล์ใหญ่เกินกำหนด กรุณาใช้ไฟล์ไม่เกิน 25 MB');
    let workbook;
    try {
      const sheetList = XLSX.readFile(resolvedPath, { bookSheets: true });
      if (!sheetList.SheetNames.length) throw new Error('ไฟล์ Excel ไม่มีชีตข้อมูล');
      if (sheetList.SheetNames.length > 30) throw new Error('ไฟล์ Excel มีจำนวนชีตมากเกินกำหนด');
      workbook = XLSX.readFile(resolvedPath, { cellDates: false, raw: false });
    } catch (error) {
      if (String(error.message || '').includes('มากเกินกำหนด') || String(error.message || '').includes('ไม่มีชีตข้อมูล')) throw error;
      throw new Error('อ่านไฟล์ Excel ไม่สำเร็จ กรุณาตรวจว่าไฟล์ไม่เสียหายและเป็นไฟล์ .xlsx/.xls จริง');
    }
    if (!workbook.SheetNames.length) throw new Error('ไฟล์ Excel ไม่มีชีตข้อมูล');

    const previews = [];
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false, blankrows: false });
      if (rows.some((row) => Array.isArray(row) && row.length > 80)) {
        throw new Error('ไฟล์ Excel มีจำนวนคอลัมน์มากเกินกำหนด');
      }
      const format = detectWorksheetFormat(rows);
      if (!format) continue;
      const parsedSheet = extractRowsByDetectedFormat(rows, { ...options, format });
      previews.push({ ...parsedSheet, sheetName, sheetDate: extractDateFromSheetName(sheetName) });
    }
    if (!previews.length) throw new Error('ไม่พบชีตที่รองรับในไฟล์ Excel');

    const requestedSheetName = normalizeWhitespace(options.sheetName);
    const parsed = previews.find((preview) => requestedSheetName && preview.sheetName === requestedSheetName) || previews[0];
    return {
      ...parsed,
      fileName: path.basename(filePath),
      sheetName: parsed.sheetName,
      sheetDate: parsed.sheetDate,
      sheetOptions: previews.map((preview) => ({
        sheetName: preview.sheetName,
        sheetDate: preview.sheetDate,
        totalRows: preview.totalRows,
        readyCount: preview.readyCount,
        reviewCount: preview.reviewCount,
        errorCount: preview.errorCount,
        format: preview.format,
        formatLabel: preview.formatLabel
      })),
      sheets: previews,
      fileSize: stat.size,
      importedAt: new Date().toISOString()
    };
  }

  const api = {
    THAI_PROVINCES,
    splitPlateProvince,
    extractTroRowsFromAoA,
    extractBanduRowsFromAoA,
    extractDateFromSheetName,
    detectWorksheetFormat,
    parseTroReportWorkbook
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.SecondaryTroImportModule = api;
})(typeof window !== 'undefined' ? window : globalThis);
