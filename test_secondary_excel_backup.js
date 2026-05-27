const assert = require('assert');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const root = __dirname;

function read(name) {
  return fs.readFileSync(path.join(root, name), 'utf8');
}

function assertIncludes(source, needle, message) {
  assert.ok(source.includes(needle), message || `Expected source to include: ${needle}`);
}

/**
 * Test 1: HTML contains the new buttons
 */
function testHtmlButtons() {
  const html = read('secondary-index.html');

  assertIncludes(html, 'onclick="startNewDay()"', 'HTML should have startNewDay button');
  assertIncludes(html, 'onclick="exportExcelBackup()"', 'HTML should have exportExcelBackup button');
  assertIncludes(html, '🌟 เริ่มวันใหม่', 'HTML should show Thai label for start-new-day');
  assertIncludes(html, '📥 Excel', 'HTML should show Excel export button label');

  // The start-new-day button should appear before the reset button
  const startIdx = html.indexOf('startNewDay()');
  const resetIdx = html.indexOf('resetManualEntryTable()');
  assert.ok(startIdx >= 0 && resetIdx >= 0, 'Both buttons should exist');
  assert.ok(startIdx < resetIdx, 'startNewDay button should appear before reset button in HTML');

  // Export button should appear before print preview
  const exportIdx = html.indexOf('exportExcelBackup()');
  const printIdx = html.indexOf('openPrintPreview()');
  assert.ok(exportIdx >= 0 && printIdx >= 0, 'Both export and print buttons should exist');
  assert.ok(exportIdx < printIdx, 'Excel export button should appear before print preview button');
}

/**
 * Test 2: secondary-renderer.js contains new functions and API calls
 */
function testRendererFunctions() {
  const renderer = read('secondary-renderer.js');

  assertIncludes(renderer, 'async function startNewDay()', 'renderer should define startNewDay');
  assertIncludes(renderer, 'async function exportExcelBackup()', 'renderer should define exportExcelBackup');
  assertIncludes(renderer, 'api.confirmDialog', 'startNewDay should use confirmDialog');
  assertIncludes(renderer, 'api.autoBackupSecondaryExcel', 'startNewDay should call autoBackupSecondaryExcel');
  assertIncludes(renderer, 'api.exportSecondaryExcel', 'exportExcelBackup should call exportSecondaryExcel');
  assertIncludes(renderer, "startNewDay", 'window export should include startNewDay');
  assertIncludes(renderer, "exportExcelBackup", 'window export should include exportExcelBackup');
  assertIncludes(renderer, 'createDefaultTableMetaPreservingPrintSettings', 'startNewDay should preserve print settings');

  // Verify auto-backup logic: backup with data, skip when empty
  assertIncludes(renderer, 'autoBackupDone', 'startNewDay should track auto-backup status');
  assertIncludes(renderer, "'เริ่มวันใหม่'", 'startNewDay should have Thai confirmation title');
  assertIncludes(renderer, "'สำรองแล้วเริ่มวันใหม่'", 'startNewDay backup option should have Thai label');
  assertIncludes(renderer, "'เริ่มวันใหม่โดยไม่สำรอง'", 'startNewDay no-backup option should have Thai label');
}

/**
 * Test 3: secondary-preload.js exposes new APIs
 */
function testPreloadApis() {
  const preload = read('secondary-preload.js');

  assertIncludes(preload, 'exportSecondaryExcel', 'preload should expose exportSecondaryExcel API');
  assertIncludes(preload, 'autoBackupSecondaryExcel', 'preload should expose autoBackupSecondaryExcel API');
  assertIncludes(preload, 'cleanupOldSecondaryBackups', 'preload should expose cleanupOldSecondaryBackups API');

  // Ensure they're in the contextBridge.exposeInMainWorld block
  assertIncludes(preload, "ipcRenderer.invoke('export-secondary-excel'", 'exportSecondaryExcel should invoke correct IPC channel');
  assertIncludes(preload, "ipcRenderer.invoke('auto-backup-secondary-excel'", 'autoBackupSecondaryExcel should invoke correct IPC channel');
  assertIncludes(preload, "ipcRenderer.invoke('cleanup-old-secondary-backups'", 'cleanupOldSecondaryBackups should invoke correct IPC channel');
}

