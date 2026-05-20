# 🚀 คู่มือเริ่มต้นใช้งานอย่างรวดเร็ว (Quick Start Guide)

เอกสารนี้จะแนะนำวิธีติดตั้งและใช้งาน **ระบบรับเล่มรถ ตรอ.** อย่างรวดเร็ว

---

## 📦 สำหรับผู้ใช้งาน (End Users)

### ขั้นตอนที่ 1: ติดตั้งโปรแกรม

1. **Download ตัวติดตั้ง**
   - รับไฟล์ `Setup.exe` จากผู้พัฒนาหรือแหล่งที่ได้รับอนุญาต

2. **ติดตั้งโปรแกรม**
   ```
   1. ดับเบิลคลิก Setup.exe
   2. กด "Next" ตามขั้นตอน
   3. เลือกตำแหน่งติดตั้ง (แนะนำ: C:\Program Files\)
   4. รอจนติดตั้งเสร็จ
   5. กด "Finish"
   ```

3. **เปิดโปรแกรมครั้งแรก**
   - ดับเบิลคลิกไอคอน "รับเล่มรถ ตรอ." บน Desktop
   - โปรแกรมจะสร้างฐานข้อมูลอัตโนมัติครั้งแรก

---

### ขั้นตอนที่ 2: เปิดใช้งาน License (ถ้ามี)

1. เปิดโปรแกรม
2. ไปที่เมนู **"ตั้งค่า"**
3. คลิก **"เปิดใช้งาน License"**
4. ใส่ License Key ที่ได้รับ
5. กด **"ยืนยัน"**

✅ สำเร็จ! โปรแกรมพร้อมใช้งาน

---

### ขั้นตอนที่ 3: ใช้งานเบื้องต้น

#### 📥 นำเข้าข้อมูลจาก Excel

1. เปิดเมนู **"นำเข้าข้อมูล"**
2. คลิก **"เลือกไฟล์ Excel"**
3. เลือกไฟล์ `.xlsx` หรือ `.xls`
4. ตรวจสอบตัวอย่างข้อมูลใน Preview
5. คลิก **"นำเข้า"**
6. รอจนเสร็จ (จะแสดงจำนวนรายการที่นำเข้า)

**📝 Format ไฟล์ Excel ที่ถูกต้อง:**

| เลขทะเบียน | ประเภท | วันที่รับ | สถานะ | หมายเหตุ |
|-----------|--------|----------|-------|---------|
| กข1234 | รย | 2026-04-13 | received | - |
| 1กข5678 | จยย | 2026-04-13 | pending | - |

---

#### 🔍 ค้นหาข้อมูล

1. ใช้ช่อง **"ค้นหา"** ด้านบน
2. พิมพ์เลขทะเบียน (เช่น `กข1234`, `1กข`, `5678`)
3. ผลการค้นหาจะแสดงทันที (Real-time)

**💡 ทริคการค้นหา:**
- ✅ พิมพ์เฉพาะบางส่วนก็ได้ (เช่น `กข` จะเจอ `กข1234`, `1กข5678`)
- ✅ ไม่ต้องใส่ช่องว่าง (ระบบจะตัดให้อัตโนมัติ)
- ✅ รองรับภาษาไทย/อังกฤษ/ตัวเลข

---

#### 📊 ดู Dashboard

1. เปิดเมนู **"หน้าหลัก"**
2. จะเห็น:
   - จำนวนรายการทั้งหมด
   - กราฟแสดงสถิติ
   - รายการล่าสุด

---

#### 🖨️ พิมพ์รายงาน

1. เลือกข้อมูลที่ต้องการพิมพ์
2. คลิก **"พิมพ์รายงาน"**
3. ตั้งค่า Printer
4. กด **"Print"**

---

## 💻 สำหรับนักพัฒนา (Developers)

### ความต้องการของระบบ

- **Node.js:** v18 หรือใหม่กว่า
- **NPM:** ติดตั้งมากับ Node.js
- **OS:** Windows 10/11 (64-bit)
- **RAM:** อย่างน้อย 8GB (แนะนำ)
- **Storage:** พื้นที่ว่าง 1GB+

---

### การตั้งค่าสภาพแวดล้อม

#### 1. Clone โปรเจกต์

```bash
git clone https://github.com/your-org/ระบบรับเล่ม.git
cd ระบบรับเล่ม
```

#### 2. ติดตั้ง Dependencies

```bash
npm install
```

สิ่งที่จะถูกติดตั้ง:
- `electron` - แพลตฟอร์ม Desktop App
- `better-sqlite3` - SQLite Database Driver
- `xlsx` - Excel Import/Export
- `electron-builder` - Build Tool

#### 3. รันโปรแกรมในโหมด Development

