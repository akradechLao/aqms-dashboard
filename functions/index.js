const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const fetch = require("node-fetch");
const cheerio = require("cheerio");

admin.initializeApp();
const db = admin.database();

const AMATA_TOKEN = "1|uDd7ptCf9hdOR3irFocfHbLgm2ePrSRXPugUCvz7d4283131";
const AMATA_PM25_TOKEN = "1|f7MPVH175GVeXbdG7VrOW2OChWVFC172KJdPA3DH0d1266f7";
const AMATA_PM25_STATIONS = ["002", "004", "005"];
const PT5_TOKEN = "1|SnpQPAiDIE8BjMPfOMbF0TjtHxFeo2PqP5ztKpzm33be5594";
const AQ_STATIONS = ["001", "002", "003", "004", "005", "006"];
const MAX_DUST_RETRY = 3;
const DUST_RETRY_DELAY_MS = 60000;
const BYY_URL = "https://lakchai.northernthai.co.th/";

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

function pv(v, s) {
  return v != null && s == 1 ? extractVal(v) : null;
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
    const d = data[0];
    return {
      pm25: null,
      pm10: pv(d.Value2, d.Status2),
      tsp: pv(d.Value1, d.Status1),
      so2: pv(d.Value6, d.Status6),
      no2: pv(d.Value4, d.Status4),
      temp: pv(d.Value9, d.Status9),
      humidity: pv(d.Value10, d.Status10),
      wind: pv(d.Value7, d.Status7),
      windDir: pv(d.Value8, d.Status8),
      rain: pv(d.Value12, d.Status12),
      pressure: pv(d.Value11, d.Status11),
      online: true,
    };
  } catch (e) {
    return null;
  }
}

const THAI_DIR_MAP = {
  "เหนือ": 0, "น": 0,
  "ตะวันออกเฉียงเหนือ": 45, "ENE": 45,
  "ตะวันออก": 90, "E": 90,
  "ตะวันออกเฉียงใต้": 135, "ESE": 135,
  "ใต้": 180, "S": 180,
  "ตะวันตกเฉียงใต้": 225, "WSW": 225,
  "ตะวันตก": 270, "W": 270,
  "ตะวันตกเฉียงเหนือ": 315, "WNW": 315,
};

async function fetchBYYStation() {
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 15000);
    const r = await fetch(BYY_URL, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AQMS-Bot/1.0)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    clearTimeout(tid);
    if (!r.ok) throw new Error("HTTP " + r.status);
    const html = await r.text();
    const $ = cheerio.load(html);

    const result = {
      tsp: null, pm10: null, so2: null, no2: null,
      temp: null, humidity: null, pressure: null,
      rain: null, wind: null, windDir: null,
      pm25: null, online: true,
    };

    const cards = $("[data-flux-card]");
    cards.each((i, card) => {
      const title = $(card).find("p[data-flux-text]").first().text().trim();
      const valueEl = $(card).find("span.text-blue-500").first();
      const valText = valueEl.text().trim();
      if (!valText || valText === "Down" || valText === "Error" || valText === "---") return;
      const num = parseFloat(valText.replace(/,/g, ""));
      if (isNaN(num)) return;

      if (title.includes("ฝุ่นรวม")) result.tsp = num;
      else if (title.includes("ฝุ่นขนาดไม่เกิน 10")) result.pm10 = num;
      else if (title.includes("ซัลเฟอร์ไดออกไซด์")) result.so2 = num;
      else if (title.includes("ไนโตรเจนไดออกไซด์")) result.no2 = num;
      else if (title.includes("อุณหภูมิ")) result.temp = num;
      else if (title.includes("ความชื้นสัมพัทธ์")) result.humidity = num;
      else if (title.includes("ความกดอากาศ")) result.pressure = num;
      else if (title.includes("น้ำฝน")) result.rain = num;
    });

    const windSpeedText = $("p[data-flux-text]").filter(function () {
      return $(this).text().includes("ความเร็วลม") && !$(this).text().includes("m/s");
    }).text();
    const wsMatch = windSpeedText.match(/([\d.]+)\s*m\/s/);
    if (wsMatch) {
      result.wind = parseFloat(wsMatch[1]);
    }

    const windDirText = $("p[data-flux-text]").filter(function () {
      return $(this).text().includes("ลมพัดมาจากทิศ");
    }).text();
    const dirFromMatch = windDirText.match(/ทิศ([\w]+)\s*ไปทางทิศ([\w]+)/);
    if (dirFromMatch) {
      const fromDir = dirFromMatch[1].trim();
      result.windDir = THAI_DIR_MAP[fromDir] ?? null;
    }

    if (result.tsp === null && result.pm10 === null && result.temp === null) {
      console.warn("[BYY] No data parsed from HTML");
      return null;
    }

    console.log(`[BYY] Scraped: TSP=${result.tsp}, PM10=${result.pm10}, SO2=${result.so2}, NO2=${result.no2}, temp=${result.temp}`);
    return result;
  } catch (e) {
    console.warn("Error fetching BYY:", e.message);
    return null;
  }
}

function calcAQI_PM25(pm25) {
  if (pm25 == null) return null;
  const c = pm25;
  if (c <= 12.0) return Math.round((50 / 12.0) * c);
  if (c <= 37.5) return Math.round(50 + (50 / 25.5) * (c - 12.0));
  if (c <= 75.0) return Math.round(100 + (50 / 37.5) * (c - 37.5));
  if (c <= 150.0) return Math.round(150 + (50 / 75.0) * (c - 75.0));
  if (c <= 250.0) return Math.round(200 + (100 / 100.0) * (c - 150.0));
  if (c <= 500.0) return Math.round(300 + (200 / 250.0) * (c - 250.0));
  return 500;
}
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
    calcAQI_PM25(d.pm25),
    calcAQI_PM10(d.pm10),
    calcAQI_NO2(d.no2),
    calcAQI_SO2(d.so2),
  ].filter((v) => v != null);
  return vals.length > 0 ? Math.max(...vals) : null;
}

