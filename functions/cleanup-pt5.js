const admin = require("firebase-admin");

const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL:
    "https://aqms-dashboard-900ce-default-rtdb.asia-southeast1.firebasedatabase.app",
});

const db = admin.database();

function calcAQI_PM10(pm10) {
  if (pm10 == null) return null;
  const c = pm10;
  if (c <= 50) return Math.round((50 / 50) * c);
  if (c <= 100) return Math.round(50 + (50 / 50) * (c - 50));
  if (c <= 200) return Math.round(100 + (50 / 100) * (c - 100));
  if (c <= 350) return Math.round(150 + (50 / 150) * (c - 200));
  if (c <= 430) return Math.round(200 + (100 / 80) * (c - 350));
  if (c <= 600) return Math.round(300 + (200 / 170) * (c - 430));
  return 500;
}
function calcAQI_NO2(no2) {
  if (no2 == null) return null;
  const c = no2;
  if (c <= 40) return Math.round((50 / 40) * c);
  if (c <= 120) return Math.round(50 + (50 / 80) * (c - 40));
  if (c <= 400) return Math.round(100 + (50 / 280) * (c - 120));
  if (c <= 800) return Math.round(150 + (50 / 400) * (c - 400));
  if (c <= 1200) return Math.round(200 + (100 / 400) * (c - 800));
  if (c <= 2000) return Math.round(300 + (200 / 800) * (c - 1200));
  return 500;
}
function calcAQI_SO2(so2) {
  if (so2 == null) return null;
  const c = so2;
  if (c <= 20) return Math.round((50 / 20) * c);
  if (c <= 50) return Math.round(50 + (50 / 30) * (c - 20));
  if (c <= 150) return Math.round(100 + (50 / 100) * (c - 50));
  if (c <= 300) return Math.round(150 + (50 / 150) * (c - 150));
  if (c <= 600) return Math.round(200 + (100 / 300) * (c - 300));
  if (c <= 1000) return Math.round(300 + (200 / 400) * (c - 600));
  return 500;
}
function calcOverallAQI(d) {
  const vals = [
    calcAQI_PM10(d.pm10),
    calcAQI_NO2(d.no2),
    calcAQI_SO2(d.so2),
  ].filter((v) => v != null);
  return vals.length > 0 ? Math.max(...vals) : null;
}

async function cleanup() {
  const snap = await db.ref("readings").orderByKey().once("value");
  const updates = {};
  let cleaned = 0;
  let aqiFixed = 0;

  snap.forEach(function (daySnap) {
    const pt5Snap = daySnap.child("PT5");
    if (!pt5Snap.exists()) return;

    pt5Snap.forEach(function (readingSnap) {
      const r = readingSnap.val();
      if (!r) return;
      const path = `${daySnap.key}/PT5/${readingSnap.key}`;

      const hasBad =
        r.pm25 != null || r.pm10 != null || r.tsp != null;
      if (hasBad) {
        updates[`${path}/pm25`] = null;
        updates[`${path}/pm10`] = null;
        updates[`${path}/tsp`] = null;
        cleaned++;
      }

      const correctAQI = calcOverallAQI({
        pm25: null,
        pm10: null,
        so2: r.so2,
        no2: r.no2,
      });
      if (correctAQI !== r.aqi) {
        updates[`${path}/aqi`] = correctAQI;
        aqiFixed++;
      }
    });
  });

  console.log(`PT5 cleanup: ${cleaned} records cleaned, ${aqiFixed} AQI values fixed`);
  if (Object.keys(updates).length > 0) {
    await db.ref().update(updates);
    console.log("Firebase updated successfully");
  } else {
    console.log("No updates needed");
  }
  process.exit(0);
}

cleanup().catch((e) => {
  console.error("Cleanup failed:", e);
  process.exit(1);
});
