#!/usr/bin/env node
// SEED DATA (for local development / demos only - never run against
// production data; this is intentionally separate from
// migrate-json-to-sqlite.js, which is for real legacy data).
//
// Usage: node scripts/seed.js [count]  (default 20)

const reportsRepo = require('../lib/db/reports-repo');

// Real-ish Thai locations (clustered around actual Thai cities/highways so
// the R-Tree spatial demo - GET /api/points/near - has something
// meaningful to find) rather than random lat/lng values.
const LOCATIONS = [
  { name: 'ถนนพหลโยธิน กรุงเทพฯ', lat: 13.8622, lng: 100.5591 },
  { name: 'ถนนสุขุมวิท กรุงเทพฯ', lat: 13.7367, lng: 100.5610 },
  { name: 'ถนนมิตรภาพ นครราชสีมา', lat: 14.9799, lng: 102.0977 },
  { name: 'ถนนเอเชีย อยุธยา', lat: 14.3532, lng: 100.5684 },
  { name: 'ถนนซุปเปอร์ไฮเวย์ เชียงใหม่', lat: 18.7883, lng: 98.9853 },
  { name: 'ถนนเพชรเกษม ราชบุรี', lat: 13.5282, lng: 99.8134 },
  { name: 'ถนนสายเอเชีย พิษณุโลก', lat: 16.8211, lng: 100.2659 },
  { name: 'ถนนสุขาภิบาล ชลบุรี', lat: 13.3611, lng: 100.9847 },
];
const CAUSES = ['อุบัติเหตุจราจร', 'รถจักรยานยนต์ล้ม', 'ถูกรถชน', 'เจ็บป่วยเฉียบพลัน', 'ไม่ทราบสาเหตุ'];
const GENDERS = ['ชาย', 'หญิง', 'ไม่ทราบ'];
const TEMPLES = ['วัดไตรมิตรวิทยาราม', 'วัดพระธาตุดอยสุเทพ', 'วัดใหญ่ชัยมงคล', ''];

function randomOf(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function jitter(value, magnitude) { return value + (Math.random() - 0.5) * magnitude; }

function run(count = 20) {
  let created = 0;
  for (let i = 0; i < count; i++) {
    const loc = randomOf(LOCATIONS);
    const daysAgo = Math.floor(Math.random() * 90);
    const date = new Date(Date.now() - daysAgo * 86400000);
    reportsRepo.create({
      lat: jitter(loc.lat, 0.05),
      lng: jitter(loc.lng, 0.05),
      victimName: `ผู้เสียชีวิตทดสอบ #${i + 1}`,
      victimAge: String(20 + Math.floor(Math.random() * 60)),
      victimGender: randomOf(GENDERS),
      causeOfDeath: randomOf(CAUSES),
      reportedDate: date.toISOString().slice(0, 10),
      reportedTime: `${String(Math.floor(Math.random() * 24)).padStart(2, '0')}:${String(Math.floor(Math.random() * 60)).padStart(2, '0')}`,
      locationOfDeath: loc.name,
      destinationTemple: randomOf(TEMPLES),
      reportedBy: 'เจ้าหน้าที่ทดสอบ'
    });
    created++;
  }
  return { created };
}

if (require.main === module) {
  const count = parseInt(process.argv[2], 10) || 20;
  const result = run(count);
  console.log(`Seeded ${result.created} sample reports.`);
}

module.exports = { run };