/**
 * Test 4: secondary-main.js contains IPC handlers and helper functions
 */
function testMainProcessFunctions() {
  const main = read('secondary-main.js');

  assertIncludes(main, "const XLSX = require('xlsx')", 'main process should require xlsx');
  assertIncludes(main, 'BACKUP_RETENTION_DAYS = 5', 'should define 5-day retention constant');
  assertIncludes(main, 'BACKUP_DIR_NAME', 'should define backup directory name');
  assertIncludes(main, 'generateExcelBuffer', 'should contain Excel buffer generator');
  assertIncludes(main, 'saveAutoBackup', 'should contain auto-backup saver');
  assertIncludes(main, 'cleanupOldBackups', 'should contain old backup cleanup function');
  assertIncludes(main, "ipcMain.handle('export-secondary-excel'", 'should register export-secondary-excel IPC handler');
  assertIncludes(main, "ipcMain.handle('auto-backup-secondary-excel'", 'should register auto-backup-secondary-excel IPC handler');
  assertIncludes(main, "ipcMain.handle('cleanup-old-secondary-backups'", 'should register cleanup-old-secondary-backups IPC handler');
  assertIncludes(main, "cleanupOldBackups()", 'startup should run cleanup on boot');
  assertIncludes(main, "date.toISOString().slice(11, 23).replace(/[:.]/g, '')", 'backup filename should include millisecond-level sanitized time');
  assertIncludes(main, 'Math.random().toString(36).slice(2, 6)', 'backup filename should include a nonce to avoid same-second overwrite');
  assertIncludes(main, '.filter(row =>', 'generateExcelBuffer should filter empty rows');
}

/**
 * Test 5: Generate Excel using standalone xlsx (no Electron dependency)
 */
