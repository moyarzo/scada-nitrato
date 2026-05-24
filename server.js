const express  = require("express");
const http     = require("http");
const Server   = require("socket.io").Server;
const fs       = require("fs");
const path     = require("path");
const mqtt     = require("mqtt");
const ExcelJS  = require("exceljs");

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

// ===== CONSTANTES SILO NITRATO =====
const N_TOLVA_HEIGHT = 0.78;
const N_CYL_HEIGHT   = 5.95;
const N_MAX_HEIGHT   = N_TOLVA_HEIGHT + N_CYL_HEIGHT;  // 6.73 m
const N_A_INF        = 2.78;
const N_A_SUP        = 3.48;
const N_DA           = N_A_SUP - N_A_INF;
const N_B            = N_DA / N_TOLVA_HEIGHT;
const N_V_TOLVA      = 7.6734;

const PRODUCTS = {
  "Nitrato": { density: 750 }
};

const latestSilos = {
  tanque1: { levelMeters: 0, volume: 0, percent: 0 },
  tanque2: { levelMeters: 0, volume: 0, percent: 0 },
  tanque3: { levelMeters: 0, volume: 0, percent: 0 },
  tanque4: { levelMeters: 0, volume: 0, percent: 0 },
  tanque5: { levelMeters: 0, volume: 0, percent: 0 },
  tanque6: { levelMeters: 0, volume: 0, percent: 0 },
  tanque7: { levelMeters: 0, volume: 0, percent: 0 },
  tanque8: { levelMeters: 0, volume: 0, percent: 0 }
};

// ===== ARCHIVOS =====
const TURN_FILE          = path.join(__dirname, "turnData.json");
const HISTORY_FILE       = path.join(__dirname, "historyData.json");
const SILO_HISTORY_FILE  = path.join(__dirname, "siloHistoryData.json");
const DAILY_SUMMARY_FILE = path.join(__dirname, "dailySummary.json");
const TEMPLATE_FILE      = path.join(__dirname, "template.xlsx");
const EXPORTS_DIR        = path.join(__dirname, "exports");

if (!fs.existsSync(EXPORTS_DIR)) fs.mkdirSync(EXPORTS_DIR, { recursive: true });

// ===== UTILIDADES ARCHIVO =====

function ensureJsonFile(filePath, def) {
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, JSON.stringify(def, null, 2));
}
function readJson(filePath, fallback) {
  try { ensureJsonFile(filePath, fallback); return JSON.parse(fs.readFileSync(filePath, "utf8")); }
  catch(e) { return fallback; }
}
function writeJson(filePath, data) { fs.writeFileSync(filePath, JSON.stringify(data, null, 2)); }

// ===== TIEMPO =====

function pad2(n) { return String(n).padStart(2, "0"); }

function today() {
  const n = new Date();
  return `${n.getFullYear()}-${pad2(n.getMonth()+1)}-${pad2(n.getDate())}`;
}

function formatDateYYYYMMDD(d) {
  d = d || new Date();
  return `${d.getFullYear()}${pad2(d.getMonth()+1)}${pad2(d.getDate())}`;
}

function getDateKeyDaysAgo(n) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
}

function getRounded5MinLabel() {
  const n = new Date();
  return `${pad2(n.getHours())}:${pad2(Math.floor(n.getMinutes()/5)*5)}`;
}

function getServerTime() { return new Date().toLocaleTimeString("es-CL", { hour12: false }); }

function getLast30DateKeys() {
  const r = [];
  for (let i = 29; i >= 0; i--) r.push(getDateKeyDaysAgo(i));
  return r;
}

// ===== CÁLCULO DE VOLUMEN =====

function calculateVolume(level) {
  const s = Math.max(0, Math.min(N_MAX_HEIGHT, level));
  if (s <= N_TOLVA_HEIGHT) {
    const A = N_A_INF, B = N_B;
    return (Math.pow(A + B * s, 3) - Math.pow(A, 3)) / (3 * B);
  }
  return N_V_TOLVA + N_A_SUP * N_A_SUP * (s - N_TOLVA_HEIGHT);
}

// ===== TOTALES =====

function getCurrentTotals() {
  let total = 0;
  Object.keys(latestSilos).forEach(tanque => {
    total += (latestSilos[tanque].volume || 0) * PRODUCTS["Nitrato"].density / 1000;
  });
  return { "Nitrato": total };
}

// ===== HISTORIAL =====

function defaultHistoryDay() { return { "Nitrato": [] }; }

function getProductHistoryByDate(dateKey) {
  const all = readJson(HISTORY_FILE, {});
  return all[dateKey] || defaultHistoryDay();
}

