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
    // Determine data path: D:\ if available, otherwise AppData
    let dataDir;
    try {
      if (fs.existsSync('D:\\')) {
        dataDir = path.join('D:\\', 'รับเล่มรถ ตรอ');
      } else {
        dataDir = this.app.getPath('userData');
      }
    } catch {
      dataDir = this.app.getPath('userData');
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
    this.db.pragma('cache_size = -64000'); // 64MB
    this.db.pragma('temp_store = MEMORY');
    this.db.pragma('mmap_size = 268435456'); // 256MB
    this.db.pragma('optimize');
    this.db.pragma('wal_autocheckpoint = 1000'); // Auto checkpoint every 1000 pages (Fix Bottleneck #2)
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
        receivedAt TEXT
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);

    // Add plate_norm to existing tables (migration)
    const columns = this.db.prepare("PRAGMA table_xinfo(records)").all();
    const hasPlateNorm = columns.some(c => c.name === 'plate_norm');
    if (!hasPlateNorm) {
      try {
        this.db.exec(`
          ALTER TABLE records ADD COLUMN plate_norm TEXT;
          UPDATE records SET plate_norm = UPPER(
            TRIM(REPLACE(REPLACE(plate, ' ', ''), ' ', ''))
          ) WHERE plate_norm IS NULL;
        `);
        console.log('🔧 Added plate_norm column to existing records');
      } catch (e) {
        console.warn('⚠️ plate_norm migration skipped:', e.message);
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

      CREATE INDEX IF NOT EXISTS idx_plate_norm
        ON records(plate_norm);
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
      updateManifestUrl: 'https://raw.githubusercontent.com/OWNER/REPO/main/update.json'
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
