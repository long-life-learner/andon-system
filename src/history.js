async function buildStationEventHistory(db, machineCode, range = {}) {
  const [stationRows] = await db.execute(
    `
      SELECT
        machine_code AS machineCode,
        station_name AS stationName,
        ideal_cycle_seconds AS idealCycleSeconds,
        planned_runtime_seconds AS plannedRuntimeSeconds,
        station_type AS stationType
      FROM stations
      WHERE machine_code = ?
    `,
    [machineCode]
  );

  const station = stationRows[0];
  if (!station) {
    return { machineCode, stationName: machineCode, events: [], filters: buildFilterEcho(range) };
  }

  const [events] = await db.execute(
    `
      SELECT
        q.id,
        q.machine_code AS machineCode,
        s.station_name AS stationName,
        q.timestamp,
        q.event_type AS eventType,
        q.result,
        q.duration_seconds AS durationSeconds,
        q.meta_json AS metaJson
      FROM qc_events q
      JOIN stations s ON s.machine_code = q.machine_code
      WHERE q.machine_code = ?
        AND (? IS NULL OR q.timestamp >= ?)
        AND (? IS NULL OR q.timestamp <= ?)
      ORDER BY q.timestamp DESC
    `,
    [machineCode, range.from || null, range.from || null, range.to || null, range.to || null]
  );

  return {
    ...station,
    filters: buildFilterEcho(range),
    events: events.map(normalizeEventRow)
  };
}

async function buildAllStationsEventHistory(db, range = {}) {
  const [events] = await db.execute(
    `
      SELECT
        q.id,
        q.machine_code AS machineCode,
        s.station_name AS stationName,
        q.timestamp,
        q.event_type AS eventType,
        q.result,
        q.duration_seconds AS durationSeconds,
        q.meta_json AS metaJson
      FROM qc_events q
      JOIN stations s ON s.machine_code = q.machine_code
      WHERE (? IS NULL OR q.timestamp >= ?)
        AND (? IS NULL OR q.timestamp <= ?)
      ORDER BY q.timestamp DESC
    `,
    [range.from || null, range.from || null, range.to || null, range.to || null]
  );

  const [stations] = await db.query(
    `
      SELECT
        machine_code AS machineCode,
        station_name AS stationName,
        ideal_cycle_seconds AS idealCycleSeconds,
        planned_runtime_seconds AS plannedRuntimeSeconds,
        station_type AS stationType
      FROM stations
      ORDER BY machine_code
    `
  );

  return {
    filters: buildFilterEcho(range),
    stations: stations.map((station) => ({
      ...station,
      idealCycleSeconds: Number(station.idealCycleSeconds),
      plannedRuntimeSeconds: Number(station.plannedRuntimeSeconds),
      stationType: normalizeStationType(station.stationType)
    })),
    events: events.map(normalizeEventRow)
  };
}

function normalizeEventRow(row) {
  return {
    ...row,
    timestamp: row.timestamp ? new Date(row.timestamp).toISOString() : null
  };
}

function buildFilterEcho(range) {
  return {
    from: range.from || null,
    to: range.to || null
  };
}

function normalizeStationType(value) {
  return String(value || "").trim().toLowerCase() === "quality_only" ? "quality_only" : "full";
}

module.exports = {
  buildStationEventHistory,
  buildAllStationsEventHistory
};