function getTodayHistory() { return getProductHistoryByDate(today()); }

function getDefaultSiloHistoryDay() {
  return { tanque1:[],tanque2:[],tanque3:[],tanque4:[],tanque5:[],tanque6:[],tanque7:[],tanque8:[] };
}

function getSiloHistoryByDate(dateKey) {
  const all = readJson(SILO_HISTORY_FILE, {});
  return all[dateKey] || getDefaultSiloHistoryDay();
}

function getTodaySiloHistory() { return getSiloHistoryByDate(today()); }

// ===== GUARDADO HISTÓRICO CADA 5 MIN =====

function updatePersistentHistory() {
  const allHistory  = readJson(HISTORY_FILE, {});
  const siloHistory = readJson(SILO_HISTORY_FILE, {});
  const day         = today();
  const label       = getRounded5MinLabel();
  const totals      = getCurrentTotals();

  if (!allHistory[day])  allHistory[day]  = defaultHistoryDay();
  if (!siloHistory[day]) siloHistory[day] = getDefaultSiloHistoryDay();

  // Historial de totalizador
  const arr  = allHistory[day]["Nitrato"] || [];
  const last = arr[arr.length - 1];
  if (!last)                    arr.push({ time: label, value: totals["Nitrato"] });
  else if (last.time !== label) arr.push({ time: label, value: totals["Nitrato"] });
  else                          last.value = totals["Nitrato"];
  allHistory[day]["Nitrato"] = arr;

  // Historial por silo (% llenado)
  Object.keys(latestSilos).forEach(tanque => {
    const sarr  = siloHistory[day][tanque] || [];
    const slast = sarr[sarr.length - 1];
    const pct   = latestSilos[tanque].percent || 0;
    if (!slast)                      sarr.push({ time: label, value: pct });
    else if (slast.time !== label)   sarr.push({ time: label, value: pct });
    else                             slast.value = pct;
    siloHistory[day][tanque] = sarr;
  });

  writeJson(HISTORY_FILE,      allHistory);
  writeJson(SILO_HISTORY_FILE, siloHistory);

  io.emit("historyData",   { date: day, history: getTodayHistory() });
  io.emit("siloTrendData", { date: day, history: getTodaySiloHistory() });
}

// ===== VARIACIONES =====

function calculateVariationsFromHistory(dayHistory) {
  const arr = (dayHistory["Nitrato"] || []).slice()
    .sort((a, b) => String(a.time).localeCompare(String(b.time)));
  let positive = 0, negative = 0;
  for (let i = 1; i < arr.length; i++) {
    const prev = Number(arr[i-1].value), curr = Number(arr[i].value);
    if (isNaN(prev) || isNaN(curr)) continue;
    const diff = curr - prev;
    if (diff > 0) positive += diff;
    else if (diff < 0) negative += Math.abs(diff);
  }
  return { "Nitrato": { positive, negative } };
}

function calculateDailyVariations() {
  return calculateVariationsFromHistory(getTodayHistory());
}

// ===== TURNOS =====

function checkShift() {
  const h      = new Date().getHours();
  const d      = readJson(TURN_FILE, {});
  const t      = today();
  const totals = getCurrentTotals();
  if (!d[t]) d[t] = {};
  if (h >= 7  && !d[t].start) d[t].start = totals;
  if (h >= 19 && !d[t].end)   d[t].end   = totals;
  writeJson(TURN_FILE, d);
  io.emit("turnData", { date: t, data: d[t] || {} });
}

function getTodayTurnData() {
  const d = readJson(TURN_FILE, {});
  return d[today()] || {};
}

// ===== RESUMEN DIARIO =====

function getValueNearTime(arr, targetTime) {
  if (!arr || !arr.length) return null;
  const exact = arr.find(i => i.time === targetTime);
  if (exact) return Number(exact.value);
  const parts = targetTime.split(":");
  const tgt   = parseInt(parts[0]) * 60 + parseInt(parts[1]);
  let best = null, bestDiff = Infinity;
  arr.forEach(item => {
    const tp  = item.time.split(":");
    const min = parseInt(tp[0]) * 60 + parseInt(tp[1]);
    const d   = Math.abs(min - tgt);
    if (d <= 30 && d < bestDiff) { bestDiff = d; best = Number(item.value); }
  });
  return best;
}

