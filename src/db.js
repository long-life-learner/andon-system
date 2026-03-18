const mysql = require("mysql2/promise");

let pool;

async function initDb() {
  if (pool) {
    return pool;
  }

  pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
    queueLimit: 0,
    timezone: "Z"
  });

  await pool.query("SELECT 1");
  await createSchema();
  return pool;
}

function getDb() {
  if (!pool) {
    throw new Error("Database pool is not initialized");
  }

  return pool;
}

async function createSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stations (
      machine_code VARCHAR(64) PRIMARY KEY,
      station_name VARCHAR(255) NOT NULL,
      ideal_cycle_seconds DOUBLE NOT NULL DEFAULT 30,
      planned_runtime_seconds DOUBLE NOT NULL DEFAULT 28800,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS qc_events (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      machine_code VARCHAR(64) NOT NULL,
      timestamp DATETIME(3) NOT NULL,
      event_type VARCHAR(32) NOT NULL,
      result VARCHAR(32) NULL,
      duration_seconds DOUBLE NULL,
      meta_json JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_qc_events_station FOREIGN KEY (machine_code) REFERENCES stations(machine_code),
      INDEX idx_qc_events_machine_code_timestamp (machine_code, timestamp),
      INDEX idx_qc_events_timestamp (timestamp)
    )
  `);
}

async function upsertStationConfig({ machineCode, stationName, idealCycleSeconds, plannedRuntimeSeconds }) {
  await getDb().execute(
    `
      INSERT INTO stations (machine_code, station_name, ideal_cycle_seconds, planned_runtime_seconds)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        station_name = VALUES(station_name),
        ideal_cycle_seconds = VALUES(ideal_cycle_seconds),
        planned_runtime_seconds = VALUES(planned_runtime_seconds)
    `,
    [machineCode, stationName, idealCycleSeconds, plannedRuntimeSeconds]
  );
}

async function saveQcEvent(event) {
  await upsertStationConfig({
    machineCode: event.machineCode,
    stationName: event.stationName,
    idealCycleSeconds: Number(process.env.DEFAULT_IDEAL_CYCLE_SECONDS || 30),
    plannedRuntimeSeconds: Number(process.env.DEFAULT_PLANNED_RUNTIME_SECONDS || 28800)
  });

  let durationSeconds = null;
  if (event.eventType === "qc_end") {
    const [latestStartRows] = await getDb().execute(
      `
        SELECT timestamp
        FROM qc_events
        WHERE machine_code = ? AND event_type = 'qc_start'
        ORDER BY timestamp DESC
        LIMIT 1
      `,
      [event.machineCode]
    );

    const latestStart = latestStartRows[0];
    if (latestStart) {
      durationSeconds = Math.max(
        0,
        Math.round((new Date(event.timestamp).getTime() - new Date(latestStart.timestamp).getTime()) / 1000)
      );
    }
  }

  const [result] = await getDb().execute(
    `
      INSERT INTO qc_events (machine_code, timestamp, event_type, result, duration_seconds, meta_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    [event.machineCode, toMysqlDateTime(event.timestamp), event.eventType, event.result, durationSeconds, event.metaJson]
  );

  return { eventId: result.insertId, durationSeconds };
}

function toMysqlDateTime(value) {
  return new Date(value).toISOString().slice(0, 23).replace("T", " ");
}

module.exports = {
  initDb,
  getDb,
  upsertStationConfig,
  saveQcEvent
};
