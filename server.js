const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { initDb, getDb, upsertStationConfig, saveQcEvent } = require("./src/db");
const { buildDashboardSummary, buildStationHistory } = require("./src/metrics");
const { buildStationEventHistory, buildAllStationsEventHistory } = require("./src/history");
const { connectMqtt } = require("./src/mqtt");

require("dotenv").config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const port = Number(process.env.PORT || 3000);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

app.get("/api/stations", asyncHandler(async (req, res) => {
  res.json(await buildDashboardSummary(getDb()));
}));

app.get("/api/stations/:machineCode/history", asyncHandler(async (req, res) => {
  res.json(await buildStationHistory(getDb(), req.params.machineCode.trim().toUpperCase()));
}));

app.get("/api/stations/:machineCode/events", asyncHandler(async (req, res) => {
  res.json(
    await buildStationEventHistory(getDb(), req.params.machineCode.trim().toUpperCase(), normalizeRange(req.query))
  );
}));

app.get("/api/events", asyncHandler(async (req, res) => {
  res.json(await buildAllStationsEventHistory(getDb(), normalizeRange(req.query)));
}));

app.post("/api/stations/:machineCode/config", asyncHandler(async (req, res) => {
  const machineCode = req.params.machineCode.trim().toUpperCase();
  const stationName = (req.body.stationName || machineCode).trim();
  const idealCycleSeconds = Number(req.body.idealCycleSeconds || process.env.DEFAULT_IDEAL_CYCLE_SECONDS || 30);
  const plannedRuntimeSeconds = Number(req.body.plannedRuntimeSeconds || process.env.DEFAULT_PLANNED_RUNTIME_SECONDS || 28800);

  await upsertStationConfig({
    machineCode,
    stationName,
    idealCycleSeconds,
    plannedRuntimeSeconds
  });

  const summary = await buildDashboardSummary(getDb());
  io.emit("dashboard:update", summary);
  res.json({ ok: true, machineCode });
}));

app.post("/api/qc-event", asyncHandler(async (req, res) => {
  try {
    const eventPayload = normalizeEventPayload(req.body);
    const eventResult = await saveQcEvent(eventPayload);
    await pushRealtimeUpdate(io);
    res.json({ ok: true, eventId: eventResult.eventId });
  } catch (error) {
    res.status(400).json({ ok: false, message: error.message });
  }
}));

io.on("connection", async (socket) => {
  socket.emit("dashboard:update", await buildDashboardSummary(getDb()));
});

bootstrap().catch((error) => {
  console.error("Failed to start server:", error.message);
  process.exit(1);
});

function normalizeEventPayload(payload) {
  const machineCode = String(payload.machineCode || "").trim().toUpperCase();
  if (!machineCode) {
    throw new Error("machineCode is required");
  }

  const timestamp = payload.timestamp ? new Date(payload.timestamp).toISOString() : new Date().toISOString();
  const eventType = String(payload.eventType || "").trim().toLowerCase();
  if (!["qc_start", "qc_end"].includes(eventType)) {
    throw new Error("eventType must be qc_start or qc_end");
  }

  const result = eventType === "qc_end" ? String(payload.result || "").trim().toUpperCase() : null;
  if (eventType === "qc_end" && !["GOOD", "REJECT"].includes(result)) {
    throw new Error("result must be GOOD or REJECT when eventType is qc_end");
  }

  return {
    machineCode,
    stationName: payload.stationName ? String(payload.stationName).trim() : machineCode,
    timestamp,
    eventType,
    result,
    metaJson: JSON.stringify({
      firmwareVersion: payload.firmwareVersion || null,
      wifiSsid: payload.wifiSsid || null,
      ipAddress: payload.ipAddress || null,
      qcRunId: payload.qcRunId || null
    })
  };
}

async function pushRealtimeUpdate(ioInstance) {
  ioInstance.emit("dashboard:update", await buildDashboardSummary(getDb()));
}

function normalizeRange(query) {
  return {
    from: normalizeDateOrNull(query.from),
    to: normalizeDateOrNull(query.to)
  };
}

function normalizeDateOrNull(value) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : toMysqlDateTime(parsed);
}

async function bootstrap() {
  await initDb();

  connectMqtt(async (payload) => {
    try {
      await saveQcEvent(normalizeEventPayload(payload));
      await pushRealtimeUpdate(io);
    } catch (error) {
      console.error("Failed to save MQTT event:", error.message);
    }
  });

  server.listen(port, () => {
    console.log(`QC monitoring server running on http://localhost:${port}`);
  });
}

function toMysqlDateTime(value) {
  return new Date(value).toISOString().slice(0, 23).replace("T", " ");
}

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
