async function buildDashboardSummary(db) {
  const [stations] = await db.query(`
    SELECT
      s.machine_code AS machineCode,
      s.station_name AS stationName,
      s.ideal_cycle_seconds AS idealCycleSeconds,
      s.planned_runtime_seconds AS plannedRuntimeSeconds,
      MAX(e.timestamp) AS lastEventAt
    FROM stations s
    LEFT JOIN qc_events e ON e.machine_code = s.machine_code
    GROUP BY s.machine_code, s.station_name, s.ideal_cycle_seconds, s.planned_runtime_seconds
    ORDER BY s.machine_code
  `);

  const stationMetrics = await Promise.all(stations.map((station) => buildStationMetrics(db, station)));

  return {
    generatedAt: new Date().toISOString(),
    totals: stationMetrics.reduce(
      (acc, item) => {
        acc.productionCount += item.productionCount;
        acc.goodCount += item.goodCount;
        acc.rejectCount += item.rejectCount;
        acc.totalActualOperatingSeconds += item.actualOperatingSeconds;
        acc.totalDowntimeSeconds += item.downtimeSeconds;
        return acc;
      },
      { productionCount: 0, goodCount: 0, rejectCount: 0, totalActualOperatingSeconds: 0, totalDowntimeSeconds: 0 }
    ),
    stations: stationMetrics
  };
}

async function buildStationHistory(db, machineCode) {
  const [stationRows] = await db.execute(
    `
      SELECT
        machine_code AS machineCode,
        station_name AS stationName,
        ideal_cycle_seconds AS idealCycleSeconds,
        planned_runtime_seconds AS plannedRuntimeSeconds
      FROM stations
      WHERE machine_code = ?
    `,
    [machineCode]
  );

  const station = stationRows[0];
  if (!station) {
    return { machineCode, stationName: machineCode, events: [] };
  }

  const metrics = await buildStationMetrics(db, station);

  const [events] = await db.execute(
    `
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
    `,
    [machineCode]
  );

  return {
    ...station,
    downtimeSeconds: metrics.downtimeSeconds,
    downtimeCount: metrics.downtimeCount,
    actualOperatingSeconds: metrics.actualOperatingSeconds,
    productionCount: metrics.productionCount,
    events: events.map(normalizeEventRow)
  };
}

async function buildStationMetrics(db, station) {
  const [aggregateRows] = await db.execute(
    `
      SELECT
        SUM(CASE WHEN event_type = 'qc_end' AND result IS NOT NULL THEN 1 ELSE 0 END) AS productionCount,
        SUM(CASE WHEN event_type = 'qc_end' AND result = 'GOOD' THEN 1 ELSE 0 END) AS goodCount,
        SUM(CASE WHEN event_type = 'qc_end' AND result = 'REJECT' THEN 1 ELSE 0 END) AS rejectCount,
        SUM(CASE WHEN event_type = 'qc_end' AND duration_seconds IS NOT NULL THEN COALESCE(duration_seconds, 0) ELSE 0 END) AS totalDurationSeconds,
        SUM(CASE WHEN event_type = 'qc_end' AND result IS NULL AND duration_seconds IS NOT NULL AND duration_seconds < 3600 THEN COALESCE(duration_seconds, 0) ELSE 0 END) AS downtimeSeconds,
        SUM(CASE WHEN event_type = 'qc_end' AND result IS NULL AND duration_seconds IS NOT NULL AND duration_seconds < 3600 THEN 1 ELSE 0 END) AS downtimeCount,
        SUM(CASE WHEN event_type = 'qc_end' AND result IS NOT NULL AND duration_seconds IS NOT NULL THEN 1 ELSE 0 END) AS durationCount
      FROM qc_events
      WHERE machine_code = ?
    `,
    [station.machineCode]
  );

  const [latestEndRows] = await db.execute(
    `
      SELECT duration_seconds AS durationSeconds
      FROM qc_events
      WHERE machine_code = ? AND event_type = 'qc_end' AND result IS NOT NULL
      ORDER BY timestamp DESC
      LIMIT 1
    `,
    [station.machineCode]
  );

  const aggregate = aggregateRows[0] || {};
  const latestEnd = latestEndRows[0];
  const productionCount = Number(aggregate.productionCount || 0);
  const goodCount = Number(aggregate.goodCount || 0);
  const rejectCount = Number(aggregate.rejectCount || 0);
  const totalDurationSeconds = Number(aggregate.totalDurationSeconds || 0);
  const downtimeSeconds = Number(aggregate.downtimeSeconds || 0);
  const downtimeCount = Number(aggregate.downtimeCount || 0);
  // const actualOperatingSeconds = Math.max(totalDurationSeconds - downtimeSeconds, 0);
  const actualOperatingSeconds = Math.max(Number(station.plannedRuntimeSeconds) - downtimeSeconds, 0);
  const durationCount = Number(aggregate.durationCount || 0);
  const avgQcSeconds = durationCount ? actualOperatingSeconds / durationCount : null;
  const lastCycleSeconds = latestEnd && latestEnd.durationSeconds !== null ? Number(latestEnd.durationSeconds) : null;
  const quality = productionCount ? goodCount / productionCount : 0;
  const availability = Number(station.plannedRuntimeSeconds) > 0 ? Math.min(actualOperatingSeconds / Number(station.plannedRuntimeSeconds), 1) : 0;
  const performance = actualOperatingSeconds > 0 ? Math.min((Number(station.idealCycleSeconds) * productionCount) / actualOperatingSeconds, 1) : 0;
  const oee = availability * performance * quality;

  return {
    machineCode: station.machineCode,
    stationName: station.stationName,
    productionCount,
    goodCount,
    rejectCount,
    actualOperatingSeconds,
    downtimeSeconds,
    downtimeCount,
    avgQcSeconds: avgQcSeconds === null ? null : round2(avgQcSeconds),
    lastCycleSeconds,
    qualityRate: round2(quality * 100),
    availabilityRate: round2(availability * 100),
    performanceRate: round2(performance * 100),
    oeeRate: round2(oee * 100),
    idealCycleSeconds: Number(station.idealCycleSeconds),
    plannedRuntimeSeconds: Number(station.plannedRuntimeSeconds),
    lastEventAt: station.lastEventAt ? new Date(station.lastEventAt).toISOString() : null
  };
}

function normalizeEventRow(row) {
  return {
    ...row,
    timestamp: row.timestamp ? new Date(row.timestamp).toISOString() : null
  };
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

module.exports = {
  buildDashboardSummary,
  buildStationHistory
};
