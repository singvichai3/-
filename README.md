# รับเล่มรถ ตรอ.

แอปเดสก์ท็อป Electron + SQLite สำหรับงานรับเล่มรถ ตรอ. ใช้งานแบบออฟไลน์เป็นหลัก พร้อมระบบเครื่องหลัก/เครื่องรองผ่าน LAN สำหรับช่วยกรอกข้อมูลในสำนักงาน

## ความสามารถหลัก

- บันทึกและค้นหารายการรับเล่มรถ
- ตารางรายการพร้อมตัวช่วยกรอก/แก้ไขข้อมูล
- พิมพ์และบันทึก PDF พร้อมระบบจัดตารางให้พอดีกระดาษ
- โปรแกรมเครื่องรองสำหรับเชื่อมต่อเครื่องหลักผ่านรหัสห้องใน LAN
- ระบบทดสอบ regression สำหรับ workflow สำคัญ เช่น ตาราง, ค้นหา, print preview, security sanitization และ secondary client pairing

## โครงสร้างไฟล์สำคัญ

- `main.js` — process หลักของ Electron โปรแกรมหลัก
- `renderer.js` และ `renderer-*.js` — UI/logic ฝั่ง renderer โปรแกรมหลัก
- `secondary-main.js`, `secondary-renderer.js`, `secondary-index.html` — โปรแกรมเครื่องรอง
- `local-network-server.js`, `lan-pairing.js`, `secondary-network.js` — ระบบจับคู่/สื่อสาร LAN
- `print-fit.js`, `renderer-print-preview.js` — logic ปรับตารางพิมพ์ให้พอดีกระดาษ
- `test_*.js` — regression tests

## การติดตั้งสำหรับพัฒนา

```bash
npm install
```

## การรันโปรแกรม

โปรแกรมหลัก:

```bash
npm start
```

โปรแกรมเครื่องรอง:

```bash
npm run start:secondary
```

## การทดสอบ

```bash
npm run test:all
```

## การ build

Build โปรแกรมหลัก:

```bash
npm run build
```

Build โปรแกรมเครื่องรองแบบ installer:

```bash
npm run build:secondary
```

Pack โปรแกรมเครื่องรองแบบ `win-unpacked` สำหรับทดสอบเร็ว:

```bash
npm run pack:secondary
```

## หมายเหตุสำหรับ GitHub

Repository นี้ไม่ควร commit ไฟล์ build/output และข้อมูลใช้งานจริง เช่น:

- `node_modules/`
- `dist/`, `dist-*/`, `win-unpacked/`
- ไฟล์ `.db`, `.sqlite`, log, cache
- ไฟล์ installer `.exe` หรือ artifact จาก Electron Builder
- ไฟล์ลับ เช่น `.env`, private key, certificate

ไฟล์เหล่านี้ถูกกันไว้ใน `.gitignore` แล้ว