async function getLastDustValues(stationId) {
  try {
    const today = new Date().toISOString().split("T")[0];
    const snap = await db
      .ref(`readings/${today}/${stationId}`)
      .orderByChild("pm25")
      .limitToLast(1)
      .once("value");
    let last = null;
    snap.forEach((child) => {
      last = child.val();
    });
    return last;
  } catch (e) {
    return null;
  }
}

function hasNewDustValues(current, lastRecord) {
  if (!lastRecord) return true;
  if (current.pm25 != null && lastRecord.pm25 != null && current.pm25 === lastRecord.pm25 &&
      current.pm10 != null && lastRecord.pm10 != null && current.pm10 === lastRecord.pm10 &&
      current.tsp != null && lastRecord.tsp != null && current.tsp === lastRecord.tsp) {
    return false;
  }
  return true;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    const isNewHour = minute === 0;
    const updates = {};

    console.log(`Running at ${now.toISOString()} | isNewHour: ${isNewHour}`);

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
            let dustReady = false;
            for (let retry = 0; retry < MAX_DUST_RETRY; retry++) {
              const last = await getLastDustValues(stationId);
              if (hasNewDustValues(data, last)) {
                record.pm25 = data.pm25 != null ? +data.pm25 : null;
                record.pm10 = data.pm10 != null ? +data.pm10 : null;
                record.tsp = data.tsp != null ? +data.tsp : null;
                dustReady = true;
                console.log(`[${stationId}] New dust values found (retry ${retry})`);
                break;
              }
              console.log(`[${stationId}] Dust values unchanged, retry ${retry + 1}/${MAX_DUST_RETRY}...`);
              await sleep(DUST_RETRY_DELAY_MS);
              const freshData = await fetchAmataStation(stationId);
              if (freshData && freshData.online) {
                data.pm25 = freshData.pm25;
                data.pm10 = freshData.pm10;
                data.tsp = freshData.tsp;
              }
            }
            if (!dustReady) {
              console.log(`[${stationId}] No new dust values after ${MAX_DUST_RETRY} retries, saving anyway`);
              record.pm25 = data.pm25 != null ? +data.pm25 : null;
              record.pm10 = data.pm10 != null ? +data.pm10 : null;
              record.tsp = data.tsp != null ? +data.tsp : null;
            }
          }

          updates[`readings/${today}/${stationId}/${ts}`] = record;
        }
      } catch (e) {
        console.warn(`Error fetching station ${stationId}:`, e.message);
      }
    }

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
          let dustReady = false;
          for (let retry = 0; retry < MAX_DUST_RETRY; retry++) {
            const last = await getLastDustValues("PT5");
            if (hasNewDustValues(data, last)) {
              record.pm25 = data.pm25 != null ? +data.pm25 : null;
              record.pm10 = data.pm10 != null ? +data.pm10 : null;
              record.tsp = data.tsp != null ? +data.tsp : null;
              dustReady = true;
              console.log(`[PT5] New dust values found (retry ${retry})`);
              break;
            }
            console.log(`[PT5] Dust values unchanged, retry ${retry + 1}/${MAX_DUST_RETRY}...`);
            await sleep(DUST_RETRY_DELAY_MS);
            const freshData = await fetchPT5Station();
            if (freshData && freshData.online) {
              data.pm25 = freshData.pm25;
              data.pm10 = freshData.pm10;
              data.tsp = freshData.tsp;
            }
          }
          if (!dustReady) {
            console.log(`[PT5] No new dust values after ${MAX_DUST_RETRY} retries, saving anyway`);
            record.pm25 = data.pm25 != null ? +data.pm25 : null;
            record.pm10 = data.pm10 != null ? +data.pm10 : null;
            record.tsp = data.tsp != null ? +data.tsp : null;
          }
        }

        updates[`readings/${today}/PT5/${ts}`] = record;
      }
    } catch (e) {
      console.warn("Error fetching PT5:", e.message);
    }

    try {
      const byyData = await fetchBYYStation();
      if (byyData && byyData.online) {
        byyData.aqi = calcOverallAQI(byyData);
        const record = {
          pm25: byyData.pm25 != null ? +byyData.pm25 : null,
          pm10: byyData.pm10 != null ? +byyData.pm10 : null,
          tsp: byyData.tsp != null ? +byyData.tsp : null,
          so2: byyData.so2 != null ? +byyData.so2 : null,
          no2: byyData.no2 != null ? +byyData.no2 : null,
          aqi: byyData.aqi != null ? +byyData.aqi : null,
          temp: byyData.temp != null ? +byyData.temp : null,
          humidity: byyData.humidity != null ? +byyData.humidity : null,
          wind: byyData.wind != null ? +byyData.wind : null,
          windDir: byyData.windDir != null ? +byyData.windDir : null,
          rain: byyData.rain != null ? +byyData.rain : null,
          pressure: byyData.pressure != null ? +byyData.pressure : null,
          waterLevel: null,
          flowRate: null,
          timestamp: ts,
          source: "cloud",
        };
        updates[`readings/${today}/BYY/${ts}`] = record;
      }
    } catch (e) {
      console.warn("Error fetching BYY:", e.message);
    }

    if (Object.keys(updates).length > 0) {
      await db.ref().update(updates);
      console.log(`Saved ${Object.keys(updates).length} records`);
    } else {
      console.warn("No data fetched, skipping write");
    }

    return null;
  }
);
