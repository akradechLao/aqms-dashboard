# AQMS Dashboard - Development Log

## สถานีที่ดูแล
| รหัส | ชื่อ | ประเภท | แหล่งข้อมูล |
|------|------|--------|-------------|
| 001-006 | สถานี Amata in นิคมอมตะซิตี้ ชลบุรี และ ระยอง | อากาศ | Amata API |
| PT5 | สถานี PT5 | อากาศ | PT5 API |
| BYY | โรงเรียนบ้านยายจั่น | อากาศ | Simulated (40%) |
| RF01 | สถานีวัดปริมาณน้ำฝน #1 | น้ำฝน | Simulated |
| RF02 | สถานีวัดปริมาณน้ำฝน #2 | น้ำฝน | Simulated |
| WL01 | สถานีวัดระดับน้ำ #1 | น้ำ/อัตราการไหล | Simulated |
| WL02 | สถานีวัดระดับน้ำ #2 | น้ำ/อัตราการไหล | Simulated |

## โครงสร้างไฟล์
- `index.html` - ไฟล์หลัก มี HTML/CSS/JS ทั้งหมด inline
- `assets/rf1.jpg` - รูปสถานี RF01
- `assets/rf2.jpg` - รูปสถานี RF02
- `assets/wl1.jpg` - รูปสถานี WL01
- `assets/wl2.jpg` - รูปสถานี WL02

## API ที่ใช้งาน

### Amata API
- URL: `https://amata.northernthai.co.th/api/v1/M1S{id}`
- Token: `1|uDd7ptCf9hdOR3irFocfHbLgm2ePrSRXPugUCvz7d4283131`
- ใช้กับสถานี 001-006
- ค่าที่ได้: nested object `{value, status}`

### Amata PM2.5 API
- URL: `https://aqms.northernthai.co.th/api/v2/aqms/M1S{id}`
- Token: `1|f7MPVH175GVeXbdG7VrOW2OChWVFC172KJdPA3DH0d1266f7`
- ใช้กับสถานี 002, 004, 005 เท่านั้น

### PT5 API
- URL: `https://pt5.northernthai.co.th/api/v1/s002data/h`
- Token: `1|SnpQPAiDIE8BjMPfOMbF0TjtHxFeo2PqP5ztKpzm33be5594`
- ค่าที่ได้: direct array with Value1-12

### CCTV (go2rtc)
- Server: `http://172.18.35.176:1984`
- Cameras: camera_01, camera_02

### Firebase Realtime Database
- Project: `aqms-dashboard-900ce`
- Region: asia-southeast1
- URL: `https://aqms-dashboard-900ce-default-rtdb.asia-southeast1.firebasedatabase.app`
- ใช้เก็บข้อมูลย้อนหลัง (Phase 1)
- Auto-cleanup: ลบข้อมูลเก่ากว่า 90 วัน
- Free Tier: 1GB storage, 10GB/month bandwidth

#### โครงสร้างข้อมูล
```
readings/
  {YYYY-MM-DD}/
    {stationId}/
      {timestamp}: { pm25, pm10, tsp, so2, no2, aqi, temp, humidity, wind, windDir, rain, pressure, waterLevel, flowRate }
```

## มาตรฐานคุณภาพอากาศ (มกราคม 2569)
| มลพิษ | มาตรฐาน |
|--------|---------|
| PM2.5 | 37.5 µg/m³ |
| PM10 | 100 µg/m³ |
| TSP | 200 µg/m³ |
| SO2 | 50 ppb |
| NO2 | 120 ppb |

## ประวัติการแก้ไข

### 2026-07-21 (Phase 3: Cloud Function)
- **Firebase Cloud Function** (`fetchAqData`):
  - Region: asia-southeast1, Runtime: Node.js 20
  - บันทึกข้อมูล **ทุก 1 นาที**: SO₂, NO₂, AQI, อุณหภูมิ, ความชื้น, ลม, ฝน, ความกดอากาศ
  - บันทึกข้อมูล **ทุก 1 ชั่วโมง**: PM2.5, PM10, TSP (ตรวจสอบค่าก่อนเขียน, retry สูงสุด 3 ครั้ง)
  - Auto-cleanup ข้อมูลเก่ากว่า 90 วัน
  - ข้อมูลบันทึกอัตโนมัติแม้ปิดเว็บ

### 2026-07-21
- **Modal charts from Firebase**: กราฟใน Modal ดึงข้อมูลจริงจาก Firebase
- **Comparison chart**: เปรียบเทียบข้อมูลสถานี (PM2.5, PM10, TSP, SO₂, NO₂, AQI)
- **Smooth chart curves**: Cubic spline interpolation สำหรับกราฟเปรียบเทียบ

### 2026-07-16 (Firebase Phase 1)
- **Firebase Realtime Database integration**:
  - บันทึกข้อมูล 12 สถานี ทุก 60 วินาที
  - Auto-cleanup 90 วัน
  - Export CSV button

### 2026-07-16
- **Simulated data fallback**: เพิ่มระบบ simulated data สำหรับสถานีที่ API ล่ม
  - ค่า random ตามช่วงที่กำหนด
  - Reset ทุก 60 วินาที
- **BYY reduction**: ลดค่า simulated ของ BYY (lakchai) เหลือ 40%
  - PM2.5: 2 - 12 µg/m³
  - PM10: 8 - 32 µg/m³
  - TSP: 16 - 56 µg/m³
  - SO2: 2 - 14 ppb
  - NO2: 4 - 28 ppb

### 2026-07-15
- **Modal fixes**:
  - ลบ duplicate `<canvas id="modalChart">` ออกจาก injected HTML
  - แก้ undefined `d` variable ใน `switchTimeTab` → เปลี่ยนเป็น `sd`
  - เพิ่ม `closeModal()` ซ่อน `.modal-chart-wrap`
- **Layout fixes**:
  - Responsive 95vw page wrapper
  - Summary bar 6 columns
  - Pollutant values nowrap
  - สีเหลืองปรับเป็น #eab308

### 2026-07-14
- **Rain/Water level sections**:
  - RF01/RF02: สถานีวัดปริมาณน้ำฝน
  - WL01/WL02: สถานีวัดระดับน้ำ/อัตราการไหล
  - Section layout แยกจาก AQMS
- **Map improvements**:
  - Leaflet.js markers สีตาม AQI
  - Rain icon สีน้ำเงิน, Water icon สีเขียว
  - GPS "locate me" button
- **CCTV section**:
  - กล้องสถานี + กล้องออฟฟิศ
  - go2rtc server

### 2026-07-13
- **Initial dashboard**:
  - 8 AQ stations (001-006, PT5, BYY)
  - Amata + PT5 API integration
  - AQI calculation per กรมควบคุมมลพิษ standards
  - Thai language UI
  - Light theme with Sarabun font

## ข้อควรระวัง

### CORS Issues
- API บางตัวไม่รองรับ CORS เมื่อเรียกจาก GitHub Pages
- ใช้ simulated data เป็น fallback

### API Downtime
- Amata/PT5 API อาจล่มเป็นครั้งคราว
- Dashboard จะแสดงค่าจำลองแทน

### Station Images
- รูปภาพเก็บใน `assets/` directory
- แสดงบน cards (110px height) และ modal (150px height)
- ใช้ `onerror="this.style.display='none'"` กรณีรูปไม่โหลด
