const socket = io();
let latestStations = [];
let selectedMachineCode = null;

socket.on("connect", () => {
  document.getElementById("connectionStatus").textContent = "Connected";
});

socket.on("disconnect", () => {
  document.getElementById("connectionStatus").textContent = "Disconnected";
});

socket.on("dashboard:update", (payload) => {
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
  renderHistory(data);
}

function renderOverview(payload) {
  const total = payload.totals.productionCount || 0;
  const good = payload.totals.goodCount || 0;
  const reject = payload.totals.rejectCount || 0;
  const yieldRate = total ? Math.round((good / total) * 100) : 0;
  const rejectRate = total ? Math.round((reject / total) * 100) : 0;

  document.getElementById("generatedAt").textContent = formatDateTime(payload.generatedAt);
  document.getElementById("totalProduction").textContent = total;
  document.getElementById("totalGood").textContent = good;
  document.getElementById("totalReject").textContent = reject;
  document.getElementById("totalQcTime").textContent = `${payload.totals.totalQcSeconds} s`;
  document.getElementById("yieldRate").textContent = `${yieldRate}%`;
  document.getElementById("legendGood").textContent = good;
  document.getElementById("legendReject").textContent = reject;
  document.getElementById("goodRateHint").textContent = `Yield ${yieldRate}%`;
  document.getElementById("rejectRateHint").textContent = `Reject ${rejectRate}%`;
  document.getElementById("productionHealth").textContent = `${latestStations.length} stasiun aktif`;

  document.getElementById("qualityDonut").style.setProperty("--good-angle", `${yieldRate * 3.6}deg`);
  renderStationPerformanceChart(payload.stations || []);
}

function renderStations(stations) {
  const stationList = document.getElementById("stationList");
  if (!stations.length) {
    stationList.innerHTML = `<div class="empty-state">Belum ada data stasiun. Kirim event MQTT dari ESP8266 untuk memulai.</div>`;
    return;
  }

  stationList.innerHTML = stations
    .map(
      (station) => {
        if (station.avgQcSeconds === null){
return `
        <article class="station-card ${station.machineCode === selectedMachineCode ? "active" : ""}" data-machine-code="${station.machineCode}">
          <div class="station-header">
            <div>
              <div class="station-code">${station.machineCode}</div>
              <h3>${station.stationName}</h3>
            </div>
          </div>
          <div class="station-metrics">
            <div class="metric-pill">
              <span>Produksi</span>
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
          </div>
        </article>
      `
        } else {
          
  const maxProduction = Math.max(station.productionCount, 1);

  const productionWidth = Math.max((station.productionCount / maxProduction) * 100, 4);
      
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
              <span>Produksi</span>
              <strong>${station.productionCount}</strong>
            </div>
            <div class="metric-pill">
              <span>GOOD / DEFECT</span>
              <strong>${station.goodCount} / ${station.rejectCount}</strong>
            </div>
             
            <div class="metric-pill">
              <span>Rata-rata QC</span>
              <strong>${formatDuration(station.avgQcSeconds)}</strong>
            </div>
            
          </div>
        </article>
      `
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
  const completedCycles = data.events.filter((event) => event.eventType === "qc_end" && event.durationSeconds !== null && event.durationSeconds !== undefined);

  document.getElementById("machineSummary").innerHTML = `
    <div class="metric-pill">
      <span>Ideal Cycle</span>
      <strong>${Number(data.idealCycleSeconds || 0)} s</strong>
    </div>
    <div class="metric-pill">
      <span>Planned Runtime</span>
      <strong>${Number(data.plannedRuntimeSeconds || 0)} s</strong>
    </div>
    <div class="metric-pill">
      <span>10 Event Terakhir</span>
      <strong>${data.events.length}</strong>
    </div>
  `;

  renderSelectedStationChart(completedCycles);

  const historyList = document.getElementById("historyList");
  if (!data.events.length) {
    historyList.innerHTML = `<div class="empty-state">Belum ada riwayat event untuk mesin ini.</div>`;
    return;
  }

  historyList.innerHTML = data.events
    .map((event) => {
      const resultClass = event.result === "GOOD" ? "result-good" : event.result === "REJECT" ? "result-reject" : "";
      return `
        <article class="history-item ${resultClass}">
          <time>${formatDateTime(event.timestamp)}</time>
          <strong>${event.eventType === "qc_start" ? "QC START" : "QC END"}</strong>
          <div class="history-meta">Result: ${event.result || "-"}</div>
          <div class="history-meta">Durasi QC: ${formatDuration(event.durationSeconds)}</div>
        </article>
      `;
    })
    .join("");
}

function renderStationPerformanceChart(stations) {
  const chart = document.getElementById("stationPerformanceChart");
  if (!stations.length) {
    chart.innerHTML = `<div class="empty-state">Belum ada data untuk divisualisasikan.</div>`;
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
    chart.innerHTML = `Belum ada data durasi siklus.`;
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

function highlightActiveStation() {
  document.querySelectorAll(".station-card").forEach((card) => {
    card.classList.toggle("active", card.dataset.machineCode === selectedMachineCode);
  });
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleString("id-ID", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function formatDuration(value) {
  return value === null || value === undefined ? "-" : `${Number(value)} s`;
}

function formatDurationCompact(value) {
  return value === null || value === undefined ? "-" : `${Number(value)}s`;
}
