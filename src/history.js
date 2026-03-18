function buildStationEventHistory(db, machineCode, range = {}) {
  const station = db.prepare(`
    SELECT
      machine_code AS machineCode,
      station_name AS stationName,
      ideal_cycle_seconds AS idealCycleSeconds,
      planned_runtime_seconds AS plannedRuntimeSeconds
    FROM stations
    WHERE machine_code = ?
  `).get(machineCode);

  if (!station) {
    return { machineCode, stationName: machineCode, events: [], filters: buildFilterEcho(range) };
  }

  const events = db.prepare(`
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
    WHERE q.machine_code = @machineCode
      AND (@fromTs IS NULL OR q.timestamp >= @fromTs)
      AND (@toTs IS NULL OR q.timestamp <= @toTs)
    ORDER BY q.timestamp DESC
  `).all({
    machineCode,
    fromTs: range.from || null,
    toTs: range.to || null
  });

  return {
    ...station,
    filters: buildFilterEcho(range),
    events
  };
}

function buildAllStationsEventHistory(db, range = {}) {
  const events = db.prepare(`
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
    WHERE (@fromTs IS NULL OR q.timestamp >= @fromTs)
      AND (@toTs IS NULL OR q.timestamp <= @toTs)
    ORDER BY q.timestamp DESC
  `).all({
    fromTs: range.from || null,
    toTs: range.to || null
  });

  const stations = db.prepare(`
    SELECT
      machine_code AS machineCode,
      station_name AS stationName,
      ideal_cycle_seconds AS idealCycleSeconds,
      planned_runtime_seconds AS plannedRuntimeSeconds
    FROM stations
    ORDER BY machine_code
  `).all();

  return {
    filters: buildFilterEcho(range),
    stations,
    events
  };
}

function buildFilterEcho(range) {
  return {
    from: range.from || null,
    to: range.to || null
  };
}

module.exports = {
  buildStationEventHistory,
  buildAllStationsEventHistory
};
