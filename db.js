/**
 * db.js — Database Layer
 * PRAGMA optimization, FTS5 Trigram, Auto-cleanup, Deduplication
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

class DBManager {
  constructor(app) {
    this.app = app;
    this.db = null;
  }

  init() {
    // Determine data path: keep the existing D:\\ convention when it is
    // writable, but fall back to AppData instead of failing startup when D:\\ is
    // a disconnected/locked removable drive or has permissions issues.
    const preferredDataDir = path.join('D:\\', 'รับเล่มรถ ตรอ');
    const fallbackDataDir = this.app.getPath('userData');
    let dataDir = fallbackDataDir;

    try {
      fs.mkdirSync(preferredDataDir, { recursive: true });
      const probePath = path.join(preferredDataDir, '.write-test');
      fs.writeFileSync(probePath, 'ok');
      fs.unlinkSync(probePath);
      dataDir = preferredDataDir;
    } catch (error) {
      console.warn(`⚠️ D:\\ data path unavailable, falling back to AppData: ${error.message}`);
      dataDir = fallbackDataDir;
    }

    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const dbPath = path.join(dataDir, 'database.db');

    console.log(`📂 Database path: ${dbPath}`);

    this.db = new Database(dbPath);

    // PRAGMA Optimization (Layer 1)
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = -131072'); // 128MB
    this.db.pragma('temp_store = MEMORY');
    this.db.pragma('mmap_size = 536870912'); // 512MB
    this.db.pragma('busy_timeout = 5000');   // 5s retry on lock — ป้องกัน SQLITE_BUSY crash
    // หมายเหตุ: ไม่ใช้ locking_mode = EXCLUSIVE เพราะ db.js และ db-worker.js เปิด DB ไฟล์เดียวกัน
    // ถ้า EXCLUSIVE ทั้งคู่จะแย่งล็อคกัน เกิด busy wait ทุก operation
    this.db.pragma('optimize');
    this.db.pragma('wal_autocheckpoint = 1000');
    this.db.pragma('wal_checkpoint(TRUNCATE)');

    // Create tables
    this.createTables();

    // Create FTS5 virtual table
    this.createFTS5();

    // Create triggers
    this.createTriggers();

    // Create indexes
    this.createIndexes();

    // Repair records imported with an incorrect +100 year offset
    this.repairImportedAtYears();

    // Auto-cleanup old data
    this.autoCleanup();

    // Initialize default settings
    this.initDefaultSettings();

    console.log('✅ Database initialized successfully');

    return { db: this.db, dbPath };
  }

  /**
   * Create main tables
   */
  createTables() {
    this.db.exec(`
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

    // Add columns to existing tables (backward-compatible migrations)
    const columns = this.db.prepare("PRAGMA table_xinfo(records)").all();
    const hasColumn = (name) => columns.some(c => c.name === name);
    const additiveColumns = [
      ['plate_norm', `TEXT`],
      ['completedAt', `TEXT`],
      ['returnedAt', `TEXT`]
    ];

    for (const [name, definition] of additiveColumns) {
      if (hasColumn(name)) continue;
      try {
        this.db.exec(`ALTER TABLE records ADD COLUMN ${name} ${definition};`);
        console.log(`🔧 Added ${name} column to existing records`);
      } catch (e) {
        console.warn(`⚠️ ${name} migration skipped:`, e.message);
      }
    }

    if (!hasColumn('plate_norm')) {
      try {
        this.db.exec(`
          UPDATE records SET plate_norm = UPPER(
            TRIM(REPLACE(REPLACE(plate, ' ', ''), ' ', ''))
          ) WHERE plate_norm IS NULL;
        `);
      } catch (e) {
        console.warn('⚠️ plate_norm backfill skipped:', e.message);
      }
    }
  }

  /**
   * Create FTS5 Trigram virtual table
   */
  createFTS5() {
    // Check if FTS5 table exists
    const ftsExists = this.db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='records_fts'
    `).get();

    if (!ftsExists) {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS records_fts
        USING fts5(
          plate_norm, plate, brand, name, phone,
          content=records,
          content_rowid='rowid',
          tokenize='trigram'
        );
      `);
    }
  }

  /**
   * Create FTS5 sync triggers
   */
  createTriggers() {
    // Check if triggers exist
    const triggers = this.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='trigger'
    `).all().map(t => t.name);

    if (!triggers.includes('records_ai')) {
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS records_ai AFTER INSERT ON records BEGIN
          INSERT INTO records_fts(rowid, plate_norm, plate, brand, name, phone)
          VALUES (new.rowid, new.plate_norm, new.plate, new.brand, new.name, new.phone);
        END;

        CREATE TRIGGER IF NOT EXISTS records_ad AFTER DELETE ON records BEGIN
          INSERT INTO records_fts(records_fts, rowid, plate_norm, plate, brand, name, phone)
          VALUES ('delete', old.rowid, old.plate_norm, old.plate, old.brand, old.name, old.phone);
        END;

        CREATE TRIGGER IF NOT EXISTS records_au AFTER UPDATE ON records BEGIN
          INSERT INTO records_fts(records_fts, rowid, plate_norm, plate, brand, name, phone)
          VALUES ('delete', old.rowid, old.plate_norm, old.plate, old.brand, old.name, old.phone);
          INSERT INTO records_fts(rowid, plate_norm, plate, brand, name, phone)
          VALUES (new.rowid, new.plate_norm, new.plate, new.brand, new.name, new.phone);
        END;
      `);
    }
  }

  /**
   * Create performance indexes
   */
  createIndexes() {
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_type_brand
        ON records(type, brand);

      CREATE INDEX IF NOT EXISTS idx_status_date
        ON records(status, importedAt);

      CREATE INDEX IF NOT EXISTS idx_plate_cover
        ON records(plate, type, brand, status);

      CREATE INDEX IF NOT EXISTS idx_received
        ON records(receivedAt) WHERE status='received';

      CREATE INDEX IF NOT EXISTS idx_completed
        ON records(completedAt) WHERE status='completed';

      CREATE INDEX IF NOT EXISTS idx_returned
        ON records(returnedAt) WHERE status='returned';

      CREATE INDEX IF NOT EXISTS idx_audit_record_time
        ON audit_log(record_id, performed_at);

      CREATE INDEX IF NOT EXISTS idx_plate_norm
        ON records(plate_norm);

      CREATE INDEX IF NOT EXISTS idx_plate_norm_imported_at
        ON records(plate_norm, importedAt);
    `);
  }

  /**
   * Repair importedAt values that were shifted 100 years ahead by legacy 2-digit BE parsing.
   */
  repairImportedAtYears() {
    const result = this.db.prepare(`
      UPDATE records
      SET importedAt = printf('%04d', CAST(substr(importedAt, 1, 4) AS INTEGER) - 100) || substr(importedAt, 5)
      WHERE importedAt GLOB '21??-??-??*'
        AND CAST(substr(importedAt, 1, 4) AS INTEGER) BETWEEN 2100 AND 2156
    `).run();

    if (result.changes > 0) {
      console.log(`🔧 Repaired ${result.changes} importedAt values with +100 year drift`);
    }
  }

  /**
   * Auto-cleanup records older than retainYears
   */
  cleanup(retainYears = 5) {
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - retainYears);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    const result = this.db.prepare(`
      DELETE FROM records
      WHERE DATE(importedAt) < DATE(?)
    `).run(cutoffStr);

    if (result.changes > 0) {
      console.log(`🧹 Auto-cleaned ${result.changes} old records`);
    }

    return result.changes;
  }

  /**
   * Auto-cleanup on startup
   */
  autoCleanup() {
    try {
      const settings = this.db.prepare('SELECT value FROM settings WHERE key = ?').get('retainYears');
      const years = settings ? parseInt(settings.value) : 5;
      this.cleanup(years);
    } catch (error) {
      console.warn('⚠️ Auto-cleanup skipped:', error.message);
    }
  }

  /**
   * Initialize default settings
   */
  initDefaultSettings() {
    const defaults = {
      shopName: 'รับเล่มรถ ตรอ.',
      province: '',
      brands: '',
      retainYears: '5',
      theme: '"dark"',
      notifyHours: '24',
      updateManifestUrl: 'https://raw.githubusercontent.com/singvichai3/-/main/update.json'
    };

    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)
    `);

    const tx = this.db.transaction((defaults) => {
      for (const [key, value] of Object.entries(defaults)) {
        stmt.run(key, value);
      }
    });

    tx(defaults);
  }

  /**
   * Get database instance
   */
  getDatabase() {
    return this.db;
  }

  /**
   * Close database
   */
  close() {
    if (this.db) {
      this.db.pragma('wal_checkpoint(TRUNCATE)');
      this.db.close();
      console.log('🔒 Database closed');
    }
  }
}

module.exports = DBManager;
