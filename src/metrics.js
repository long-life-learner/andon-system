function buildDashboardSummary(db) {
  const stations = db.prepare(`
    SELECT
      s.machine_code AS machineCode,
      s.station_name AS stationName,
      s.ideal_cycle_seconds AS idealCycleSeconds,
      s.planned_runtime_seconds AS plannedRuntimeSeconds,
      MAX(e.timestamp) AS lastEventAt
    FROM stations s
    LEFT JOIN qc_events e ON e.machine_code = s.machine_code
    GROUP BY s.machine_code
    ORDER BY s.machine_code
  `).all();

  const stationMetrics = stations.map((station) => buildStationMetrics(db, station));

  return {
    generatedAt: new Date().toISOString(),
    totals: stationMetrics.reduce(
      (acc, item) => {
        acc.productionCount += item.productionCount;
        acc.goodCount += item.goodCount;
        acc.rejectCount += item.rejectCount;
        acc.totalQcSeconds += item.totalQcSeconds;
        return acc;
      },
      { productionCount: 0, goodCount: 0, rejectCount: 0, totalQcSeconds: 0 }
    ),
    stations: stationMetrics
  };
}

function buildStationHistory(db, machineCode) {
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
    return { machineCode, stationName: machineCode, events: [] };
  }

  const events = db.prepare(`
    SELECT
      id,
      timestamp,
      event_type AS eventType,
      result,
      duration_seconds AS durationSeconds,
      meta_json AS metaJson
    FROM qc_events
    WHERE machine_code = ?
    ORDER BY timestamp DESC
    LIMIT 10
  `).all(machineCode);

  return {
    ...station,
    events
  };
}

function buildStationMetrics(db, station) {
  const aggregate = db.prepare(`
    SELECT
      SUM(CASE WHEN event_type = 'qc_end' THEN 1 ELSE 0 END) AS productionCount,
      SUM(CASE WHEN event_type = 'qc_end' AND result = 'GOOD' THEN 1 ELSE 0 END) AS goodCount,
      SUM(CASE WHEN event_type = 'qc_end' AND result = 'REJECT' THEN 1 ELSE 0 END) AS rejectCount,
      SUM(CASE WHEN event_type = 'qc_end' THEN COALESCE(duration_seconds, 0) ELSE 0 END) AS totalQcSeconds
    FROM qc_events
    WHERE machine_code = ?
  `).get(station.machineCode);

  const latestEnd = db.prepare(`
    SELECT duration_seconds AS durationSeconds
    FROM qc_events
    WHERE machine_code = ? AND event_type = 'qc_end'
    ORDER BY timestamp DESC
    LIMIT 1
  `).get(station.machineCode);

  const productionCount = Number(aggregate.productionCount || 0);
  const goodCount = Number(aggregate.goodCount || 0);
  const rejectCount = Number(aggregate.rejectCount || 0);
  const totalQcSeconds = Number(aggregate.totalQcSeconds || 0);
  const avgQcSeconds = productionCount ? totalQcSeconds / productionCount : 0;
  const lastCycleSeconds = latestEnd ? Number(latestEnd.durationSeconds || 0) : 0;
  const quality = productionCount ? goodCount / productionCount : 0;
  const availability = station.plannedRuntimeSeconds > 0 ? Math.min(totalQcSeconds / station.plannedRuntimeSeconds, 1) : 0;
  const performance = totalQcSeconds > 0 ? Math.min((station.idealCycleSeconds * productionCount) / totalQcSeconds, 1) : 0;
  const oee = availability * performance * quality;

  return {
    machineCode: station.machineCode,
    stationName: station.stationName,
    productionCount,
    goodCount,
    rejectCount,
    totalQcSeconds,
    avgQcSeconds: round2(avgQcSeconds),
    lastCycleSeconds,
    qualityRate: round2(quality * 100),
    availabilityRate: round2(availability * 100),
    performanceRate: round2(performance * 100),
    oeeRate: round2(oee * 100),
    idealCycleSeconds: station.idealCycleSeconds,
    plannedRuntimeSeconds: station.plannedRuntimeSeconds,
    lastEventAt: station.lastEventAt
  };
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

module.exports = {
  buildDashboardSummary,
  buildStationHistory
};
