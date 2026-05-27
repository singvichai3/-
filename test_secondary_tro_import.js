const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const troImport = require('./secondary-tro-import');

function run() {
  const cases = [
    ['1กข 4824 เชียงราย', '1กข 4824', 'เชียงราย'],
    ['กม 572 นครศรีธรรมราช', 'กม 572', 'นครศรีธรรมราช'],
    ['1กท 2466 ภูเก็ต', '1กท 2466', 'ภูเก็ต'],
    ['ทะเบียน 1กข-1234 จ.เชียงราย', '1กข 1234', 'เชียงราย'],
    ['ขค 9414 ระยอง', 'ขค 9414', 'ระยอง'],
    ['1กข-1234 ภก', '1กข 1234', 'ภูเก็ต'],
    ['กม-777 สข', 'กม 777', 'สงขลา'],
    ['กธ-1888 นศ', 'กธ 1888', 'นครศรีธรรมราช'],
    ['กง-7508 จบ', 'กง 7508', 'จันทบุรี'],
    ['กง-7508จบ', 'กง 7508', 'จันทบุรี']
  ];

  for (const [input, plate, province] of cases) {
    const parsed = troImport.splitPlateProvince(input);
    assert.strictEqual(parsed.ok, true, `expected ${input} to parse`);
    assert.strictEqual(parsed.plate, plate);
    assert.strictEqual(parsed.province, province);
  }

  const aoa = [
    ['ระบบรายงานผลการตรวจสภาพรถผ่านระบบสารสนเทศ'],
    ['ลำดับการตรวจ', 'เลขทะเบียน', 'ผลการตรวจ', 'จำนวนครั้งที่ตรวจ', 'เวลาที่ส่งรายงาน', 'เลขที่ใบอนุญาต', 'ชื่อ สถานตรวจสภาพรถ'],
    ['69009285811', 'คตฉ 813 เชียงราย', 'ผ่าน', '1', '22/05/2026 16:13:06', 'ชร.005/2558', 'เทคนิคยนต์ 1'],
    ['69009270132', '1กท 2466 ภูเก็ต', 'ผ่าน', '1', '22/05/2026 13:35:05', 'ชร.005/2558', 'เทคนิคยนต์ 1'],
    ['69009246837', 'กม 572 นครศรีธรรมราช', 'ผ่าน', '1', '22/05/2026 10:39:13', 'ชร.005/2558', 'เทคนิคยนต์ 1']
  ];

  const preview = troImport.extractTroRowsFromAoA(aoa);
  assert.strictEqual(preview.format, 'technic-yont');
  assert.strictEqual(preview.totalRows, 3);
  assert.strictEqual(preview.readyCount, 3);
  assert.strictEqual(preview.reviewCount, 0);
  assert.strictEqual(preview.errorCount, 0);
  assert.deepStrictEqual(preview.rows.map((row) => [row.plate, row.province]), [
    ['คตฉ 813', 'เชียงราย'],
    ['1กท 2466', 'ภูเก็ต'],
    ['กม 572', 'นครศรีธรรมราช']
  ]);
  assert.strictEqual(preview.stationName, 'เทคนิคยนต์ 1');
  assert.strictEqual(preview.rows[0].note, '', 'TRO import should not copy ผลตรวจ/เวลาส่งรายงาน into หมายเหตุ');
  assert.ok(preview.rows[0].inspectionResult, 'inspection result should remain available as metadata only');

  const banduAoA = [
    ['(ตรอ.บ้านดู่PPN ) 0956877669'],
    ['ลำดับ', 'ทะเบียน', 'ประเภท', 'ภาษี', 'เงินเพิ่ม', 'ขนส่ง', 'รวม', 'หมายเหตุ'],
    ['1', 'กท-1780 ชร', 'รย.1', '1645.5', '247.5', '20', '1893', ''],
    ['2', '2กค-4221 ชร', 'รย.12', '100', '4', '10', '104', 'ไม่เอา'],
    ['', '', '', '1745.5', '251.5', '30', '1997', '']
  ];
  const banduPreview = troImport.extractBanduRowsFromAoA(banduAoA);
  assert.strictEqual(banduPreview.format, 'bandu-ppn');
  assert.strictEqual(banduPreview.totalRows, 2);
  assert.deepStrictEqual(banduPreview.rows.map((row) => [row.plate, row.province, row.type, row.taxAmount, row.note]), [
    ['กท 1780', 'เชียงราย', 'รย', '1893', ''],
    ['2กค 4221', 'เชียงราย', 'จยย', '104', '']
  ]);
  assert.strictEqual(banduPreview.rows[0].sourceTransport, '20', 'source transport is metadata only; table transport must come from settings by type');
  assert.strictEqual(troImport.extractDateFromSheetName('08.04.69..70'), '2026-04-08');
  assert.strictEqual(troImport.extractDateFromSheetName('31.02.2569'), '', 'impossible sheet dates must not become invalid ISO dates');

  const unknownTypeAoA = [
    ['(ตรอ.บ้านดู่PPN ) 0956877669'],
    ['ลำดับ', 'ทะเบียน', 'ประเภท', 'ภาษี', 'เงินเพิ่ม', 'ขนส่ง', 'รวม', 'หมายเหตุ'],
    ['1', 'กท-1780 ชร', 'รย.99', '1645.5', '247.5', '20', '1893', '']
  ];
  const unknownTypePreview = troImport.extractBanduRowsFromAoA(unknownTypeAoA);
  assert.strictEqual(unknownTypePreview.reviewCount, 1, 'unknown vehicle types should require operator review instead of silently mapping to รย');
  assert.strictEqual(unknownTypePreview.rows[0].selected, false, 'unknown vehicle types should not be selected by default');
  assert.match(unknownTypePreview.rows[0].message, /ต้องตรวจประเภทรถ/);

  const looseHeaderAoA = [
    ['ลำดับ', 'ทะเบียนรถ', 'ประเภทย่อย', 'ค่าภาษี', 'เงินเพิ่มเติม', 'ขนส่งสุทธิ', 'รวมทั้งสิ้น'],
    ['1', 'กท-1780 ชร', 'รย.1', '1645.5', '247.5', '20', '1893']
  ];
  assert.strictEqual(troImport.detectWorksheetFormat(looseHeaderAoA), '', 'Bandu detection should not accept loose substring-only headers');

  const domainContext = { window: {} };
  domainContext.global = domainContext.window;
  vm.createContext(domainContext);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'renderer-table-domain.js'), 'utf8'), domainContext, { filename: 'renderer-table-domain.js' });
  const domain = domainContext.window.RendererTableDomainModule;
  const saveState = {
    settings: { shopName: 'ตรอ.บ้านดู่PPN', province: 'เชียงราย' },
    tableMeta: { stationName: '', documentDate: '', appointmentDate: '', addCount: 10, deleteCount: 1, printLayout: 'auto', printStyle: {} },
    manualEntries: banduPreview.rows.map((row) => ({
      plate: row.plate,
      province: row.province,
      type: row.type === 'จยย' ? 'จยย' : 'รย',
      taxAmount: row.taxAmount,
      note: row.note || '',
      brand: ''
    }))
  };
  const defaultMeta = domain.createDefaultTableMeta({ State: saveState, getTodayIsoDate: () => '2026-05-24' });
  saveState.tableMeta = { ...saveState.tableMeta, ...defaultMeta };
  saveState.tableMeta.documentDate = '2026-04-08';
  const recordsForMain = domain.buildTableRecordsForMainList({ State: saveState, generateUUID: () => 'test-id' });
  assert.strictEqual(recordsForMain.length, 2, 'Bandu rows imported into the secondary table should convert to saveable main-app records after default appointment date initialization');
  assert.ok(recordsForMain.every((row) => row.importedAt === '2026-05-24'), 'saved rows should use the initialized appointment date for importedAt');

  const banduSamplePath = '/mnt/c/Users/USER/OneDrive/Desktop/เทส/ตรอ.บ้านดู่.xlsx';
  try {
    const parsedBandu = troImport.parseTroReportWorkbook(banduSamplePath);
    assert.strictEqual(parsedBandu.format, 'bandu-ppn');
    assert.ok(parsedBandu.sheetOptions.length >= 6, 'Bandu workbook should expose date/sheet choices');
    assert.strictEqual(parsedBandu.sheetOptions[0].sheetDate, '2026-04-02');
    assert.ok(parsedBandu.sheets.some((sheet) => sheet.sheetName === '07.04.69' && sheet.totalRows === 72));
    const sheet0704 = parsedBandu.sheets.find((sheet) => sheet.sheetName === '07.04.69');
    assert.ok(sheet0704.rows.some((row) => row.rawVehicleType === 'รย.12' && row.type === 'จยย'));
    assert.ok(sheet0704.rows.some((row) => ['รย.1', 'รย.3'].includes(row.rawVehicleType) && row.type === 'รย'));
    assert.ok(sheet0704.rows.every((row) => row.note === ''), 'Bandu import must not copy unused columns into note');
  } catch (error) {
    if (!String(error.message || '').includes('ไม่พบไฟล์')) throw error;
  }

  const samplePath = '/mnt/c/Users/USER/OneDrive/Desktop/เทส/ระบบรายงานผลการตรวจสภาพรถผ่านระบบสารสนเ.xlsx';
  try {
    const parsedFile = troImport.parseTroReportWorkbook(samplePath);
    assert.strictEqual(parsedFile.totalRows, 27);
    assert.strictEqual(parsedFile.readyCount, 27);
    assert.strictEqual(parsedFile.errorCount, 0);
    assert.ok(parsedFile.rows.some((row) => row.plate === 'กม 572' && row.province === 'นครศรีธรรมราช'));
  } catch (error) {
    if (!String(error.message || '').includes('ไม่พบไฟล์')) throw error;
  }
}

run();
console.log('test_secondary_tro_import: OK');
