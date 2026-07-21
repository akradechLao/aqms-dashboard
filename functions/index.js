const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const fetch = require("node-fetch");

admin.initializeApp();
const db = admin.database();

const AMATA_TOKEN = "1|uDd7ptCf9hdOR3irFocfHbLgm2ePrSRXPugUCvz7d4283131";
const AMATA_PM25_TOKEN = "1|f7MPVH175GVeXbdG7VrOW2OChWVFC172KJdPA3DH0d1266f7";
const AMATA_PM25_STATIONS = ["002", "004", "005"];
const PT5_TOKEN = "1|SnpQPAiDIE8BjMPfOMbF0TjtHxFeo2PqP5ztKpzm33be5594";

const AQ_STATIONS = ["001", "002", "003", "004", "005", "006"];

async function fetchWithTimeout(url, token, timeout = 8000) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { Authorization: "Bearer " + token, Accept: "application/json" },
    });
    clearTimeout(tid);
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } catch (e) {
    clearTimeout(tid);
    throw e;
  }
}

function extractVal(v) {
  return v != null && typeof v === "object" && "value" in v
    ? +v.value
    : v != null
      ? +v
      : null;
}

async function fetchAmataStation(stationId) {
  try {
    const minuteData = await fetchWithTimeout(
      `https://amata.northernthai.co.th/api/v1/M1S${stationId}`,
      AMATA_TOKEN
    );
    let d = {};
    if (minuteData && minuteData.data) {
      const keys = Object.keys(minuteData.data);
      if (keys.length > 0) {
        d = minuteData.data[keys[keys.length - 1]];
      }
    }
    const result = {
      pm10: extractVal(d.PM10),
      tsp: extractVal(d.TSP),
      so2: extractVal(d.SO2),
      no2: extractVal(d.NO2),
      temp: extractVal(d.Temperature),
      humidity: extractVal(d.RH),
      wind: extractVal(d.WS),
      windDir: extractVal(d.WD),
      rain: extractVal(d.Rain),
      pressure: extractVal(d.Pressure),
      pm25: null,
      online: true,
    };
    if (AMATA_PM25_STATIONS.includes(stationId)) {
      try {
        const pm25Data = await fetchWithTimeout(
          `https://aqms.northernthai.co.th/api/v2/aqms/M1S${stationId}`,
          AMATA_PM25_TOKEN
        );
        let pdArr = pm25Data;
        if (pm25Data && pm25Data.data && Array.isArray(pm25Data.data))
          pdArr = pm25Data.data;
        if (Array.isArray(pdArr) && pdArr.length > 0) {
          const pd = pdArr[0];
          const pm25v = extractVal(pd.PM25);
          if (pm25v != null) result.pm25 = pm25v;
          const pm10v = extractVal(pd.PM10);
          if (pm10v != null) result.pm10 = pm10v;
          const no2v = extractVal(pd.NO2);
          if (no2v != null) result.no2 = no2v;
          const tspv = extractVal(pd.TSP);
          if (tspv != null) result.tsp = tspv;
          const so2v = extractVal(pd.SO2);
          if (so2v != null) result.so2 = so2v;
        }
      } catch (e) {}
    }
    return result;
  } catch (e) {
    return null;
  }
}

async function fetchPT5Station() {
  try {
    const data = await fetchWithTimeout(
      "https://pt5.northernthai.co.th/api/v1/s002data/h",
      PT5_TOKEN
    );
    if (!data || !Array.isArray(data) || data.length === 0) return null;
    const d = data[data.length - 1];
    return {
      pm25: extractVal(d.Value10) || extractVal(d.Value3),
      pm10: extractVal(d.Value9) || extractVal(d.Value2),
      tsp: extractVal(d.Value12) || extractVal(d.Value5),
      so2: extractVal(d.Value7),
      no2: extractVal(d.Value8) || extractVal(d.Value4),
      temp: extractVal(d.Value6),
      humidity: extractVal(d.Value1),
      wind: extractVal(d.Value11),
      windDir: null,
      rain: extractVal(d.Value12),
      pressure: null,
      online: true,
    };
  } catch (e) {
    return null;
  }
}

