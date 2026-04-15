# 🤝 คู่มือการมีส่วนร่วม (Contributing Guide)

ขอบคุณที่สนใจจะปรับปรุง **ระบบรับเล่มรถ ตรอ.**! เอกสารฉบับนี้จะแนะนำวิธีการมีส่วนร่วมในโปรเจกต์นี้อย่างมีประสิทธิภาพ

---

## 📋 สารบัญ

1. [รหัสความประพฤติ (Code of Conduct)](#-รหัสความประพฤติ-code-of-conduct)
2. [การเริ่มรายงานปัญหา (Reporting Bugs)](#-การเริ่มรายงานปัญหา-reporting-bugs)
3. [การเสนอคุณสมบัติใหม่ (Feature Requests)](#-การเสนอคุณสมบัติใหม่-feature-requests)
4. [การเขียนโค้ดและการส่งผลงาน (Code Contribution)](#-การเขียนโค้ดและการส่งผลงาน-code-contribution)
5. [มาตรฐานการเขียนโค้ด (Coding Standards)](#-มาตรฐานการเขียนโค้ด-coding-standards)
6. [ขั้นตอนการส่ง Pull Request](#-ขั้นตอนการส่ง-pull-request)

---

## 🧑‍🤝‍🧑 รหัสความประพฤติ (Code of Conduct)

โปรเจกต์นี้ยึดหลักความเคารพและการทำงานร่วมกัน:
- ให้เกียรติทุกคนโดยไม่แบ่งแยก
- เปิดรับ Feedback ที่สร้างสรรค์
- ให้เครดิตและอ้างอิงเมื่อใช้ไอเดียหรือโค้ดจากผู้อื่น
- เน้นคุณภาพของโค้ดมากกว่าปริมาณ

---

## 🐛 การเริ่มรายงานปัญหา (Reporting Bugs)

เมื่อพบข้อบกพร่องหรือ Bug กรุณาสร้าง Issue ใหม่พร้อมข้อมูลต่อไปนี้:

### 📝 แม่แบบการรายงาน Bug

```markdown
## รายละเอียดปัญหา
อธิบายปัญหาที่พบอย่างละเอียด

## ขั้นตอนการสร้างซ้ำ (Steps to Reproduce)
1. เปิดโปรแกรม...
2. คลิกที่ปุ่ม...
3. ใส่ข้อมูล...
4. พบข้อผิดพลาด

## ผลที่คาดหวัง (Expected Behavior)
อธิบายว่าควรเกิดอะไรขึ้น

## ผลที่เกิดขึ้นจริง (Actual Behavior)
อธิบายว่าเกิดอะไรขึ้นจริง

## ข้อมูลระบบ
- **OS:** Windows 10/11 (เวอร์ชัน)
- **App Version:** 3.0.0
- **Database Size:** จำนวนรายการโดยประมาณ
- **Screenshot/Video:** (ถ้ามี)

## ข้อมูลเพิ่มเติม
- Logs จาก DevTools Console
- ไฟล์ `error.log` (ถ้ามี)
```

---

## 💡 การเสนอคุณสมบัติใหม่ (Feature Requests)

หากต้องการเสนอฟีเจอร์ใหม่:

1. ตรวจสอบว่ายังไม่มีใครเสนอไว้ที่ [Issues](../../issues)
2. สร้าง Issue ใหม่พร้อม Label `enhancement`
3. อธิบาย:
   - ฟีเจอร์นี้ทำอะไร
   - ทำไมถึงจำเป็น
   - มีตัวอย่างการใช้งานอย่างไร

---

## 💻 การเขียนโค้ดและการส่งผลงาน (Code Contribution)

### 🛠️ สิ่งที่ต้องการก่อนเริ่มเขียนโค้ด
- Node.js v18+
- NPM หรือ Yarn
- ความเข้าใจเกี่ยวกับ Electron.js และ SQLite
- อ่านเอกสาร [ARCHITECTURE.md](ARCHITECTURE.md) และ [skill.md](skill.md)

### 📦 การตั้งค่าสภาพแวดล้อมการพัฒนา

```bash
# 1. Fork โปรเจกต์นี้

# 2. Clone Fork ของคุณ
git clone https://github.com/your-username/ระบบรับเล่ม.git
cd ระบบรับเล่ม

# 3. ติดตั้ง Dependencies
npm install

# 4. สร้าง Branch ใหม่ (ตั้งชื่อให้สื่อความหมาย)
git checkout -b feature/amazing-feature
# หรือ
git checkout -b fix/bug-description
```

### 🧪 การทดสอบโค้ดก่อนส่ง

```bash
# รันโปรแกรมในโหมด Development
npm start

# ตรวจสอบ Syntax และ Error
# (ตรวจสอบ package.json สำหรับคำสั่ง Lint/Check)

# Build ตัวทดสอบ
npm run build
```

---

## 📐 มาตรฐานการเขียนโค้ด (Coding Standards)

### 📝 JavaScript/TypeScript

```javascript
// ✅ ใช้ชื่อตัวแปรที่สื่อความหมาย
const recordCount = await db.getTotalRecords();

// ❌ หลีกเลี่ยงชื่อที่คลุมเครือ
const x = await db.getTotal();

// ✅ ใช้ Async/Await แทน Promise chains
async function loadRecords() {
  try {
    const data = await fetchRecords();
    return data;
  } catch (error) {
    console.error('Failed to load:', error);
    throw error;
  }
}

// ✅ พิมพ์ Comment เฉพาะตอนที่ซับซ้อน
// ใช้ Trigram tokenizer เพื่อค้นหาข้อความบางส่วน
// เช่น "กข" จะพบ "1กข123"
```

### 🗂️ โครงสร้างและการตั้งชื่อไฟล์

```
✅ ดี:
- db-worker.js        (ชัดเจนว่ามีหน้าที่อะไร)
- SearchManager.js    (Class-based naming)
- license-service.js  (Kebab-case สำหรับ services)

❌ หลีกเลี่ยง:
- utils.js            (คลุมเครือเกินไป)
- newfile.js          (ไม่สื่อความหมาย)
- MYSCRIPT.JS         (ไม่สอดคล้องกับเคสของโปรเจกต์)
```

### 📦 การใช้ Module

```javascript
// ✅ ใช้ ES6 Import หากเป็นไปได้
import { DBManager } from './db.js';

// ✅ ใช้ Export แบบ Named
export class SearchManager {
  // ...
}

// ✅ ใช้ JSDoc สำหรับ Public API
/**
 * ค้นหาทะเบียนรถด้วย FTS5 Trigram
 * @param {string} query - คำค้นหา
 * @returns {Promise<Array>} ผลการค้นหา
 */
async function searchPlate(query) {
  // ...
}
```

---

## 🚀 ขั้นตอนการส่ง Pull Request

### 1. เตรียม Branch

```bash
# ทำให้แน่ใจว่าโค้ดคุณอัปเดตกับ Main ล่าสุด
git fetch origin
git rebase origin/main

# แก้ไข Conflict (ถ้ามี)
git add .
git rebase --continue
```

### 2. Commit ข้อความที่ชัดเจน

```bash
# ✅ ดี
git commit -m "fix: แก้ไข FTS5 Datatype Mismatch ที่ทำให้แอป Crash ตอนเริ่มต้น"

# ✅ ดี
git commit -m "feat: เพิ่มระบบ LRU Cache สำหรับผลการค้นหา 100 รายการ"

# ❌ หลีกเลี่ยง
git commit -m "update"
git commit -m "fix bug"
```

### 3. Push และสร้าง PR

```bash
git push origin feature/your-feature-name
```

จากนั้นไปที่ Repository และสร้าง Pull Request

### 4. แม่แบบ Pull Request

```markdown
## 📋 รายละเอียด
อธิบายว่าการเปลี่ยนแปลงนี้ทำอะไร และทำไมถึงจำเป็น

## 🔧 การเปลี่ยนแปลงหลัก
- แก้ไขไฟล์ `db-worker.js`: เพิ่มระบบ Cache
- ปรับปรุง `search.js`: เพิ่ม LRU Logic
- อัปเดต `skill.md`: เพิ่มเอกสาร Cache System

## 🧪 การทดสอบ
- [ ] รันโปรแกรมแล้วไม่ Crash
- [ ] ค้นหาทะเบียนได้รวดเร็ว (< 10ms)
- [ ] RAM ไม่เกิน 500MB เมื่อโหลดข้อมูล 10,000 รายการ
- [ ] ทดสอบ Import Excel แล้วไม่ Error

## 📸 Screenshots (ถ้ามีการเปลี่ยนแปลง UI)
ใส่ภาพก่อนและหลังแก้ไข

## 📝 หมายเหตุเพิ่มเติม
อธิบายเพิ่มเติมหากมี
```

---

## 🎯 สิ่งที่เราต้องการ

### ✅ สิ่งที่ยอมรับได้
- การแก้ไข Bug
- การปรับปรุงประสิทธิภาพ
- การเพิ่มเอกสาร
- การปรับปรุง UX/UI
- การเพิ่ม Feature ที่สอดคล้องกับ [MASTER_PROMPT.md](MASTER_PROMPT.md)

### ❌ สิ่งที่ไม่ยอมรับ
- โค้ดที่ไม่มีคุณภาพหรือไม่มี Tests
- การเปลี่ยนแปลงที่ทำให้แอปทำงานช้าลง
- โค้ดที่ขัดแย้งกับ Architecture ที่กำหนด
- Dependencies ที่ไม่จำเป็นหรือเสี่ยงต่อความปลอดภัย

---

## 📞 ต้องการความช่วยเหลือ?

หากมีคำถามหรือต้องการคำแนะนำ:
1. ตรวจสอบเอกสารทั้งหมดในโฟลเดอร์ `docs/`
2. อ่าน [skill.md](skill.md) สำหรับเทคนิคขั้นสูง
3. สร้าง Issue แบบ Question

---

**ขอขอบคุณที่ช่วยให้ระบบรับเล่มรถ ตรอ. พัฒนาขึ้น! 🙏**
