# 🚨 คู่มือการแก้ไขปัญหา (Troubleshooting Guide)

เอกสารฉบับนี้รวบรวมปัญหาที่พบบ่อยและวิธีแก้ไขสำหรับ **ระบบรับเล่มรถ ตรอ.**

---

## 📋 สารบัญ

1. [ปัญหาโปรแกรมเปิดไม่ได้](#1-ปัญหาโปรแกรมเปิดไม่ได้)
2. [ปัญหาฐานข้อมูล](#2-ปัญหาฐานข้อมูล)
3. [ปัญหาการค้นหา](#3-ปัญหาการค้นหา)
4. [ปัญหา Import/Export Excel](#4-ปัญหา-importexport-excel)
5. [ปัญหาประสิทธิภาพ](#5-ปัญหาประสิทธิภาพ)
6. [ปัญหา License Key](#6-ปัญหา-license-key)

---

## 1. ปัญหาโปรแกรมเปิดไม่ได้

### ❌ อาการ: คลิกแล้วไม่มีอะไรเกิดขึ้น

#### สาเหตุที่เป็นไปได้:
- ไฟล์ฐานข้อมูลเสียหาย
- Missing Dependencies
- Error ใน Main Process

#### วิธีแก้ไข:

**ขั้นตอนที่ 1: ตรวจสอบ Error Log**
```bash
# เปิด Command Prompt แล้วรันโปรแกรมด้วยตนเอง
cd "C:\Program Files\รับเล่มรถ ตรอ"
.\ระบบจัดการสมุดรับเล่ม.exe
```

**ขั้นตอนที่ 2: ลบไฟล์ฐานข้อมูลชั่วคราว**
```bash
# ปิดโปรแกรมทั้งหมด
# ไปที่โฟลเดอร์ AppData
%APPDATA%\rab-lem-rot-tro

# ลบไฟล์ database.db (สำรองไว้ก่อน!)
del database.db
```

**ขั้นตอนที่ 3: Reinstall**
1. Uninstall โปรแกรมเก่า
2. Download ตัวติดตั้งล่าสุด
3. ติดตั้งใหม่

---

### ❌ อาการ: ขึ้น Error Dialog ตอนเปิดโปรแกรม

#### Error: "Database initialization failed"

**วิธีแก้ไข:**
1. ตรวจสอบว่า Disk ไม่เต็ม
2. ตรวจสอบว่าโฟลเดอร์ `D:\` หรือ `%APPDATA%` มีสิทธิ์ Write
3. ลองรันโปรแกรมเป็น Administrator (คลิกขวา > Run as Administrator)

#### Error: "Native module better-sqlite3 failed to load"

**วิธีแก้ไข:**
```bash
# ถ้า Develop จาก Source Code
cd path/to/project
npm rebuild better-sqlite3 --verbose

# ถ้ายังไม่ได้ผล
rm -rf node_modules
npm install
```

---

## 2. ปัญหาฐานข้อมูล

### ❌ อาการ: FTS5 Datatype Mismatch

**สาเหตุ:**
- ผูกดัชนี FTS5 กับ Text Column แทนที่จะเป็น Integer RowID

**วิธีแก้ไข:**
```sql
-- เปิด DevTools Console (Ctrl+Shift+I) แล้วรันคำสั่งนี้
-- หรือติดต่อผู้พัฒนาเพื่อรัน Script แก้ไข

-- ลบ FTS Index เดิม
DROP TRIGGER IF EXISTS records_fts_insert;
DROP TRIGGER IF EXISTS records_fts_delete;
DROP TRIGGER IF EXISTS records_fts_update;
DROP TABLE IF EXISTS records_fts;

-- สร้างใหม่ผูกกับ rowid
CREATE VIRTUAL TABLE records_fts USING fts5(
  plate_norm,
  content='records',
  content_rowid='rowid',
  tokenize='trigram'
);

-- สร้าง Triggers ใหม่
-- (ดูรายละเอียดใน db.js)
```

---

### ❌ อาการ: ฐานข้อมูลช้าลงเรื่อยๆ

**สาเหตุ:**
- Database File Fragmentation
- ไม่ได้ทำ Vacuum นาน

**วิธีแก้ไข:**

**วิธีที่ 1: ใช้ปุ่ม Vacuum ในหน้าตั้งค่า**
1. เปิดเมนู "ตั้งค่า"
2. คลิก "บีบอัดฐานข้อมูล (Vacuum)"
3. รอจนเสร็จ (อาจใช้เวลานาน)

**วิธีที่ 2: ทำด้วยตนเอง**
```bash
# ใช้ SQLite CLI
sqlite3 database.db "VACUUM;"
```

---

### ❌ อาการ: ข้อมูลหายไปบางส่วน

**สาเหตุ:**
- Disk Failure
- Improper Shutdown
- Corruption

**วิธีแก้ไข:**

**ขั้นตอนที่ 1: ตรวจสอบข้อมูล**
```sql
-- ตรวจสอบจำนวนรายการ
SELECT COUNT(*) FROM records;

-- ตรวจสอบข้อมูลเสียหาย
SELECT * FROM records WHERE dateOnly IS NULL LIMIT 10;
```

**ขั้นตอนที่ 2: กู้คืนจาก Backup**
```bash
# ดูว่ามี Backup ไหม
dir D:\backup\
dir %APPDATA%\rab-lem-rot-tro\backup\

# Restore
copy backup\database.db database.db
```

---

## 3. ปัญหาการค้นหา

### ❌ อาการ: ค้นหาไม่เจอทั้งที่มีข้อมูล

**สาเหตุที่เป็นไปได้:**
- Normalization ไม่ตรงกัน
- FTS5 Index เสียหาย
- ภาษาไทย/ปี พ.ศ. ไม่ได้แปลง

**วิธีแก้ไข:**

**ตรวจสอบ Normalization:**
```javascript
// ใน DevTools Console
const normalized = "กข 1234".replace(/[^a-zA-Z0-9ก-ฮ]/g, '');
console.log(normalized); // ควรเป็น "กข1234"
```

**Rebuild FTS5 Index:**
```sql
-- ลบและสร้าง Index ใหม่
INSERT INTO records_fts(records_fts) VALUES('rebuild');
```

---

### ❌ อาการ: ค้นหาช้ามาก (> 100ms)

**สาเหตุ:**
- ไม่มี Index
- ข้อมูลมากเกินไปไม่ได้ทำ Vacuum
- Worker Thread ค้าง

**วิธีแก้ไข:**

1. **ตรวจสอบ Explain Query:**
```sql
EXPLAIN QUERY PLAN
SELECT * FROM records WHERE plate_norm MATCH 'กข1234';
-- ควรเห็น "SCAN" หรือ "SEARCH" ไม่ใช่ "SCAN TABLE"
```

2. **ตรวจสอบ Index:**
```sql
SELECT name, tbl_name FROM sqlite_master WHERE type='index';
-- ควรมี records_fts, idx_status, idx_date
```

3. **Restart โปรแกรม** เพื่อเคลียร์ Worker Thread

---

## 4. ปัญหา Import/Export Excel

### ❌ อาการ: Import Excel แล้ว Error

**สาเหตุ:**
- ไฟล์ Excel เสียหาย
- Format ไม่ถูกต้อง
- คอลัมน์ไม่ตรง

**วิธีแก้ไข:**

**ตรวจสอบ Format Excel ที่ถูกต้อง:**

| คอลัมน์ A | คอลัมน์ B | คอลัมน์ C | คอลัมน์ D |
|-----------|-----------|-----------|-----------|
| เลขทะเบียน | ประเภท | วันที่รับ | สถานะ |
| กข1234 | รย | 2026-04-13 | received |

**ข้อควรระวัง:**
- ✅ ใช้ `.xlsx` หรือ `.xls`
- ✅ คอลัมน์แรกต้องเป็น "เลขทะเบียน"
- ✅ วันที่ต้องใช้ `YYYY-MM-DD`
- ❌ อย่าใช้สูตร (Formulas) ในเซลล์
- ❌ อย่าซ่อนแถวหรือคอลัมน์

**วิธีทดสอบ:**
```bash
# รัน Script ตรวจสอบ (ถ้ามี)
node validate_excel.js path/to/file.xlsx
```

---

### ❌ อาการ: Export Excel แล้วไฟล์เสียหาย

**สาเหตุ:**
- ข้อมูลมากเกินไปในครั้งเดียว
- RAM ไม่พอ
- SheetJS Version ผิดพลาด

**วิธีแก้ไข:**

1. **Export แบ่งช่วงเวลา:**
   - เลือกช่วงวันที่เฉพาะ
   - อย่า Export ทั้งหมดในครั้งเดียว

2. **ตรวจสอบ RAM:**
```javascript
// ใน DevTools
console.log(process.getProcessMemoryInfo());
// ควรใช้ < 500MB
```

3. **อัปเดต SheetJS:**
```bash
npm install xlsx@0.18.5
```

---

## 5. ปัญหาประสิทธิภาพ

### ❌ อาการ: UI ค้าง/กระตุก

**สาเหตุ:**
- UI Thread ถูกบล็อก
- Worker Thread ไม่ทำงาน
- Rendering ข้อมูลมากเกินไป

**วิธีแก้ไข:**

**ตรวจสอบ Worker Thread:**
```javascript
// เปิด DevTools Console
// ควรมี Log จาก Worker Thread
// ถ้าไม่มี = Worker ไม่ทำงาน
```

**ตรวจสอบ Batch Rendering:**
```javascript
// ตรวจสอบว่า Pagination เปิดอยู่
// ควรรender 50-100 แถวต่อครั้ง ไม่ใช่ทั้งหมด
```

**Optimization Tips:**
- ✅ ปิดโปรแกรมอื่นที่กิน RAM
- ✅ ทำ Vacuum ทุกเดือน
- ✅ ล้างข้อมูลเก่า (> 5 ปี)
- ❌ อย่าเปิดหลาย Instance

---

### ❌ อาการ: RAM Usage สูง (> 1GB)

**สาเหตุ:**
- Memory Leak
- LRU Cache ใหญ่เกินไป
- ไม่ได้เคลียร์ Worker

**วิธีแก้ไข:**

1. **ตรวจสอบ Memory Usage:**
```javascript
// DevTools Console
process.getProcessMemoryInfo().then(console.log);
```

2. **ลด Cache Size:**
```javascript
// ใน search.js
const CACHE_SIZE = 50; // ลดจาก 100
```

3. **Restart โปรแกรม** ทุกๆ 2-3 ชั่วโมงถ้าใช้งานหนัก

---

## 6. ปัญหา License Key

### ❌ อาการ: License Key ใช้ไม่ได้

**สาเหตุ:**
- ผูกกับเครื่องอื่น
- หมดอายุ
- Key ผิด

**วิธีแก้ไข:**

1. **ตรวจสอบ Machine ID:**
```javascript
// โปรแกรมจะแสดง Machine ID เมื่อเปิดครั้งแรก
// ใช้ ID นี้ตอนขอ License Key
```

2. **ติดต่อผู้พัฒนา:**
- ส่ง Machine ID
- ชำระเงิน (ถ้ามี)
- รับ License Key ใหม่

3. **ใส่ License Key:**
- เปิดเมนู "ตั้งค่า"
- คลิก "เปิดใช้งาน License"
- ใส่ Key แล้วกด "ยืนยัน"

---

### ❌ อาการ: โปรแกรมบอกว่า "ยังไม่เปิดใช้งาน"

**สาเหตุ:**
- License Key ยังไม่ถูกบันทึก
- Database เก็บ License หาย

**วิธีแก้ไข:**

```sql
-- ตรวจสอบสถานะ License
SELECT * FROM license_info;

-- ถ้าว่าง = ยังไม่ได้ใส่ License
-- ถ้ามี = ตรวจสอบ expired_date
```

---

## 📞 ต้องการความช่วยเหลือเพิ่มเติม?

หากทำตามขั้นตอนข้างต้นแล้วยังไม่หาย:

1. **รวบรวมข้อมูล:**
   - Screenshot/Error Message
   - Log Files (ถ้ามี)
   - ขั้นตอนการสร้างซ้ำ

2. **สร้าง Issue:**
   - ดูที่ [CONTRIBUTING.md](CONTRIBUTING.md)
   - ใช้แม่แบบ Bug Report

3. **ติดต่อผู้พัฒนา:**
   - ส่งข้อมูลทั้งหมด
   - รอตอบกลับภายใน 24-48 ชั่วโมง

---

## 📝 บันทึกการแก้ไขปัญหา

| วันที่ | ปัญหา | วิธีแก้ไข | ผู้แก้ไข |
|--------|-------|-----------|----------|
| 2026-04-13 | FTS5 Datatype Mismatch | เปลี่ยนจาก id เป็น rowid | Dev Team |
| 2026-04-13 | Startup Crash | เพิ่ม dialog.showErrorBox | Dev Team |

---

**เอกสารนี้อัปเดตล่าสุด: 2026-04-13**