function buildDaySummary(dateKey, dayHistory, turnDay, variations) {
  const arr    = dayHistory["Nitrato"] || [];
  const inicio = (turnDay && turnDay.start && turnDay.start["Nitrato"] != null)
    ? Number(turnDay.start["Nitrato"])
    : getValueNearTime(arr, "07:00");
  const fin    = (turnDay && turnDay.end && turnDay.end["Nitrato"] != null)
    ? Number(turnDay.end["Nitrato"])
    : getValueNearTime(arr, "19:00");

  return {
    date: dateKey,
    "Nitrato": {
      inicio: inicio != null ? Number(inicio.toFixed(2)) : null,
      fin:    fin    != null ? Number(fin.toFixed(2))    : null,
      varPos: Number((variations["Nitrato"].positive).toFixed(2)),
      varNeg: Number((variations["Nitrato"].negative).toFixed(2))
    }
  };
}

function saveDailySummary() {
  const dayKey     = today();
  const dayHistory = getTodayHistory();
  const turnAll    = readJson(TURN_FILE, {});
  const variations = calculateVariationsFromHistory(dayHistory);
  const summary    = buildDaySummary(dayKey, dayHistory, turnAll[dayKey] || {}, variations);
  const all        = readJson(DAILY_SUMMARY_FILE, {});
  all[dayKey]      = summary;
  writeJson(DAILY_SUMMARY_FILE, all);
  console.log("Resumen diario guardado para:", dayKey);
}

function getLast30DailySummaries() {
  const all     = readJson(DAILY_SUMMARY_FILE, {});
  const allHist = readJson(HISTORY_FILE, {});
  const turnAll = readJson(TURN_FILE, {});
  const result  = [];
  for (let i = 29; i >= 0; i--) {
    const dk = getDateKeyDaysAgo(i);
    if (all[dk]) { result.push(all[dk]); continue; }
    const dh = allHist[dk];
    if (dh) {
      const variations = calculateVariationsFromHistory(dh);
      result.push(buildDaySummary(dk, dh, turnAll[dk] || {}, variations));
    }
  }
  return result;
}

// ===== CSV RESUMEN DIARIO =====

function buildDailySummaryCsv() {
  const summaries = getLast30DailySummaries();
  const header = [
    "Fecha",
    "Nitrato Inicio 07h (ton)",
    "Nitrato Fin 19h (ton)",
    "Nitrato Var.Positiva (ton)",
    "Nitrato Var.Negativa (ton)"
  ].join(",");

  const rows = summaries.map(s => {
    const n = s["Nitrato"] || {};
    return [
      s.date,
      n.inicio != null ? n.inicio : "",
      n.fin    != null ? n.fin    : "",
      n.varPos != null ? n.varPos : "",
      n.varNeg != null ? n.varNeg : ""
    ].join(",");
  });

  return header + "\n" + rows.join("\n");
}

// ===== EXCEL DIARIO =====

async function buildExportExcel() {
  if (!fs.existsSync(TEMPLATE_FILE)) throw new Error("No se encontró template.xlsx");

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(TEMPLATE_FILE);
  const sheet = workbook.getWorksheet("Hoja1");
  if (!sheet) throw new Error('No se encontró la hoja "Hoja1"');

  const totals     = getCurrentTotals();
  const turn       = getTodayTurnData();
  const variations = calculateDailyVariations();

  // Totalizador
  sheet.getCell("C4").value = Number(totals["Nitrato"].toFixed(1));

  // Registro turno
  sheet.getCell("C9").value  = turn.start?.["Nitrato"] != null ? Number(turn.start["Nitrato"].toFixed(1)) : "";
  sheet.getCell("C10").value = turn.end?.["Nitrato"]   != null ? Number(turn.end["Nitrato"].toFixed(1))   : "";

  // Variaciones
  sheet.getCell("C11").value = Number(variations["Nitrato"].positive.toFixed(1));
  sheet.getCell("C12").value = Number(variations["Nitrato"].negative.toFixed(1));

  // Toneladas por silo
  for (let i = 1; i <= 8; i++) {
    const row    = 16 + i;
    const tanque = "tanque" + i;
    const vol    = latestSilos[tanque]?.volume || 0;
    const ton    = (vol * PRODUCTS["Nitrato"].density) / 1000;
    sheet.getCell("C" + row).value = "Nitrato";
    sheet.getCell("D" + row).value = Number(ton.toFixed(2));
  }

  const fileName = "stock_nitrato_" + formatDateYYYYMMDD() + ".xlsx";
  const filePath = path.join(EXPORTS_DIR, fileName);
  await workbook.xlsx.writeFile(filePath);
  return { fileName, filePath };
}

// ===== MQTT =====

function uint32ToFloatWordSwap(uintValue) {
  const buf = Buffer.allocUnsafe(4);
  buf.writeUInt32BE(uintValue >>> 0, 0);
  const sw = Buffer.from([buf[2], buf[3], buf[0], buf[1]]);
  return sw.readFloatBE(0);
}

