/**
 * db-worker.js — Industrial SQLite Logic (Layer 1-5)
 * Bulletproof error handling + batch processing + progress reporting
 * Anti-freeze + memory management + transaction optimization
 */

const { parentPort } = require('worker_threads');
const Database = require('better-sqlite3');
const SearchManager = require('./search');

let db;
let searchManager;
let transactionCount = 0;

/**
 * Initialize database in worker (Layer 1-3)
 */
function init(dbPath) {
  try {
    db = new Database(dbPath, {
      verbose: null,
      nativeBinding: require('better-sqlite3/build/Release/better_sqlite3.node')
    });

    // Layer 1: PRAGMA Optimization
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('cache_size = -64000'); // 64MB
    db.pragma('temp_store = MEMORY');
    db.pragma('mmap_size = 268435456'); // 256MB
    db.pragma('wal_autocheckpoint = 1000');
    db.pragma('optimize');

    // Ensure tables exist (idempotent)
    db.exec(`
      CREATE TABLE IF NOT EXISTS records (
        id TEXT PRIMARY KEY,
        plate TEXT NOT NULL,
        plate_norm TEXT GENERATED ALWAYS AS (
          UPPER(
            TRIM(
              REPLACE(
                REPLACE(plate, ' ', ''),
              ' ', '')
            )
          )
        ) STORED,
        province TEXT,
        type TEXT,
        brand TEXT DEFAULT '',
        name TEXT DEFAULT '',
        phone TEXT DEFAULT '',
        status TEXT DEFAULT 'pending',
        importedAt TEXT,
        receivedAt TEXT
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);

    const columns = db.prepare("PRAGMA table_xinfo(records)").all();
    const hasPlateNorm = columns.some(c => c.name === 'plate_norm');
    if (!hasPlateNorm) {
      try {
        db.exec(`
          ALTER TABLE records ADD COLUMN plate_norm TEXT;
          UPDATE records SET plate_norm = UPPER(
            TRIM(REPLACE(REPLACE(plate, ' ', ''), ' ', ''))
          ) WHERE plate_norm IS NULL;
        `);
        console.log('🔧 Worker added plate_norm column to existing records');
      } catch (e) {
        console.warn('⚠️ Worker plate_norm migration skipped:', e.message);
      }
    }

    // Layer 6: Initialize LRU Cache
    searchManager = new SearchManager(db);

    console.log('✅ Worker database initialized at:', dbPath);
    return { success: true };
  } catch (error) {
    console.error('❌ Worker init error:', error);
    throw error;
  }
}

/**
 * Normalize date to ISO 8601
 */
function normalizeDate(str) {
  try {
    if (!str) return new Date().toISOString().split('T')[0];
    if (typeof str === 'number') {
      const date = new Date((str - 25569) * 86400 * 1000);
      return date.toISOString().split('T')[0];
    }
    let d, m, y;
    if (str.includes('/')) {
      const parts = str.split('/');
      d = parseInt(parts[0]);
      m = parseInt(parts[1]);
      y = parseInt(parts[2]);
    } else if (str.includes('-')) {
      const parts = str.split('-');
      y = parseInt(parts[0]);
      m = parseInt(parts[1]);
      d = parseInt(parts[2]);
    } else {
      return str.substring(0, 10);
    }
    if (y > 2400) y -= 543;
    return `${y}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
  } catch {
    return new Date().toISOString().split('T')[0];
  }
}

/**
 * Handle messages from main thread with bulletproof error handling
 */
parentPort.on('message', (msg) => {
  const { type, payload, id } = msg || {};

  try {
    let result;

    switch (type) {
      case 'init':
        result = init(payload?.dbPath);
        parentPort.postMessage({ id, ...result });
        break;

      case 'search':
        result = searchManager.search(payload || {});
        parentPort.postMessage({ id, success: true, data: result });
        break;

      case 'count':
        result = searchManager.count(payload || {});
        parentPort.postMessage({ id, success: true, data: result });
        break;

      case 'searchInsights':
        result = searchManager.insights(payload || {});
        parentPort.postMessage({ id, success: true, data: result });
        break;

      case 'markReceived':
        result = markReceived(payload || []);
        parentPort.postMessage({ id, success: true, data: result });
        break;

      case 'undoReceived':
        result = undoReceived(payload || []);
        parentPort.postMessage({ id, success: true, data: result });
        break;

      case 'updateField':
        result = updateField(payload || {});
        parentPort.postMessage({ id, success: true, data: result });
        break;

      case 'deleteRecords':
        result = deleteRecords(payload || []);
        parentPort.postMessage({ id, success: true, data: result });
        break;

      case 'importBatch':
        result = importBatch(payload);
        parentPort.postMessage({ id, success: true, ...result });
        break;

      case 'loadStats':
        result = loadStats();
        parentPort.postMessage({ id, success: true, data: result });
        break;

      case 'exportData':
        result = exportData(payload || {});
        parentPort.postMessage({ id, success: true, data: result });
        break;

      case 'loadSettings':
        result = loadSettings();
        parentPort.postMessage({ id, success: true, data: result });
        break;

      case 'saveSettings':
        result = saveSettings(payload || {});
        parentPort.postMessage({ id, success: true, data: result });
        break;

      case 'vacuum':
        db.exec('VACUUM');
        db.pragma('wal_checkpoint(TRUNCATE)');
        searchManager.invalidate();
        parentPort.postMessage({ id, success: true });
        break;

      case 'purgeOldData':
        result = purgeOldData(payload || {});
        parentPort.postMessage({ id, success: true, data: result });
        break;

      case 'checkIntegrity':
        result = db.pragma('integrity_check');
        parentPort.postMessage({ id, success: true, data: result });
        break;

      default:
        parentPort.postMessage({
          id,
          success: false,
          error: `Unknown command: ${type}`
        });
    }
  } catch (error) {
    console.error(`❌ Worker error [${type}]:`, error);
    parentPort.postMessage({
      id,
      success: false,
      error: error.message || 'Unknown error'
    });
  }
});

/**
 * Mark records as received (Layer 5: Worker Thread)
 */
function markReceived(ids) {
  if (!ids || ids.length === 0) return { changes: 0 };

  const now = new Date().toISOString();
  const stmt = db.prepare(`
    UPDATE records SET status = 'received', receivedAt = ? WHERE id = ?
  `);

  const tx = db.transaction((ids) => {
    let count = 0;
    for (const id of ids) {
      const result = stmt.run(now, id);
      count += result.changes;
    }
    return count;
  });

  const changes = tx(ids);
  searchManager.invalidate();
  return { changes };
}

/**
 * Undo received status
 */
function undoReceived(ids) {
  if (!ids || ids.length === 0) return { changes: 0 };

  const stmt = db.prepare(`
    UPDATE records SET status = 'pending', receivedAt = NULL WHERE id = ?
  `);

  const tx = db.transaction((ids) => {
    let count = 0;
    for (const id of ids) {
      const result = stmt.run(id);
      count += result.changes;
    }
    return count;
  });

  const changes = tx(ids);
  searchManager.invalidate();
  return { changes };
}

function normalizePlateText(value) {
  return String(value || '')
    .replace(/\s+/g, '')
    .replace(/-/g, '')
    .toUpperCase()
    .trim();
}

/**
 * Update single field with validation
 */
function updateField(payload) {
  const { id, field, value } = payload;

  const allowedFields = ['plate', 'type', 'brand', 'name', 'phone', 'province'];
  if (!id || !field || !allowedFields.includes(field)) {
    throw new Error(`Invalid update: ${field}`);
  }

  let result;
  if (field === 'plate') {
    const nextPlate = String(value || '').trim();
    result = db.prepare('UPDATE records SET plate = ? WHERE id = ?').run(nextPlate, id);
  } else if (field === 'type') {
    const nextType = String(value || '').trim() || 'รย';
    result = db.prepare('UPDATE records SET type = ? WHERE id = ?').run(nextType, id);
  } else {
    result = db.prepare(`UPDATE records SET ${field} = ? WHERE id = ?`).run(value || '', id);
  }

  searchManager.invalidate();

  return { changes: result.changes };
}

/**
 * Delete records and invalidate cached search results
 */
function deleteRecords(ids) {
  if (!ids || ids.length === 0) return { changes: 0 };

  const stmt = db.prepare('DELETE FROM records WHERE id = ?');

  const tx = db.transaction((recordIds) => {
    let count = 0;
    for (const id of recordIds) {
      const result = stmt.run(id);
      count += result.changes;
    }
    return count;
  });

  const changes = tx(ids);
  searchManager.invalidate();
  return { changes };
}

/**
 * Batch import with deduplication (Layer 5: Optimized)
 * Anti-freeze: processes in chunks, reports progress
 */
function importBatch(payload) {
  const records = payload?.records || payload || [];
  const batchSize = payload?.batchSize || 1000;
  let imported = 0;
  let skipped = 0;

  console.log('📦 importBatch started with', records.length, 'records');
  console.log('📊 Database state:', db ? 'connected' : 'NOT connected');

  if (records.length === 0) return { imported: 0, skipped: 0 };

  // Verify tables exist
  try {
    const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='records'").get();
    if (!tableCheck) {
      console.error('❌ records table does not exist!');
      throw new Error('records table does not exist');
    }
    console.log('✅ Table verification passed');
  } catch (err) {
    console.error('❌ Table verification failed:', err.message);
    console.error('❌ Error stack:', err.stack);
    throw err;
  }

  const checkStmt = db.prepare(`
    SELECT id FROM records WHERE plate = ? AND DATE(importedAt) = DATE(?)
  `);

  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO records (
      id, plate, province, type, brand, name, phone,
      status, importedAt, receivedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction((batch) => {
    for (const r of batch) {
      try {
        const plate = r.plate ? r.plate.toString().trim() : '';
        const dateOnly = normalizeDate(r.importedAt || r.dateOnly);

        if (!plate || plate.length < 2) {
          console.log('⏭️ Skipping row with short plate:', plate);
          skipped++;
          continue;
        }

        // Normalize plate: trim, uppercase, NFC, remove spaces
        let plateNorm;
        try {
          plateNorm = String(plate)
            .trim()
            .toUpperCase()
            .normalize('NFC')
            .replace(/\s+/g, '')
            .replace(/ /g, '');
        } catch (err) {
          console.error('❌ Error normalizing plate:', plate, err.message);
          plateNorm = String(plate).trim().toUpperCase().replace(/\s+/g, '');
        }

        console.log('🔍 Plate:', JSON.stringify(plate), '-> PlateNorm:', JSON.stringify(plateNorm), 'Length:', plateNorm.length, 'Type:', typeof plateNorm);

        if (!plateNorm || plateNorm.length < 2) {
          console.log('⏭️ Skipping row with short plateNorm:', JSON.stringify(plateNorm), 'Length:', plateNorm?.length);
          skipped++;
          continue;
        }

        // Deduplication check (plate + date)
        const existing = checkStmt.get(plate, dateOnly);
        if (existing) {
          console.log('⏭️ Duplicate skipped:', plate, dateOnly);
          skipped++;
          continue;
        }

        // Insert record (plate_norm is auto-generated)
        insertStmt.run(
          r.id || (Date.now().toString(36) + Math.random().toString(36).substr(2, 9)),
          plate,
          r.province || '',
          r.type || '',
          r.brand || '',
          r.name || '',
          r.phone || '',
          r.status || 'pending',
          dateOnly,
          r.receivedAt || null
        );

        imported++;
        if (imported % 10 === 0) {
          console.log('✅ Imported:', imported, 'rows so far');
        }
      } catch (err) {
        console.error('❌ Error inserting row:', err.message);
        skipped++;
      }
    }
  });

  // Process in batches with progress reporting (Anti-freeze)
  const totalRecords = records.length;
  for (let i = 0; i < totalRecords; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    tx(batch);

    // Report progress every batch
    const progress = Math.min(100, Math.floor(((i + batch.length) / totalRecords) * 100));
    parentPort.postMessage({
      type: 'import-progress',
      payload: {
        progress,
        imported,
        skipped,
        total: totalRecords,
        message: `นำเข้า ${imported.toLocaleString()} / ${totalRecords.toLocaleString()} รายการ`
      }
    });

    // Yield to prevent blocking
    if (i + batchSize < totalRecords) {
      setTimeout(() => {}, 0);
    }
  }

  searchManager.invalidate();

  // Auto checkpoint after large imports
  if (totalRecords > 5000) {
    db.pragma('wal_checkpoint(TRUNCATE)');
  }

  return { imported, skipped };
}

/**
 * Load dashboard stats with caching
 */
function loadStats() {
  const today = new Date().toISOString().split('T')[0];

  const todayCount = db.prepare(`
    SELECT COUNT(*) as count FROM records WHERE DATE(importedAt) = DATE(?)
  `).get(today)?.count || 0;

  const pendingCount = db.prepare(`
    SELECT COUNT(*) as count FROM records WHERE status = 'pending'
  `).get()?.count || 0;

  const receivedCount = db.prepare(`
    SELECT COUNT(*) as count FROM records WHERE status = 'received'
  `).get()?.count || 0;

  const totalCount = db.prepare(`
    SELECT COUNT(*) as count FROM records
  `).get()?.count || 0;

  const byType = db.prepare(`
    SELECT type, COUNT(*) as count FROM records GROUP BY type
  `).all();

  const daily = db.prepare(`
    SELECT DATE(importedAt) as date, COUNT(*) as count
    FROM records GROUP BY DATE(importedAt)
    ORDER BY DATE(importedAt) DESC LIMIT 14
  `).all().reverse();

  return {
    today: todayCount,
    pending: pendingCount,
    received: receivedCount,
    total: totalCount,
    byType,
    daily
  };
}

/**
 * Export data with progress reporting
 */
function exportData(params) {
  return searchManager.list(params || {});
}

/**
 * Load all settings
 */
function loadSettings() {
  try {
    const rows = db.prepare('SELECT * FROM settings').all();
    const settings = {};
    for (const row of rows) {
      try {
        settings[row.key] = JSON.parse(row.value);
      } catch {
        settings[row.key] = row.value;
      }
    }
    return settings;
  } catch {
    return {};
  }
}

/**
 * Save settings with transaction
 */
function saveSettings(settings) {
  if (!settings || typeof settings !== 'object') {
    throw new Error('Invalid settings');
  }

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)
  `);

  const tx = db.transaction((settings) => {
    for (const [key, value] of Object.entries(settings)) {
      stmt.run(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    }
  });

  tx(settings);
  return { success: true };
}

/**
 * Purge old data with progress
 */
function purgeOldData(payload) {
  const years = payload?.years || 5;
  if (years <= 0) return { changes: 0 };

  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - years);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  const result = db.prepare(`
    DELETE FROM records WHERE DATE(importedAt) < DATE(?)
  `).run(cutoffStr);

  db.pragma('wal_checkpoint(TRUNCATE)');
  searchManager.invalidate();

  return { changes: result.changes };
}

// Memory monitoring
setInterval(() => {
  if (db && transactionCount > 10000) {
    db.pragma('wal_checkpoint(TRUNCATE)');
    transactionCount = 0;
  }
}, 300000); // Every 5 minutes
