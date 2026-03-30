const socket = io();
let latestStations = [];
let selectedMachineCode = null;
let latestPayload = null;
let latestHistoryData = null;

initTimeDisplayToggle();

socket.on("connect", () => {
  document.getElementById("connectionStatus").textContent = "Connected";
});

socket.on("disconnect", () => {
  document.getElementById("connectionStatus").textContent = "Disconnected";
});

socket.on("dashboard:update", (payload) => {
  latestPayload = payload;
  latestStations = payload.stations || [];
  renderOverview(payload);
  renderStations(latestStations);

  if (!selectedMachineCode && latestStations.length) {
    selectedMachineCode = latestStations[0].machineCode;
  }

  if (selectedMachineCode) {
    loadHistory(selectedMachineCode);
  }
});

async function loadHistory(machineCode) {
  selectedMachineCode = machineCode;
  highlightActiveStation();
  const response = await fetch(`/api/stations/${machineCode}/history`);
  const data = await response.json();
  latestHistoryData = data;
  renderHistory(data);
}

function renderOverview(payload) {
  const total = payload.totals.productionCount || 0;
  const good = payload.totals.goodCount || 0;
  const reject = payload.totals.rejectCount || 0;
  const yieldRate = total ? Math.round((good / total) * 100) : 0;
  const rejectRate = total ? Math.round((reject / total) * 100) : 0;
  const actualOperatingSeconds = Number(payload.totals.totalActualOperatingSeconds || 0);
  const totalDowntimeSeconds = Number(payload.totals.totalDowntimeSeconds || 0);

  document.getElementById("generatedAt").textContent = formatDateTime(payload.generatedAt);
  document.getElementById("totalProduction").textContent = total;
  document.getElementById("totalGood").textContent = good;
  document.getElementById("totalReject").textContent = reject;
  document.getElementById("totalQcTime").textContent = formatDuration(actualOperatingSeconds);
  document.getElementById("yieldRate").textContent = `${yieldRate}%`;
  document.getElementById("legendGood").textContent = good;
  document.getElementById("legendReject").textContent = reject;
  document.getElementById("goodRateHint").textContent = `Yield ${yieldRate}%`;
  document.getElementById("rejectRateHint").textContent = `Reject ${rejectRate}%`;
  document.getElementById("productionHealth").textContent = `${latestStations.length} active stations, downtime ${formatDurationCompact(totalDowntimeSeconds)}`;

  document.getElementById("qualityDonut").style.setProperty("--good-angle", `${yieldRate * 3.6}deg`);
  renderStationPerformanceChart(payload.stations || []);
}

function renderStations(stations) {
  const stationList = document.getElementById("stationList");
  if (!stations.length) {
    stationList.innerHTML = `<div class="empty-state">No station data yet. Send MQTT events from ESP8266 to get started.</div>`;
    return;
  }

  stationList.innerHTML = stations
    .map(
      (station) => {
        if (station.stationType === "quality_only") {
          return `
        <article class="station-card ${station.machineCode === selectedMachineCode ? "active" : ""}" data-machine-code="${station.machineCode}">
          <div class="station-header">
            <div>
              <div class="station-code">${station.machineCode}</div>
              <h3>${station.stationName}</h3>
            </div>
            <div class="badge oee">QUALITY ONLY</div>
          </div>
          <div class="station-metrics">
            <div class="metric-pill">
              <span>Production</span>
              <strong>${station.productionCount}</strong>
            </div>
            <div class="metric-pill">
              <span>GOOD / DEFECT</span>
              <strong>${station.goodCount} / ${station.rejectCount}</strong>
            </div>
            <div class="metric-pill">
              <span>Quality</span>
              <strong>${station.qualityRate}%</strong>
            </div>
            <div class="metric-pill">
              <span>Downtime</span>
              <strong>${formatDowntime(station.downtimeSeconds, station.downtimeCount)}</strong>
            </div>
            <div class="metric-pill">
              <span>Actual Operating Time</span>
              <strong>${formatDuration(station.actualOperatingSeconds)}</strong>
            </div>
          </div>
        </article>
      `;
        } else {
          const productionWidth = Math.max(station.performanceRate || 0, 4);

          return `
        <article class="station-card ${station.machineCode === selectedMachineCode ? "active" : ""}" data-machine-code="${station.machineCode}">
          <div class="station-header">
            <div>
              <div class="station-code">${station.machineCode}</div>
              <h3>${station.stationName}</h3>
            </div>
            <div class="badge oee">${station.oeeRate}% OEE</div>
          </div>
          <div class="station-metrics">
           
            <div class="metric-pill">
              <span>Availability</span>
              <strong>${station.availabilityRate}%</strong>
            </div>
            <div class="metric-pill">
              <span>Performance</span>
              <strong>${productionWidth} %</strong>
            </div>
            <div class="metric-pill">
              <span>Quality</span>
              <strong>${station.qualityRate}%</strong>
            </div>
            
            <div class="metric-pill">
              <span>Production</span>
              <strong>${station.productionCount}</strong>
            </div>
            <div class="metric-pill">
              <span>GOOD / DEFECT</span>
              <strong>${station.goodCount} / ${station.rejectCount}</strong>
            </div>
            <div class="metric-pill">
              <span>Downtime</span>
              <strong>${formatDowntime(station.downtimeSeconds, station.downtimeCount)}</strong>
            </div>
            <div class="metric-pill">
              <span>Actual Operating Time</span>
              <strong>${formatDuration(station.actualOperatingSeconds)}</strong>
            </div>
            <div class="metric-pill">
              <span>Average Operating Time</span>
              <strong>${formatDuration(station.avgQcSeconds)}</strong>
            </div>
          </div>
        </article>
      `;
        }
      }
    )
    .join("");

  stationList.querySelectorAll(".station-card").forEach((card) => {
    card.addEventListener("click", () => {
      loadHistory(card.dataset.machineCode);
    });
  });
}