function extractDeltaRawValue(payload) {
  if (!payload || !payload.d) return null;
  for (const key in payload.d) { if (key !== "type") return payload.d[key]; }
  return null;
}

const client = mqtt.connect("mqtt://localhost:1883");

client.on("connect", () => {
  console.log("MQTT conectado");
  // Ajusta este topic al que uses para los silos de nitrato
  client.subscribe("planta/losbronces/nitrato/#");
});

client.on("message", (topic, message) => {
  try {
    const parts  = topic.split("/");
    const tanque = parts[parts.length - 1];

    if (!latestSilos[tanque]) return;

    const payload  = JSON.parse(message.toString());
    const rawValue = extractDeltaRawValue(payload);
    if (rawValue == null) return;

    const rawUint32 = parseInt(rawValue, 10);
    if (isNaN(rawUint32)) return;

    let sensorDistance = uint32ToFloatWordSwap(rawUint32);
    if (isNaN(sensorDistance) || !isFinite(sensorDistance)) return;

    sensorDistance = sensorDistance * 0.98;
    sensorDistance = Math.max(0, Math.min(N_MAX_HEIGHT, sensorDistance));

    const level   = Math.max(0, Math.min(N_MAX_HEIGHT, N_MAX_HEIGHT - sensorDistance));
    const volume  = calculateVolume(level);
    const percent = (level / N_MAX_HEIGHT) * 100;

    latestSilos[tanque] = { levelMeters: level, volume, percent };

    io.emit("nivel",     { tanque, nivel: String(sensorDistance), serverTime: getServerTime() });
    io.emit("siloState", latestSilos);

    console.log(`MQTT ${tanque} dist=${sensorDistance.toFixed(3)}m level=${level.toFixed(3)}m ${percent.toFixed(1)}%`);
  } catch(e) { console.error("Error MQTT:", e, message.toString()); }
});

// ===== TAREAS PERIÓDICAS =====

let dailySummarySavedToday = false;

function checkDailySummaryTrigger() {
  const h = new Date().getHours(), m = new Date().getMinutes();
  if (h === 19 && m < 5) {
    if (!dailySummarySavedToday) { saveDailySummary(); dailySummarySavedToday = true; }
  } else {
    dailySummarySavedToday = false;
  }
}

setInterval(checkShift,                60000);
setInterval(updatePersistentHistory,   60000);
setInterval(checkDailySummaryTrigger,  60000);

// ===== RUTAS HTTP =====

app.get("/export-data", async (req, res) => {
  try {
    const f = await buildExportExcel();
    res.download(f.filePath, f.fileName);
  } catch(e) { console.error(e); res.status(500).send("Error generando Excel"); }
});

app.get("/export-daily-summary", (req, res) => {
  try {
    const csv      = buildDailySummaryCsv();
    const fileName = "resumen_nitrato_" + formatDateYYYYMMDD() + ".csv";
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=" + fileName);
    res.send(csv);
  } catch(e) { console.error(e); res.status(500).send("Error generando CSV"); }
});

app.get("/export-trend", (req, res) => res.redirect("/export-daily-summary"));

// ===== SOCKET =====

io.on("connection", socket => {
  socket.on("getTurnData", payload => {
    const dateKey = (payload && payload.date) || today();
    const d       = readJson(TURN_FILE, {});
    socket.emit("turnData", { date: dateKey, data: d[dateKey] || {} });
  });

  socket.on("getSiloConfig", () => {
    // Producto fijo, no hay config que cambiar
    socket.emit("siloConfig", {
      tanque1:"Nitrato", tanque2:"Nitrato", tanque3:"Nitrato", tanque4:"Nitrato",
      tanque5:"Nitrato", tanque6:"Nitrato", tanque7:"Nitrato", tanque8:"Nitrato"
    });
  });

  socket.on("getHistoryDates", () => {
    socket.emit("historyDates", getLast30DateKeys());
  });

  socket.on("getHistoryData", payload => {
    const dateKey = (payload && payload.date) || today();
    socket.emit("historyData", { date: dateKey, history: getProductHistoryByDate(dateKey) });
  });

  socket.on("getSiloTrendData", payload => {
    const dateKey = (payload && payload.date) || today();
    socket.emit("siloTrendData", { date: dateKey, history: getSiloHistoryByDate(dateKey) });
  });

  socket.on("getSiloState", () => {
    socket.emit("siloState", latestSilos);
  });
});

app.use(express.static(__dirname));
server.listen(3000, "0.0.0.0", () => console.log("Servidor Nitrato corriendo en puerto 3000"));
