loadSettings();

async function loadSettings() {
  const summary = await fetchJson("/api/stations");
  const stations = summary.stations || [];
  document.getElementById("settingsCaption").textContent = `${stations.length} station tersedia`;

  document.getElementById("settingsTableBody").innerHTML = stations.length
    ? stations
        .map(
          (station) => `
            <tr data-machine-code="${station.machineCode}">
              <td>${escapeHtml(station.machineCode)}</td>
              <td>${escapeHtml(station.stationName)}</td>
              <td><input class="table-input" type="number" min="1" value="${Number(station.idealCycleSeconds || 0)}" data-field="idealCycleSeconds" /></td>
              <td><input class="table-input" type="number" min="1" value="${Number(station.plannedRuntimeSeconds || 0)}" data-field="plannedRuntimeSeconds" /></td>
              <td><button class="primary-btn save-config-btn">Simpan</button></td>
            </tr>
          `
        )
        .join("")
    : `<tr><td colspan="5" class="empty-cell">Belum ada station.</td></tr>`;

  document.querySelectorAll(".save-config-btn").forEach((button) => {
    button.addEventListener("click", saveRow);
  });
}

async function saveRow(event) {
  const row = event.target.closest("tr");
  const machineCode = row.dataset.machineCode;
  const idealCycleSeconds = Number(row.querySelector('[data-field="idealCycleSeconds"]').value);
  const plannedRuntimeSeconds = Number(row.querySelector('[data-field="plannedRuntimeSeconds"]').value);
  const stationName = row.children[1].textContent.trim();

  await fetch(`/api/stations/${machineCode}/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      stationName,
      idealCycleSeconds,
      plannedRuntimeSeconds
    })
  });

  event.target.textContent = "Tersimpan";
  setTimeout(() => {
    event.target.textContent = "Simpan";
  }, 1200);
}

async function fetchJson(url) {
  const response = await fetch(url);
  return response.json();
}