function renderHistory(data) {
  document.getElementById("detailMachine").textContent = `${data.stationName} (${data.machineCode})`;
  const completedCycles = data.events.filter(
    (event) =>
      event.eventType === "qc_end" &&
      event.result &&
      event.durationSeconds !== null &&
      event.durationSeconds !== undefined
  );
  const totalDowntimeSeconds = Number(data.downtimeSeconds || 0);
  const downtimeCount = Number(data.downtimeCount || 0);

  document.getElementById("machineSummary").innerHTML = `
    <div class="metric-pill">
      <span>Ideal Cycle</span>
      <strong>${formatDuration(data.idealCycleSeconds)}</strong>
    </div>
    <div class="metric-pill">
      <span>Planned Runtime</span>
      <strong>${formatDuration(data.plannedRuntimeSeconds)}</strong>
    </div>
    <div class="metric-pill">
      <span>Last 10 Events</span>
      <strong>${data.events.length}</strong>
    </div>
    <div class="metric-pill">
      <span>Downtime</span>
      <strong>${formatDowntime(totalDowntimeSeconds, downtimeCount)}</strong>
    </div>
  `;

  renderSelectedStationChart(completedCycles);

  const historyList = document.getElementById("historyList");
  if (!data.events.length) {
    historyList.innerHTML = `<div class="empty-state">No event history for this machine yet.</div>`;
    return;
  }

  historyList.innerHTML = data.events
    .map((event) => {
      const downtime = isDowntimeEvent(event);
      const resultClass = event.result === "GOOD" ? "result-good" : event.result === "REJECT" ? "result-reject" : "";
      const eventLabel = downtime ? "DOWNTIME" : event.eventType === "qc_start" ? "QC START" : "QC END";
      const resultLabel = downtime ? "DOWNTIME" : event.result || "-";
      const durationLabel = downtime ? "Downtime Duration" : "Operating Duration";
      return `
        <article class="history-item ${resultClass}">
          <time>${formatDateTime(event.timestamp)}</time>
          <strong>${eventLabel}</strong>
          <div class="history-meta">Result: ${resultLabel}</div>
          <div class="history-meta">${durationLabel}: ${formatDuration(event.durationSeconds)}</div>
        </article>
      `;
    })
    .join("");
}

function renderStationPerformanceChart(stations) {
  const chart = document.getElementById("stationPerformanceChart");
  if (!stations.length) {
    chart.innerHTML = `<div class="empty-state">No data available for visualization.</div>`;
    return;
  }

  const maxProduction = Math.max(...stations.map((station) => station.productionCount), 1);
  chart.innerHTML = stations
    .map((station) => {
      const productionWidth = Math.max((station.productionCount / maxProduction) * 100, 4);
      return `
        <div class="bar-row">
          <div class="bar-info">
            <strong>${station.machineCode}</strong>
            <br>
            <span>${station.stationName}</span>
          </div>
          <div class="bar-track">
            <div class="bar-fill" style="width:${productionWidth}%"></div>
          </div>
          <div class="bar-metrics">
            <span>${station.productionCount} unit</span>
            <strong>${station.oeeRate}% OEE</strong>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderSelectedStationChart(cycles) {
  const chart = document.getElementById("selectedStationChart");
  if (!cycles.length) {
    chart.innerHTML = `No production duration data yet. Downtime events are excluded from this chart.`;
    return;
  }

  const recentCycles = [...cycles].reverse();
  const maxDuration = Math.max(...recentCycles.map((cycle) => Number(cycle.durationSeconds || 0)), 1);

  chart.innerHTML = recentCycles
    .map((cycle, index) => {
      const height = Math.max((Number(cycle.durationSeconds || 0) / maxDuration) * 100, 12);
      const barClass = cycle.result === "GOOD" ? "cycle-good" : "cycle-reject";
      return `
        <div class="cycle-col">
          <div class="cycle-bar-wrap">
            <div class="cycle-bar ${barClass}" style="height:${height}%"></div>
          </div>
          <strong>${formatDurationCompact(cycle.durationSeconds)}</strong>
          <span>#${index + 1}</span>
        </div>
      `;
    })
    .join("");
}

window.addEventListener("time-display-mode-changed", () => {
  if (latestPayload) {
    renderOverview(latestPayload);
    renderStations(latestStations);
    highlightActiveStation();
  }

  if (latestHistoryData) {
    renderHistory(latestHistoryData);
  }
});

function highlightActiveStation() {
  document.querySelectorAll(".station-card").forEach((card) => {
    card.classList.toggle("active", card.dataset.machineCode === selectedMachineCode);
  });
}

function isDowntimeEvent(event) {
  return event.eventType === "qc_end" && !event.result && event.durationSeconds !== null && event.durationSeconds !== undefined && Number(event.durationSeconds) < 3600;
}

function formatDowntime(seconds, count) {
  return count ? `${formatDuration(seconds)} / ${count}x` : "-";
}
