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

const STATUS_TRANSITIONS = {
  pending: new Set(['received']),
  received: new Set(['pending', 'completed']),
  completed: new Set(['received', 'returned']),
  returned: new Set(['completed'])
};

const STATUS_TIMESTAMPS = {
  pending: () => ({ receivedAt: null, completedAt: null, returnedAt: null }),
  received: (row, now) => ({ receivedAt: row.receivedAt || now, completedAt: null, returnedAt: null }),
  completed: (row, now) => ({ receivedAt: row.receivedAt || now, completedAt: row.completedAt || now, returnedAt: null }),
  returned: (row, now) => ({ receivedAt: row.receivedAt || now, completedAt: row.completedAt || now, returnedAt: row.returnedAt || now })
};

function noteWriteTransaction(changes = 1) {
  const increment = Number.isFinite(changes) ? Math.max(0, changes) : 1;
  transactionCount += increment;
}

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
    db.pragma('cache_size = -131072'); // 128MB
    db.pragma('temp_store = MEMORY');
    db.pragma('mmap_size = 536870912'); // 512MB
    db.pragma('busy_timeout = 5000');  // 5s retry on lock
    // ไม่ใช้ locking_mode = EXCLUSIVE — db.js เปิด DB เดียวกัน จะ deadlock กัน
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
        receivedAt TEXT,
        completedAt TEXT,
        returnedAt TEXT
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        record_id TEXT,
        action TEXT NOT NULL,
        field_name TEXT,
        old_value TEXT,
        new_value TEXT,
        performed_by TEXT DEFAULT 'local',
        performed_at TEXT DEFAULT (datetime('now', 'localtime'))
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);

    const columns = db.prepare("PRAGMA table_xinfo(records)").all();
    const hasColumn = (name) => columns.some(c => c.name === name);
    const additiveColumns = [
      ['plate_norm', `TEXT`],
      ['completedAt', `TEXT`],
      ['returnedAt', `TEXT`]
    ];

    for (const [name, definition] of additiveColumns) {
      if (hasColumn(name)) continue;
      try {
        db.exec(`ALTER TABLE records ADD COLUMN ${name} ${definition};`);
        console.log(`🔧 Worker added ${name} column to existing records`);
      } catch (e) {
        console.warn(`⚠️ Worker ${name} migration skipped:`, e.message);
      }
    }

    if (!hasColumn('plate_norm')) {
      try {
        db.exec(`
          UPDATE records SET plate_norm = UPPER(
            TRIM(REPLACE(REPLACE(plate, ' ', ''), ' ', ''))
          ) WHERE plate_norm IS NULL;
        `);
      } catch (e) {
        console.warn('⚠️ Worker plate_norm backfill skipped:', e.message);
      }
    }

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_completed ON records(completedAt) WHERE status='completed';
      CREATE INDEX IF NOT EXISTS idx_returned ON records(returnedAt) WHERE status='returned';
      CREATE INDEX IF NOT EXISTS idx_records_plate_imported ON records(plate_norm, importedAt);
      CREATE INDEX IF NOT EXISTS idx_audit_record_time ON audit_log(record_id, performed_at);
    `);

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

      case 'searchBundle':
        result = searchManager.searchBundle(payload || {});
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

      case 'markCompleted':
        result = markCompleted(payload || []);
        parentPort.postMessage({ id, success: true, data: result });
        break;

      case 'markReturned':
        result = markReturned(payload || []);
        parentPort.postMessage({ id, success: true, data: result });
        break;

      case 'loadAuditLog':
        result = loadAuditLog(payload || {});
        parentPort.postMessage({ id, success: true, data: result });
        break;

      case 'updateField':
        result = updateField(payload || {});
        parentPort.postMessage({ id, success: true, data: result });
        break;

      case 'bulkUpdateField':
        result = bulkUpdateField(payload || {});
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

      case 'backupDatabase':
        result = backupDatabase(payload || {});
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
 * Record workflow status transition helpers.
 */
function normalizeStatus(value) {
  return ['pending', 'received', 'completed', 'returned'].includes(value) ? value : 'pending';
}

function canTransitionStatus(fromStatus, toStatus) {
  const from = normalizeStatus(fromStatus);
  if (from === toStatus) return true;
  return Boolean(STATUS_TRANSITIONS[from]?.has(toStatus));
}

function writeAuditLog(recordId, action, fieldName, oldValue, newValue) {
  db.prepare(`
    INSERT INTO audit_log (record_id, action, field_name, old_value, new_value, performed_by, performed_at)
    VALUES (?, ?, ?, ?, ?, 'local', datetime('now', 'localtime'))
  `).run(recordId, action, fieldName, oldValue == null ? null : String(oldValue), newValue == null ? null : String(newValue));
}

function transitionRecordStatus(ids, targetStatus, action) {
  const recordIds = Array.isArray(ids) ? ids.filter(Boolean) : [];
  if (recordIds.length === 0) return { changes: 0, skipped: 0 };

  const nextStatus = normalizeStatus(targetStatus);
  const selectStmt = db.prepare('SELECT id, status, receivedAt, completedAt, returnedAt FROM records WHERE id = ?');
  const updateStmt = db.prepare(`
    UPDATE records
    SET status = ?, receivedAt = ?, completedAt = ?, returnedAt = ?
    WHERE id = ?
  `);
  const now = new Date().toISOString();

  const tx = db.transaction((nextIds) => {
    let changes = 0;
    let skipped = 0;

    for (const id of nextIds) {
      const row = selectStmt.get(id);
      if (!row || !canTransitionStatus(row.status, nextStatus)) {
        skipped += 1;
        continue;
      }

      const previousStatus = normalizeStatus(row.status);
      const timestamps = STATUS_TIMESTAMPS[nextStatus](row, now);
      const result = updateStmt.run(
        nextStatus,
        timestamps.receivedAt,
        timestamps.completedAt,
        timestamps.returnedAt,
        id
      );

      if (result.changes > 0 && previousStatus !== nextStatus) {
        writeAuditLog(id, action, 'status', previousStatus, nextStatus);
      }
      changes += result.changes;
    }

    return { changes, skipped };
  });

  const result = tx(recordIds);
  noteWriteTransaction(result.changes);
  searchManager.invalidate();
  return result;
}

function markReceived(ids) {
  return transitionRecordStatus(ids, 'received', 'mark_received');
}

function undoReceived(ids) {
  return transitionRecordStatus(ids, 'pending', 'undo_received');
}

function markCompleted(ids) {
  return transitionRecordStatus(ids, 'completed', 'mark_completed');
}

function markReturned(ids) {
  return transitionRecordStatus(ids, 'returned', 'mark_returned');
}

function loadAuditLog(payload) {
  const recordId = String(payload?.recordId || '').trim();
  const limit = Math.max(1, Math.min(Number(payload?.limit || 100), 500));

  if (recordId) {
    return db.prepare(`
      SELECT * FROM audit_log
      WHERE record_id = ?
      ORDER BY datetime(performed_at) DESC, id DESC
      LIMIT ?
    `).all(recordId, limit);
  }

  return db.prepare(`
    SELECT * FROM audit_log
    ORDER BY datetime(performed_at) DESC, id DESC
    LIMIT ?
  `).all(limit);
}

function normalizePlateText(value) {
  // Keep this exactly aligned with the SQLite generated column expression:
  // UPPER(TRIM(REPLACE(REPLACE(plate, ' ', ''), ' ', '')))
  // Do not add Unicode normalization here unless the DB expression is migrated too,
  // otherwise LAN imports can miss duplicate plate/date checks.
  return String(value || '')
    .replace(/\s+/g, '')
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

  noteWriteTransaction(result.changes);
  searchManager.invalidate();

  return { changes: result.changes };
}

/**
 * Update one field across many rows in a single transaction.
 */
function bulkUpdateField(payload) {
  const { ids, field, value } = payload;
  const recordIds = Array.isArray(ids) ? ids.filter(Boolean) : [];
  const allowedFields = ['brand', 'name', 'phone', 'province'];

  if (recordIds.length === 0 || !allowedFields.includes(field)) {
    throw new Error('Invalid bulk update payload');
  }

  const stmt = db.prepare(`UPDATE records SET ${field} = ? WHERE id = ?`);
  const tx = db.transaction((nextIds, nextValue) => {
    let changes = 0;
    for (const id of nextIds) {
      changes += stmt.run(nextValue || '', id).changes;
    }
    return changes;
  });

  const changes = tx(recordIds, value);
  noteWriteTransaction(changes);
  searchManager.invalidate();
  return { changes };
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
  noteWriteTransaction(changes);
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

  if (records.length === 0) return { imported: 0, skipped: 0 };

  // Verify tables exist
  try {
    const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='records'").get();
    if (!tableCheck) {
      throw new Error('records table does not exist');
    }
  } catch (err) {
    throw err;
  }

  const existingKeys = buildExistingImportKeySet(records);
  const pendingKeys = new Set();

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO records (
      id, plate, province, type, brand, name, phone,
      status, importedAt, receivedAt, completedAt, returnedAt
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE NOT EXISTS (
      SELECT 1 FROM records WHERE plate_norm = ? AND importedAt = ?
    )
  `);

  const tx = db.transaction((batch) => {
    for (const r of batch) {
      try {
        const plate = r.plate ? r.plate.toString().trim() : '';
        const dateOnly = normalizeDate(r.importedAt || r.dateOnly);

        if (!plate || plate.length < 2) {
          skipped++;
          continue;
        }

        // Normalize plate with the same helper used by pre-flight dedupe and
        // the same rules as the SQLite generated plate_norm column.
        const plateNorm = normalizePlateText(plate);

        if (!plateNorm || plateNorm.length < 2) {
          skipped++;
          continue;
        }

        const dedupeKey = `${plateNorm}|${dateOnly}`;
        if (existingKeys.has(dedupeKey) || pendingKeys.has(dedupeKey)) {
          skipped++;
          continue;
        }

        // Insert record (plate_norm is auto-generated). Use INSERT OR IGNORE +
        // NOT EXISTS instead of REPLACE so a duplicate import cannot reset an
        // existing record's status/receivedAt/completedAt/returnedAt fields.
        const insertResult = insertStmt.run(
          r.id || (Date.now().toString(36) + Math.random().toString(36).substr(2, 9)),
          plate,
          r.province || '',
          r.type || '',
          r.brand || '',
          r.name || '',
          r.phone || '',
          r.status || 'pending',
          dateOnly,
          r.receivedAt || null,
          r.completedAt || null,
          r.returnedAt || null,
          plateNorm,
          dateOnly
        );

        if (insertResult.changes > 0) {
          pendingKeys.add(dedupeKey);
          imported++;
        } else {
          skipped++;
        }
      } catch (err) {
        skipped++;
      }
    }
  });

  // Process in batches with progress reporting (Anti-freeze)
  const totalRecords = records.length;
  for (let i = 0; i < totalRecords; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const beforeImported = imported;
    tx(batch);
    noteWriteTransaction(imported - beforeImported);

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
  }

  searchManager.invalidate();

  // Auto checkpoint after large imports
  if (totalRecords > 5000) {
    db.pragma('wal_checkpoint(TRUNCATE)');
  }

  return { imported, skipped };
}

