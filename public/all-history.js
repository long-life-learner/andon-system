let allHistoryState = {
  currentData: null
};

document.getElementById("applyFilterBtn").addEventListener("click", loadAllHistory);
document.getElementById("resetFilterBtn").addEventListener("click", async () => {
  document.getElementById("fromInput").value = "";
  document.getElementById("toInput").value = "";
  await loadAllHistory();
});
document.getElementById("exportBtn").addEventListener("click", exportAllHistoryCsv);

loadAllHistory();

async function loadAllHistory() {
  const from = localInputToIso(document.getElementById("fromInput").value);
  const to = localInputToIso(document.getElementById("toInput").value);
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);

  const data = await fetchJson(`/api/events?${params.toString()}`);
  allHistoryState.currentData = data;
  renderAllHistory(data);
}

function renderAllHistory(data) {
  const events = data.events || [];
  const completed = events.filter((event) => event.eventType === "qc_end");
  const totalGood = completed.filter((event) => event.result === "GOOD").length;
  const totalReject = completed.filter((event) => event.result === "REJECT").length;

  document.getElementById("totalEvents").textContent = events.length;
  document.getElementById("totalStations").textContent = data.stations.length;
  document.getElementById("totalGood").textContent = totalGood;
  document.getElementById("totalReject").textContent = totalReject;
  document.getElementById("tableCaption").textContent = `${events.length} event pada seluruh station`;

  const series = data.stations.map((station) => ({
    name: station.machineCode,
    points: completed
      .filter((event) => event.machineCode === station.machineCode)
      .slice()
      .reverse()
      .map((event) => ({
        label: formatDateTime(event.timestamp).slice(11, 16),
        value: Number(event.durationSeconds || 0)
      }))
  }));

  renderMultiLineChart(document.getElementById("allStationsLineChart"), series);

  document.getElementById("eventTableBody").innerHTML = events.length
    ? events
        .map(
          (event) => `
            <tr>
              <td>${formatDateTime(event.timestamp)}</td>
              <td>${escapeHtml(event.machineCode)}</td>
              <td>${escapeHtml(event.stationName)}</td>
              <td>${escapeHtml(event.eventType)}</td>
              <td>${escapeHtml(event.result || "-")}</td>
              <td>${Number(event.durationSeconds || 0)}</td>
            </tr>
          `
        )
        .join("")
    : `<tr><td colspan="6" class="empty-cell">Belum ada data pada range ini.</td></tr>`;
}

async function fetchJson(url) {
  const response = await fetch(url);
  return response.json();
}

function exportAllHistoryCsv() {
  const data = allHistoryState.currentData;
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
      Number(event.durationSeconds || 0)
    ])
  ];

  downloadCsv("all-stations-history.csv", rows);
}