```bash
npm start
```

โปรแกรมจะเปิดขึ้นพร้อม DevTools (กด `F12` เพื่อเปิด Console)

#### 4. Build ตัวติดตั้ง

```bash
npm run build
```

ไฟล์จะถูกสร้างในโฟลเดอร์ `dist/`:
- `dist/ระบบรับเล่มรถ ตรอ. Setup x.x.x.exe` - ตัวติดตั้ง Windows

---

### โครงสร้างโปรเจกต์

```
ระบบรับเล่ม/
├── 📄 main.js              # Electron Main Process
├── 📄 renderer.js          # Frontend/UI Logic
├── 📄 db-worker.js         # Database Worker Thread
├── 📄 db.js                # Database Manager & Migration
├── 📄 search.js            # Search Logic & LRU Cache
├── 📄 license-service.js   # License Key Management
├── 📄 preload.js           # Context Isolation Bridge
├── 📄 index.html           # UI Entry Point
├── 📄 style.css            # Emerald Theme Styling
├── 📄 package.json         # Dependencies & Scripts
│
├── 📁 lib/
│   ├── chart.umd.min.js    # Chart.js Library
│   └── xlsx.full.min.js    # SheetJS Library
│
├── 📁 docs/                # Documentation
│   ├── README.md
│   ├── ARCHITECTURE.md
│   ├── BUILD.md
│   ├── CHANGELOG.md
│   ├── CONTRIBUTING.md
│   ├── LICENSE.md
│   ├── TROUBLESHOOTING.md
│   ├── MASTER_PROMPT.md
│   ├── skill.md
│   └── ความจำ.md
│
└── 📁 dist/                # Build Output (หลัง Build)
    └── *.exe
```

---

### คำสั่ง NPM Scripts

```bash
# รันโปรแกรมในโหมด Development
npm start

# Build ตัวติดตั้ง Production
npm run build

# ติดตั้ง Dependencies
npm install

# อัปเดต Dependencies
npm update

# Rebuild Native Modules (ถ้ามีปัญหา)
npm rebuild better-sqlite3 --verbose
```

---

### การดีบัก (Debugging)

#### 1. เปิด DevTools

โปรแกรมจะเปิด DevTools อัตโนมัติในโหมด Development หรือ:
- กด `F12`
- หรือ `Ctrl + Shift + I`

#### 2. ตรวจสอบ Console

```javascript
// ดู Log จาก Worker Thread
console.log('Worker status:', workerStatus);

// ตรวจสอบ Memory Usage
process.getProcessMemoryInfo().then(console.log);

// ตรวจสอบ Database Path
console.log('DB Path:', dbPath);
```

#### 3. ตรวจสอบ Database

```bash
# ใช้ SQLite CLI
sqlite3 database.db

# ดูตารางทั้งหมด
.tables

# ตรวจสอบ Schema
.schema records

# ตรวจสอบจำนวนรายการ
SELECT COUNT(*) FROM records;
```

---

### การทดสอบฟีเจอร์หลัก

#### ✅ ทดสอบการค้นหา

```javascript
// ใน DevTools Console
// ควร respond < 10ms

const start = performance.now();
await window.api.searchRecords('กข');
const end = performance.now();
console.log(`Search took: ${end - start}ms`);
```

#### ✅ ทดสอบ Import

1. สร้างไฟล์ Excel ทดสอบ (10-100 แถว)
2. นำเข้าผ่าน UI
3. ตรวจสอบว่าข้อมูลครบถ้วน

#### ✅ ทดสอบ Performance

```javascript
// ตรวจสอบ RAM usage
const mem = process.getProcessMemoryInfo();
console.log('RAM (MB):', mem.residentSet / 1024 / 1024);
// ควร < 500MB
```

---

## 🎓 การเรียนรู้เพิ่มเติม

### เอกสารที่ควรอ่าน

1. **[ARCHITECTURE.md](ARCHITECTURE.md)** - เข้าใจโครงสร้างระบบ
2. **[skill.md](skill.md)** - เทคนิคขั้นสูง
3. **[MASTER_PROMPT.md](MASTER_PROMPT.md)** - Specification หลัก
4. **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)** - แก้ไขปัญหา
5. **[CONTRIBUTING.md](CONTRIBUTING.md)** - หากต้องการร่วมพัฒนา

---

## 📞 ต้องการความช่วยเหลือ?

- 📧 สร้าง Issue ที่ GitHub
- 📖 อ่านเอกสาร Troubleshooting
- 💬 ติดต่อผู้พัฒนา

---

**ยินดีด้วย! คุณพร้อมใช้งานระบบรับเล่มรถ ตรอ. แล้ว! 🎉**