function buildExistingImportKeySet(records) {
  const plateNorms = Array.from(new Set(
    records
      .map(record => normalizePlateText(record?.plate))
      .filter(value => value && value.length >= 2)
  ));

  const existingKeys = new Set();
  const chunkSize = 300;

  for (let index = 0; index < plateNorms.length; index += chunkSize) {
    const chunk = plateNorms.slice(index, index + chunkSize);
    const placeholders = chunk.map(() => '?').join(', ');
    const rows = db.prepare(`
      SELECT plate_norm, importedAt
      FROM records
      WHERE plate_norm IN (${placeholders})
    `).all(...chunk);

    for (const row of rows) {
      const importedDate = String(row.importedAt || '').slice(0, 10);
      if (row.plate_norm && importedDate) {
        existingKeys.add(`${row.plate_norm}|${importedDate}`);
      }
    }
  }

  return existingKeys;
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

  const completedCount = db.prepare(`
    SELECT COUNT(*) as count FROM records WHERE status = 'completed'
  `).get()?.count || 0;

  const returnedCount = db.prepare(`
    SELECT COUNT(*) as count FROM records WHERE status = 'returned'
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
    completed: completedCount,
    returned: returnedCount,
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

function backupDatabase(payload) {
  const backupPath = String(payload?.backupPath || '').trim();
  if (!backupPath) {
    throw new Error('Missing backup path');
  }

  const escapedPath = backupPath.replace(/'/g, "''");
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.exec(`VACUUM INTO '${escapedPath}'`);

  return {
    backupPath,
    createdAt: new Date().toISOString()
  };
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
  noteWriteTransaction(Object.keys(settings).length);
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

  noteWriteTransaction(result.changes);
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
