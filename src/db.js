const path = require("path");
const Database = require("better-sqlite3");

let db;

function initDb() {
  if (db) {
    return db;
  }

  const dbPath = path.join(__dirname, "..", "data.db");
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS stations (
      machine_code TEXT PRIMARY KEY,
      station_name TEXT NOT NULL,
      ideal_cycle_seconds REAL NOT NULL DEFAULT 30,
      planned_runtime_seconds REAL NOT NULL DEFAULT 28800,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS qc_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      machine_code TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      event_type TEXT NOT NULL,
      result TEXT,
      duration_seconds REAL,
      meta_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(machine_code) REFERENCES stations(machine_code)
    );

    CREATE INDEX IF NOT EXISTS idx_qc_events_machine_code_timestamp
      ON qc_events(machine_code, timestamp);
  `);

  return db;
}

function getDb() {
  if (!db) {
    initDb();
  }
  return db;
}

function upsertStationConfig({ machineCode, stationName, idealCycleSeconds, plannedRuntimeSeconds }) {
  const stmt = getDb().prepare(`
    INSERT INTO stations (machine_code, station_name, ideal_cycle_seconds, planned_runtime_seconds, updated_at)
    VALUES (@machineCode, @stationName, @idealCycleSeconds, @plannedRuntimeSeconds, CURRENT_TIMESTAMP)
    ON CONFLICT(machine_code)
    DO UPDATE SET
      station_name = excluded.station_name,
      ideal_cycle_seconds = excluded.ideal_cycle_seconds,
      planned_runtime_seconds = excluded.planned_runtime_seconds,
      updated_at = CURRENT_TIMESTAMP
  `);

  stmt.run({ machineCode, stationName, idealCycleSeconds, plannedRuntimeSeconds });
}

function saveQcEvent(event) {
  upsertStationConfig({
    machineCode: event.machineCode,
    stationName: event.stationName,
    idealCycleSeconds: Number(process.env.DEFAULT_IDEAL_CYCLE_SECONDS || 30),
    plannedRuntimeSeconds: Number(process.env.DEFAULT_PLANNED_RUNTIME_SECONDS || 28800)
  });

  let durationSeconds = null;
  if (event.eventType === "qc_end") {
    const latestStart = getDb().prepare(`
      SELECT timestamp
      FROM qc_events
      WHERE machine_code = ? AND event_type = 'qc_start'
      ORDER BY timestamp DESC
      LIMIT 1
    `).get(event.machineCode);

    if (latestStart) {
      durationSeconds = Math.max(
        0,
        Math.round((new Date(event.timestamp).getTime() - new Date(latestStart.timestamp).getTime()) / 1000)
      );
    }
  }

  const result = getDb().prepare(`
    INSERT INTO qc_events (machine_code, timestamp, event_type, result, duration_seconds, meta_json)
    VALUES (@machineCode, @timestamp, @eventType, @result, @durationSeconds, @metaJson)
  `).run({
    machineCode: event.machineCode,
    timestamp: event.timestamp,
    eventType: event.eventType,
    result: event.result,
    durationSeconds,
    metaJson: event.metaJson
  });

  return { eventId: result.lastInsertRowid, durationSeconds };
}

module.exports = {
  initDb,
  getDb,
  upsertStationConfig,
  saveQcEvent
};