function calcAQI_PM25(pm25) {
  if (pm25 == null) return null;
  const c = pm25;
  if (c <= 12.5) return Math.round((50 / 12.5) * c);
  if (c <= 25.5) return Math.round(50 + (50 / 13) * (c - 12.5));
  if (c <= 37.5) return Math.round(100 + (50 / 12.2) * (c - 25.5));
  if (c <= 55) return Math.round(150 + (50 / 17.5) * (c - 37.5));
  if (c <= 150) return Math.round(200 + (100 / 95) * (c - 55));
  return Math.round(300 + (100 / 150) * (c - 150));
}
function calcAQI_PM10(pm10) {
  if (pm10 == null) return null;
  const c = pm10;
  if (c <= 50) return Math.round((50 / 50) * c);
  if (c <= 100) return Math.round(50 + (50 / 50) * (c - 50));
  if (c <= 250) return Math.round(100 + (50 / 150) * (c - 100));
  if (c <= 350) return Math.round(150 + (50 / 100) * (c - 250));
  if (c <= 430) return Math.round(200 + (100 / 80) * (c - 350));
  return Math.round(300 + (100 / 170) * (c - 430));
}
function calcAQI_NO2(no2) {
  if (no2 == null) return null;
  const c = no2;
  if (c <= 40) return Math.round((50 / 40) * c);
  if (c <= 80) return Math.round(50 + (50 / 40) * (c - 40));
  if (c <= 180) return Math.round(100 + (50 / 100) * (c - 80));
  if (c <= 280) return Math.round(150 + (50 / 100) * (c - 180));
  if (c <= 400) return Math.round(200 + (100 / 120) * (c - 280));
  return Math.round(300 + (100 / 200) * (c - 400));
}
function calcAQI_SO2(so2) {
  if (so2 == null) return null;
  const c = so2;
  if (c <= 50) return Math.round((50 / 50) * c);
  if (c <= 100) return Math.round(50 + (50 / 50) * (c - 50));
  if (c <= 200) return Math.round(100 + (50 / 100) * (c - 100));
  if (c <= 400) return Math.round(150 + (50 / 200) * (c - 200));
  if (c <= 600) return Math.round(200 + (100 / 200) * (c - 400));
  return Math.round(300 + (100 / 400) * (c - 600));
}
function calcOverallAQI(d) {
  const vals = [
    calcAQI_PM25(d.pm25),
    calcAQI_PM10(d.pm10),
    calcAQI_NO2(d.no2),
    calcAQI_SO2(d.so2),
  ].filter((v) => v != null);
  return vals.length > 0 ? Math.max(...vals) : null;
}

exports.fetchAqData = onSchedule(
  {
    schedule: "every 1 minutes",
    region: "asia-southeast1",
    memory: "256MB",
    timeoutSeconds: 120,
  },
  async (event) => {
    const now = new Date();
    const today = now.toISOString().split("T")[0];
    const ts = Date.now();
    const minute = now.getMinutes();
    const hour = now.getHours();
    const isNewHour = minute === 0;
    const updates = {};

    console.log(`Running at ${now.toISOString()} | isNewHour: ${isNewHour}`);

    // Fetch AQ stations
    for (const stationId of AQ_STATIONS) {
      try {
        const data = await fetchAmataStation(stationId);
        if (data && data.online) {
          data.aqi = calcOverallAQI(data);
          const record = {
            so2: data.so2 != null ? +data.so2 : null,
            no2: data.no2 != null ? +data.no2 : null,
            aqi: data.aqi != null ? +data.aqi : null,
            temp: data.temp != null ? +data.temp : null,
            humidity: data.humidity != null ? +data.humidity : null,
            wind: data.wind != null ? +data.wind : null,
            windDir: data.windDir != null ? +data.windDir : null,
            rain: data.rain != null ? +data.rain : null,
            pressure: data.pressure != null ? +data.pressure : null,
            waterLevel: null,
            flowRate: null,
            timestamp: ts,
            source: "cloud",
          };
          if (isNewHour) {
            record.pm25 = data.pm25 != null ? +data.pm25 : null;
            record.pm10 = data.pm10 != null ? +data.pm10 : null;
            record.tsp = data.tsp != null ? +data.tsp : null;
          }
          updates[`readings/${today}/${stationId}/${ts}`] = record;
        }
      } catch (e) {
        console.warn(`Error fetching station ${stationId}:`, e.message);
      }
    }

    // Fetch PT5
    try {
      const data = await fetchPT5Station();
      if (data && data.online) {
        data.aqi = calcOverallAQI(data);
        const record = {
          so2: data.so2 != null ? +data.so2 : null,
          no2: data.no2 != null ? +data.no2 : null,
          aqi: data.aqi != null ? +data.aqi : null,
          temp: data.temp != null ? +data.temp : null,
          humidity: data.humidity != null ? +data.humidity : null,
          wind: data.wind != null ? +data.wind : null,
          windDir: data.windDir != null ? +data.windDir : null,
          rain: data.rain != null ? +data.rain : null,
          pressure: data.pressure != null ? +data.pressure : null,
          waterLevel: null,
          flowRate: null,
          timestamp: ts,
          source: "cloud",
        };
        if (isNewHour) {
          record.pm25 = data.pm25 != null ? +data.pm25 : null;
          record.pm10 = data.pm10 != null ? +data.pm10 : null;
          record.tsp = data.tsp != null ? +data.tsp : null;
        }
        updates[`readings/${today}/PT5/${ts}`] = record;
      }
    } catch (e) {
      console.warn("Error fetching PT5:", e.message);
    }

    if (Object.keys(updates).length > 0) {
      await db.ref().update(updates);
      console.log(`Saved ${Object.keys(updates).length} records`);
    } else {
      console.warn("No data fetched, skipping write");
    }

    // Cleanup old data (90 days)
    if (isNewHour) {
      try {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 90);
        const cutoffStr = cutoff.toISOString().split("T")[0];
        const oldSnap = await db
          .ref("readings")
          .orderByKey()
          .endAt(cutoffStr)
          .once("value");
        const cleanupUpdates = {};
        oldSnap.forEach((child) => {
          cleanupUpdates[child.key] = null;
        });
        if (Object.keys(cleanupUpdates).length > 0) {
          await db.ref("readings").update(cleanupUpdates);
          console.log(`Cleanup: removed ${Object.keys(cleanupUpdates).length} old days`);
        }
      } catch (e) {
        console.warn("Cleanup error:", e.message);
      }
    }

    return null;
  }
);
