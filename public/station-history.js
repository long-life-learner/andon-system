let stationHistoryState = {
  stations: [],
  currentData: null
};

document.getElementById("applyFilterBtn").addEventListener("click", loadStationHistory);
document.getElementById("resetFilterBtn").addEventListener("click", async () => {
  document.getElementById("fromInput").value = "";
  document.getElementById("toInput").value = "";
  await loadStationHistory();
});
document.getElementById("exportBtn").addEventListener("click", exportStationCsv);
document.getElementById("stationSelect").addEventListener("change", loadStationHistory);

initStationHistoryPage();

async function initStationHistoryPage() {
  const summary = await fetchJson("/api/stations");
  stationHistoryState.stations = summary.stations || [];
  const select = document.getElementById("stationSelect");
  select.innerHTML = stationHistoryState.stations
    .map((station) => `<option value="${station.machineCode}">${station.machineCode} - ${escapeHtml(station.stationName)}</option>`)
    .join("");

  if (stationHistoryState.stations.length) {
    select.value = stationHistoryState.stations[0].machineCode;
    await loadStationHistory();
  }
}

async function loadStationHistory() {
  const machineCode = document.getElementById("stationSelect").value;
  if (!machineCode) {
    return;
  }

  const from = localInputToIso(document.getElementById("fromInput").value);
  const to = localInputToIso(document.getElementById("toInput").value);
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);

  const data = await fetchJson(`/api/stations/${machineCode}/events?${params.toString()}`);
  stationHistoryState.currentData = data;
  renderStationHistory(data);
}

function renderStationHistory(data) {
  const events = data.events || [];
  const completed = events.filter((event) => event.eventType === "qc_end");
  const totalGood = completed.filter((event) => event.result === "GOOD").length;
  const totalReject = completed.filter((event) => event.result === "REJECT").length;

  document.getElementById("totalEvents").textContent = events.length;
  document.getElementById("totalQcEnd").textContent = completed.length;
  document.getElementById("totalGood").textContent = totalGood;
  document.getElementById("totalReject").textContent = totalReject;
  document.getElementById("tableCaption").textContent = `${data.stationName} (${data.machineCode}) - ${events.length} event`;

  renderLineChart(
    document.getElementById("stationLineChart"),
    completed
      .filter((event) => event.durationSeconds !== null && event.durationSeconds !== undefined)
      .slice()
      .reverse()
      .map((event) => ({
        label: formatDateTime(event.timestamp).slice(11, 16),
        value: Number(event.durationSeconds ?? 0)
      })),
    { title: "Station cycle trend" }
  );

  document.getElementById("eventTableBody").innerHTML = events.length
    ? events
        .map(
          (event) => `
            <tr>
              <td>${formatDateTime(event.timestamp)}</td>
              <td>${escapeHtml(event.stationName)}</td>
              <td>${escapeHtml(event.eventType)}</td>
              <td>${escapeHtml(event.result || "-")}</td>
              <td>${formatDurationValue(event.durationSeconds)}</td>
            </tr>
          `
        )
        .join("")
    : `<tr><td colspan="5" class="empty-cell">Belum ada data pada range ini.</td></tr>`;
}

function exportStationCsv() {
  const data = stationHistoryState.currentData;
  if (!data || !data.events?.length) {
    return;
  }

  const rows = [
    ["Timestamp", "Machine Code", "Station Name", "Event Type", "Result", "Duration Seconds"],
    ...data.events.map((event) => [
      event.timestamp,
      event.machineCode,
      event.stationName,
      event.eventType,
      event.result || "",
      formatDurationValue(event.durationSeconds)
    ])
  ];

  downloadCsv(`${data.machineCode}-history.csv`, rows);
}

async function fetchJson(url) {
  const response = await fetch(url);
  return response.json();
}

function formatDurationValue(value) {
  return value === null || value === undefined ? "-" : Number(value);
}
