import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import ExcelJS from "exceljs";
// Si Node < 18: installe node-fetch et décommente :
// import fetch from "node-fetch";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// --- STATIC /public ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "public")));
// -------- Proxy /api/* -> PinMe --------

// Concurrence contrôlée
async function mapWithConcurrency(items, limit, mapper) {
  const out = [];
  const running = new Set();
  let i = 0;
  const run = async (idx) => {
    const p = Promise.resolve().then(() => mapper(items[idx], idx));
    running.add(p);
    try { out[idx] = await p; } finally { running.delete(p); }
  };
  while (i < items.length) {
    while (running.size < limit && i < items.length) run(i++);
    if (running.size) await Promise.race(running);
  }
  await Promise.all(running);
  return out;
}

// ---------- Utils formats ----------
function roundN(num, n = 2) {
  const f = Math.pow(10, n);
  return Math.round((Number(num) || 0) * f) / f;
}
const pad = (n) => String(n).padStart(2, "0");
function fmtDateUTC(iso) {
  const d = new Date(iso);
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth()+1)}/${d.getUTCFullYear()}`;
}
function fmtTimeUTC(iso) {
  const d = new Date(iso);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}
function fmtDuration(ms) {
  if (ms == null || ms < 0) return "00:00:00";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

// ===== Conversion knots → km/h =====
const KNOT_TO_KMH = 1.852;

// ===== Arrondi distance “à partir de la 2ᵉ virgule” =====
function approxDistance1Dec(num) {
  const two = roundN(num, 2);
  return roundN(two, 1);
}

// ================== EXPORT EXCEL ==================
app.get("/export/vehicles-xlsx", async (req, res) => {
  try {
    let { fromDate, toDate, fromTime, toTime, date } = req.query;

    // Mode 1 jour
    if (date && !fromDate && !toDate) {
      fromDate = date;
      toDate = date;
    }
    if (!fromDate) fromDate = toDate || date;
    if (!toDate) toDate = fromDate;

    if (!fromDate || !toDate) {
      return res.status(400).json({ error: "Params requis: fromDate/toDate OU date (YYYY-MM-DD)" });
    }

    const fTime = fromTime && /^\d{2}:\d{2}$/.test(fromTime) ? fromTime : "00:00";
    const tTime = toTime   && /^\d{2}:\d{2}$/.test(toTime)   ? toTime   : "23:59";

    const fromISO = `${fromDate}T${fTime}:00Z`;
    const toISO   = `${toDate}T${tTime}:59Z`;

    const userSelectedDateStr = `${fromDate.slice(8,10)}/${fromDate.slice(5,7)}/${fromDate.slice(0,4)}`;

    // Récupérer groupes + devices
    const [groups, devices] = await Promise.all([
      pinmeFetchJson("/groups?all=true"),
      pinmeFetchJson("/devices?all=true")
    ]);

    const groupNameById = new Map(groups.map(g => [g.id, g.name || `Group ${g.id}`]));
    const modelByDeviceId = new Map(
      devices.map(d => [d.id, (typeof d.model === "string" ? d.model.trim() : (d.model ?? "")) || ""])
    );

    const MAX_CONCURRENCY = 6;
    const tripsByDevice = new Map();

    await mapWithConcurrency(devices, MAX_CONCURRENCY, async (d) => {
      const deviceId = d.id;
      try {
        const trips = await pinmeFetchJson(
          `/reports/trips?deviceId=${deviceId}&from=${encodeURIComponent(fromISO)}&to=${encodeURIComponent(toISO)}`
        );
        if (!Array.isArray(trips) || trips.length === 0) return;

        const stops = await pinmeFetchJson(
          `/reports/stops?deviceId=${deviceId}&from=${encodeURIComponent(fromISO)}&to=${encodeURIComponent(toISO)}`
        );

        const safeMs = (iso) => {
          if (!iso) return null;
          const ms = new Date(iso).getTime();
          return Number.isFinite(ms) ? ms : null;
        };

        const tripsNorm = (Array.isArray(trips) ? trips : [])
          .map(t => ({ raw: t, startMs: safeMs(t.startTime), endMs: safeMs(t.endTime) }))
          .filter(t => t.startMs != null && t.endMs != null && t.endMs >= t.startMs)
          .sort((a, b) => a.startMs - b.startMs);

        const stopsNorm = (Array.isArray(stops) ? stops : [])
          .map(s => ({
            startMs: safeMs(s.startTime),
            endMs: safeMs(s.endTime),
            idleMs: (typeof s.idleTime === "number" && s.idleTime > 0) ? s.idleTime : 0,
            durMs:  (typeof s.duration === "number"  && s.duration  > 0) ? s.duration  : 0
          }))
          .filter(s => s.startMs != null && s.endMs != null && s.endMs >= s.startMs)
          .sort((a, b) => a.startMs - b.startMs);

        const dayEndMs = safeMs(toISO);
        let j = 0;

        const list = [];
        for (let i = 0; i < tripsNorm.length; i++) {
          const t = tripsNorm[i];
          const nextStart = (i + 1 < tripsNorm.length) ? tripsNorm[i + 1].startMs : dayEndMs;

          const windowStart = t.endMs;
          const windowEnd   = nextStart ?? t.endMs;

          while (j < stopsNorm.length && stopsNorm[j].endMs <= windowStart) j++;

          let idleSum = 0, durSum = 0;
          let k = j;
          while (k < stopsNorm.length && stopsNorm[k].startMs < windowEnd) {
            const s = stopsNorm[k];
            if (s.startMs >= windowStart && s.endMs <= windowEnd) {
              idleSum += s.idleMs;
              durSum  += s.durMs;
            }
            k++;
          }
          const arretMs = Math.max(0, durSum - idleSum);

          const raw = t.raw;
          const startISO = new Date(t.startMs).toISOString();
          const endISO   = new Date(t.endMs).toISOString();

          const distKm = (typeof raw.endOdometer === "number" && typeof raw.startOdometer === "number")
            ? (raw.endOdometer - raw.startOdometer) / 1000 : 0;

          const avgSpeed = typeof raw.averageSpeed === "number" ? raw.averageSpeed * KNOT_TO_KMH : 0;
          const maxSpeed = typeof raw.maxSpeed === "number" ? raw.maxSpeed * KNOT_TO_KMH : 0;

          const spentFuel = typeof raw.spentFuel === "number" ? raw.spentFuel : 0;
          const fuelConsumedL = Math.max(0, spentFuel);
          const fuelPer100km = distKm ? (fuelConsumedL / distKm) * 100 : 0;

          list.push({
            veh: raw.deviceName || d.name || `Device ${deviceId}`,
            grp: groupNameById.get(d.groupId) || "—",
            model: modelByDeviceId.get(deviceId) || "",
            driver: (typeof raw.driverName === "string" ? raw.driverName.trim() : "") || "",
            date: (fromDate === toDate && fromDate) ? userSelectedDateStr : fmtDateUTC(startISO),
            startStr: fmtTimeUTC(startISO),
            endStr: fmtTimeUTC(endISO),
            destination: (raw.endAddress || "").trim(),
            durationMs: t.endMs - t.startMs,
            idleMs: idleSum,
            arretMs: arretMs,
            distanceKm: distKm,
            avgSpeed,
            maxSpeed,
            consommationL: fuelConsumedL,
            consommation100: fuelPer100km
          });
        }
        tripsByDevice.set(deviceId, list);
      } catch (e) {
        console.error(`[trips/stops] device=${deviceId} error:`, e.message);
      }
    });

    // Excel
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Trips");
    ws.columns = [
      { header: "Véhicule", key: "veh", width: 30 },
      { header: "Groupe", key: "grp", width: 28 },
      { header: "Modèle", key: "model", width: 24 },
      { header: "Conducteur", key: "driver", width: 26 },
      { header: "Date", key: "date", width: 14 },
      { header: "Commencer", key: "start", width: 14 },
      { header: "Fin", key: "end", width: 14 },
      { header: "Destination", key: "destination", width: 50 },
      { header: "Durée", key: "duration", width: 12 },
      { header: "tourner au ralenti", key: "idle", width: 20 },
      { header: "Arrêt", key: "arret", width: 12 },
      { header: "Distance (km)", key: "distance", width: 16 },
      { header: "Vitesse moyenne (km/h)", key: "avgSpeed", width: 22 },
      { header: "Vitesse maximale (km/h)", key: "maxSpeed", width: 22 },
      { header: "Consommation (L)", key: "consommationL", width: 20 },
      { header: "Consommation (L/100)", key: "consommation100", width: 22 }
    ];

    for (const [, list] of tripsByDevice.entries()) {
      if (!list || !list.length) continue;

      let sumDuration = 0, sumIdle = 0, sumArret = 0, sumDist = 0, sumConsoL = 0;
      let sumAvg = 0, sumMax = 0, sumConso100 = 0;
      let count = 0;

      for (const r of list) {
        ws.addRow({
          veh: r.veh, grp: r.grp, model: r.model, driver: r.driver,
          date: r.date, start: r.startStr, end: r.endStr, destination: r.destination,
          duration: fmtDuration(r.durationMs), idle: fmtDuration(r.idleMs), arret: fmtDuration(r.arretMs),
          distance: approxDistance1Dec(r.distanceKm),
          avgSpeed: roundN(r.avgSpeed, 2),
          maxSpeed: roundN(r.maxSpeed, 2),
          consommationL: roundN(r.consommationL, 2),
          consommation100: roundN(r.consommation100, 2)
        });

        sumDuration += r.durationMs;
        sumIdle += r.idleMs;
        sumArret += r.arretMs;
        sumDist += r.distanceKm;
        sumConsoL += r.consommationL;
        sumAvg += r.avgSpeed;
        sumMax += r.maxSpeed;
        sumConso100 += r.consommation100;
        count++;
      }

      const totalsRow = ws.addRow({
        veh: "", grp: "", model: "", driver: "", date: "", start: "", end: "",
        destination: "Totaux et moyennes",
        duration: fmtDuration(sumDuration),
        idle: fmtDuration(sumIdle),
        arret: fmtDuration(sumArret),
        distance: approxDistance1Dec(sumDist),
        avgSpeed: roundN(count ? (sumAvg / count) : 0, 2),
        maxSpeed: roundN(count ? (sumMax / count) : 0, 2),
        consommationL: roundN(sumConsoL, 2),
        consommation100: roundN(count ? (sumConso100 / count) : 0, 2)
      });
      totalsRow.font = { bold: true };
      totalsRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
      ws.addRow({});
    }

    const buffer = await wb.xlsx.writeBuffer();
    const fname = `Trip report.xlsx`; // NOM FIXE
    res.setHeader("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).send(Buffer.from(buffer));
  } catch (err) {
    console.error("[/export/vehicles-xlsx] error:", err);
    res.status(500).json({ error: "Export error", detail: String(err?.message || err) });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  const maskedUser = USER ? USER.replace(/.(?=.{2}$)/g, "*") : "∅";
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`[Auth] user=${maskedUser} | pass=${PASS ? "***" : "∅"}`);
});