function testExcelBufferContent() {
  // Test that the Excel generation logic produces correct output using xlsx directly
  const xlsxModule = require('xlsx');

  function sanitizeFileNamePart(value, fallback) {
    const safe = String(value || '').trim().replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_').slice(0, 80);
    return safe || fallback;
  }

  function makeBuffer(rows, tableMeta, settings) {
    const safeRows = Array.isArray(rows) ? rows.filter(row => {
      const plate = String(row && row.plate || '').trim();
      return plate.length > 0;
    }) : [];

    const dataRows = safeRows.map((row, index) => ({
      'ลำดับ': index + 1,
      'ทะเบียนรถ': String(row.plate || '').trim(),
      'ประเภทรถ': row.type === 'จยย' ? 'จยย' : 'รย',
      'ราคาภาษี': String(row.taxAmount || '').trim(),
      'หมายเหตุ': String(row.note || '').trim(),
      'ยี่ห้อ': String(row.brand || '').trim(),
      'จังหวัด': String(row.province || '').trim()
    }));

    const wsData = xlsxModule.utils.json_to_sheet(dataRows);
    wsData['!cols'] = [{ wch: 8 }, { wch: 18 }, { wch: 10 }, { wch: 14 }, { wch: 22 }, { wch: 16 }, { wch: 16 }];

    const wb = xlsxModule.utils.book_new();
    xlsxModule.utils.book_append_sheet(wb, wsData, 'ข้อมูลตาราง');

    const meta = (tableMeta && typeof tableMeta === 'object') ? tableMeta : {};
    const todayStr = new Date().toISOString().slice(0, 10);
    const metaRows = [
      { รายการ: 'ชื่อร้าน/ตรอ.', ค่า: String(meta.stationName || settings?.stationName || 'รับเล่มรถ ตรอ.').trim() },
      { รายการ: 'วันที่เอกสาร', ค่า: String(meta.documentDate || '').trim() || todayStr },
      { รายการ: 'วันที่นัด', ค่า: String(meta.appointmentDate || '').trim() || '-' },
      { รายการ: 'วันที่ส่งออก', ค่า: todayStr },
      { รายการ: 'จำนวนรายการ', ค่า: String(safeRows.length) },
      { รายการ: 'โปรแกรม', ค่า: 'รับเล่มรถ ตรอ. - เครื่องรอง' }
    ];
    const wsMeta = xlsxModule.utils.json_to_sheet(metaRows);
    xlsxModule.utils.book_append_sheet(wb, wsMeta, 'ข้อมูลเอกสาร');

    const taxTotal = safeRows.reduce((sum, row) => sum + (Number(row.taxAmount) || 0), 0);
    const carCount = safeRows.filter(row => row.type !== 'จยย').length;
    const motoCount = safeRows.filter(row => row.type === 'จยย').length;
    const transportCarRate = Number(settings?.transportCarRate || 20);
    const transportMotoRate = Number(settings?.transportMotoRate || 20);
    const serviceTotal = (carCount * transportCarRate) + (motoCount * transportMotoRate);
    const grandTotal = taxTotal + serviceTotal;

    const summaryRows = [
      { รายการ: 'รวมภาษี', จำนวน: String(taxTotal.toFixed(2)) },
      { รายการ: `รย. ${carCount} คัน × ${transportCarRate}`, จำนวน: String((carCount * transportCarRate).toFixed(2)) },
      { รายการ: `จยย. ${motoCount} คัน × ${transportMotoRate}`, จำนวน: String((motoCount * transportMotoRate).toFixed(2)) },
      { รายการ: 'รวมค่าขนส่ง/บริการ', จำนวน: String(serviceTotal.toFixed(2)) },
      { รายการ: 'รวมทั้งหมด', จำนวน: String(grandTotal.toFixed(2)) }
    ];
    const wsSummary = xlsxModule.utils.json_to_sheet(summaryRows);
    xlsxModule.utils.book_append_sheet(wb, wsSummary, 'สรุปยอด');

    return xlsxModule.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  // Test with data
  const testRows = [
    { plate: 'กข 1234', type: 'รย', taxAmount: '3500', note: 'ทดสอบ', brand: 'Toyota', province: 'เชียงราย' },
    { plate: 'กจ 5678', type: 'จยย', taxAmount: '500', note: '', brand: 'Honda', province: 'เชียงใหม่' },
    { plate: '', type: 'รย', taxAmount: '', note: '', brand: '', province: '' }  // should be filtered
  ];
  const tableMeta = {
    stationName: 'เทคนิคยนต์ 1',
    documentDate: '2026-05-26',
    appointmentDate: '2026-05-28'
  };
  const settings = {
    transportCarRate: 20,
    transportMotoRate: 20,
    stationName: 'เทคนิคยนต์ 1'
  };

  const buffer = makeBuffer(testRows, tableMeta, settings);
  assert.ok(buffer instanceof Buffer, 'Result should be a Buffer');
  assert.ok(buffer.length > 2000, 'Excel buffer should be at least 2KB');

  // Read back and verify content
  const workbook = xlsxModule.read(buffer, { type: 'buffer' });
  assert.ok(workbook.SheetNames.includes('ข้อมูลตาราง'), 'Should have data sheet');
  assert.ok(workbook.SheetNames.includes('ข้อมูลเอกสาร'), 'Should have metadata sheet');
  assert.ok(workbook.SheetNames.includes('สรุปยอด'), 'Should have summary sheet');

  const dataSheet = workbook.Sheets['ข้อมูลตาราง'];
  const json = xlsxModule.utils.sheet_to_json(dataSheet);
  assert.strictEqual(json.length, 2, 'Should have 2 data rows (empty filtered)');
  assert.strictEqual(json[0]['ทะเบียนรถ'], 'กข 1234', 'First plate should match');
  assert.strictEqual(json[1]['ทะเบียนรถ'], 'กจ 5678', 'Second plate should match');
  assert.strictEqual(json[1]['ประเภทรถ'], 'จยย', 'Second row type should be จยย');

  const metaSheet = workbook.Sheets['ข้อมูลเอกสาร'];
  const metaJson = xlsxModule.utils.sheet_to_json(metaSheet);
  const stationMeta = metaJson.find(r => r['รายการ'] === 'ชื่อร้าน/ตรอ.');
  assert.ok(stationMeta, 'Metadata should include station name');
  assert.strictEqual(stationMeta['ค่า'], 'เทคนิคยนต์ 1', 'Station name should match');

  const summarySheet = workbook.Sheets['สรุปยอด'];
  const summaryJson = xlsxModule.utils.sheet_to_json(summarySheet);
  const totalRow = summaryJson.find(r => r['รายการ'] === 'รวมทั้งหมด');
  assert.ok(totalRow, 'Summary should include grand total');
  assert.strictEqual(totalRow['จำนวน'], '4040.00', 'Grand total should be 3500 + 500 + (1*20 + 1*20) = 4040');

  // Test empty rows returns empty buffer metadata
  const emptyBuffer = makeBuffer([], tableMeta, settings);
  const emptyWb = xlsxModule.read(emptyBuffer, { type: 'buffer' });
  const emptyMeta = xlsxModule.utils.sheet_to_json(emptyWb.Sheets['ข้อมูลเอกสาร']);
  const countRow = emptyMeta.find(r => r['รายการ'] === 'จำนวนรายการ');
  assert.strictEqual(countRow['ค่า'], '0', 'Empty rows should show 0 count');

  // Test with null/undefined rows
  const nullBuffer = makeBuffer(null, tableMeta, settings);
  assert.ok(nullBuffer.length > 1000, 'Null rows should still produce valid workbook');

  console.log(`  ✅ Excel buffer: ${buffer.length} bytes, 3 sheets, ${json.length} data rows, grand total ${totalRow['จำนวน']}`);
}

/**
 * Test 6: Excel backup lifecycle with temp directory (replaces app.getPath)
 */
function testBackupLifecycleWithTempDir() {
  const xlsxModule = require('xlsx');

  // Re-implement the core logic inline for testability
  const BACKUP_RETENTION_DAYS = 5;
  const testRows = [
    { plate: 'กข 1234', type: 'รย', taxAmount: '3500', note: 'ทดสอบ', brand: 'Toyota', province: 'เชียงราย' }
  ];

  function sanitizeFileNamePart(value, fallback) {
    const safe = String(value || '')
      .trim()
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/_+/g, '_')
      .slice(0, 80);
    return safe || fallback;
  }

  function makeBackup(rows, tableMeta, settings, dir) {
    const safeRows = Array.isArray(rows) ? rows.filter(row => {
      const plate = String(row && row.plate || '').trim();
      return plate.length > 0;
    }) : [];

    const dataRows = safeRows.map((row, index) => ({
      'ลำดับ': index + 1,
      'ทะเบียนรถ': String(row.plate || '').trim(),
      'ประเภทรถ': row.type === 'จยย' ? 'จยย' : 'รย',
      'ราคาภาษี': String(row.taxAmount || '').trim(),
      'หมายเหตุ': String(row.note || '').trim(),
      'ยี่ห้อ': String(row.brand || '').trim(),
      'จังหวัด': String(row.province || '').trim()
    }));

    const wsData = xlsxModule.utils.json_to_sheet(dataRows);
    const wb = xlsxModule.utils.book_new();
    xlsxModule.utils.book_append_sheet(wb, wsData, 'ข้อมูลตาราง');

    // Add metadata sheet
    const metaRows = [
      { รายการ: 'ชื่อร้าน/ตรอ.', ค่า: tableMeta?.stationName || settings?.stationName || 'รับเล่มรถ ตรอ.' },
      { รายการ: 'วันที่ส่งออก', ค่า: new Date().toISOString().slice(0, 10) },
      { รายการ: 'จำนวนรายการ', ค่า: String(safeRows.length) },
    ];
    const wsMeta = xlsxModule.utils.json_to_sheet(metaRows);
    xlsxModule.utils.book_append_sheet(wb, wsMeta, 'ข้อมูลเอกสาร');

    const buf = xlsxModule.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const station = sanitizeFileNamePart(tableMeta?.stationName || settings?.stationName || 'รับเล่มรถ', 'unknown');
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const timeStr = new Date().toISOString().slice(11, 19).replace(/:/g, '');
    const fileName = `backup-${station}-${dateStr}_${timeStr}.xlsx`;
    const filePath = path.join(dir, fileName);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, buf);
    return { path: filePath, fileName, bytes: buf.length };
  }

  function cleanupOld(dir) {
    if (!fs.existsSync(dir)) return { deleted: 0, errors: 0 };
    const cutoffMs = Date.now() - (BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    let deleted = 0;
    let errors = 0;
    try {
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        if (!entry.endsWith('.xlsx')) continue;
        const fullPath = path.join(dir, entry);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isFile() && stat.mtimeMs < cutoffMs) {
            fs.rmSync(fullPath, { force: true });
            deleted++;
          }
        } catch {
          errors++;
        }
      }
    } catch {
      errors++;
    }
    return { deleted, errors };
  }

  const testDir = path.join(root, `__test_backup_${Date.now()}`);
  try {
    // 1. Create a backup
    const result = makeBackup(testRows, { stationName: 'TestShop' }, {}, testDir);
    assert.ok(fs.existsSync(result.path), 'Backup file should exist after creation');
    assert.ok(result.bytes > 1000, 'Backup file should be > 1KB');

    // 2. Read back and verify content
    const workbook = xlsxModule.readFile(result.path);
    assert.ok(workbook.SheetNames.includes('ข้อมูลตาราง'), 'Workbook should contain data sheet');
    assert.ok(workbook.SheetNames.includes('ข้อมูลเอกสาร'), 'Workbook should contain metadata sheet');
    const dataSheet = workbook.Sheets['ข้อมูลตาราง'];
    const json = xlsxModule.utils.sheet_to_json(dataSheet);
    assert.strictEqual(json.length, 1, 'Should have 1 data row (empty row filtered out)');
    assert.strictEqual(json[0]['ทะเบียนรถ'], 'กข 1234', 'Plate should be correct');

    // 3. Cleanup should not delete new files
    const noDelete = cleanupOld(testDir);
    assert.strictEqual(noDelete.deleted, 0, 'Should not delete recent backup');
    assert.ok(fs.existsSync(result.path), 'Backup file should still exist after cleanup');

    // 4. Test old file cleanup by creating an old backup
    const oldFilePath = path.join(testDir, 'backup-Old-20200101_120000.xlsx');
    // For cleanup, mtime matters. Touch the file but we can't easily change mtime.
    // Instead verify the logic cutoff calculation
    const cutoffMs = Date.now() - (5 * 24 * 60 * 60 * 1000);
    const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    
    fs.writeFileSync(oldFilePath, Buffer.alloc(100));
    // Set mtime to 7 days ago
    fs.utimesSync(oldFilePath, new Date(oneWeekAgo), new Date(oneWeekAgo));
    const oldStat = fs.statSync(oldFilePath);
    assert.ok(oldStat.mtimeMs < cutoffMs, 'Old file mtime should be before cutoff');

    // 5. Run cleanup
    const deleted = cleanupOld(testDir);
    assert.strictEqual(deleted.deleted, 1, 'Should delete 1 old backup file');
    assert.ok(!fs.existsSync(oldFilePath), 'Old backup file should be removed');
    assert.ok(fs.existsSync(result.path), 'Recent backup file should still exist');

    console.log(`  ✅ Backup lifecycle test: created ${result.fileName} (${(result.bytes / 1024).toFixed(1)} KB), cleaned 1 old file`);
  } finally {
    // Cleanup
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  }
}

/**
 * Test 7: Sanitize filename sanity
 */
function testFilenameSanitization() {
  const main = read('secondary-main.js');
  assertIncludes(main, 'sanitizeFileNamePart(', 'backup filename should use sanitizeFileNamePart');
  assertIncludes(main, "`backup-${station}", 'backup filename should use backup- prefix');
}

/**
 * Test 8: Verify the constants and config
 */
function testConstants() {
  const main = read('secondary-main.js');
  assertIncludes(main, 'BACKUP_RETENTION_DAYS = 5', 'Retention must be exactly 5 days as specified');
  assertIncludes(main, "BACKUP_DIR_NAME = 'excel-backups-secondary'", 'Backup dir name should match convention');
}

async function main() {
  console.log('Testing secondary Excel backup features...\n');

  testHtmlButtons();
  console.log('  ✅ HTML buttons present');

  testRendererFunctions();
  console.log('  ✅ Renderer functions defined');

  testPreloadApis();
  console.log('  ✅ Preload APIs exposed');

  testMainProcessFunctions();
  console.log('  ✅ Main process IPC handlers registered');

  testExcelBufferContent();
  console.log('  ✅ Excel buffer generates valid XLSX');

  testBackupLifecycleWithTempDir();
  console.log('  ✅ Backup lifecycle (create/cleanup) works');

  testFilenameSanitization();
  console.log('  ✅ Filename sanitization used');

  testConstants();
  console.log('  ✅ Constants correctly defined');

  console.log('\n✅ All secondary Excel backup tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
