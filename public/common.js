const TIME_DISPLAY_STORAGE_KEY = "iot.timeDisplayMode";

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

function formatLocalInput(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

function localInputToIso(value) {
  return value ? new Date(value).toISOString() : "";
}

function getTimeDisplayMode() {
  const saved = window.localStorage.getItem(TIME_DISPLAY_STORAGE_KEY);
  return saved === "human" ? "human" : "raw";
}

function setTimeDisplayMode(mode) {
  const normalizedMode = mode === "human" ? "human" : "raw";
  window.localStorage.setItem(TIME_DISPLAY_STORAGE_KEY, normalizedMode);
  window.dispatchEvent(new CustomEvent("time-display-mode-changed", { detail: normalizedMode }));
}

function initTimeDisplayToggle(root = document) {
  root.querySelectorAll("[data-time-display-toggle]").forEach((toggle) => {
    const buttons = [...toggle.querySelectorAll("[data-time-mode]")];
    const applyActiveState = () => {
      const currentMode = getTimeDisplayMode();
      buttons.forEach((button) => {
        button.classList.toggle("active", button.dataset.timeMode === currentMode);
      });
    };

    buttons.forEach((button) => {
      if (button.dataset.boundTimeToggle === "true") {
        return;
      }

      button.dataset.boundTimeToggle = "true";
      button.addEventListener("click", () => {
        setTimeDisplayMode(button.dataset.timeMode);
      });
    });

    applyActiveState();
    window.addEventListener("time-display-mode-changed", applyActiveState);
  });
}

function formatDuration(value, options = {}) {
  if (value === null || value === undefined || value === "") {
    return options.empty ?? "-";
  }

  const seconds = Math.max(0, Number(value));
  if (!Number.isFinite(seconds)) {
    return options.empty ?? "-";
  }

  return getTimeDisplayMode() === "human"
    ? formatHumanDuration(seconds, options)
    : `${seconds} s`;
}

function formatDurationCompact(value, options = {}) {
  if (value === null || value === undefined || value === "") {
    return options.empty ?? "-";
  }

  const seconds = Math.max(0, Number(value));
  if (!Number.isFinite(seconds)) {
    return options.empty ?? "-";
  }

  return getTimeDisplayMode() === "human"
    ? formatHumanDurationCompact(seconds)
    : `${seconds}s`;
}

function formatHumanDuration(totalSeconds, options = {}) {
  const seconds = Math.floor(totalSeconds);
  const parts = [];
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  if (days) parts.push(`${days} Day${days === 1 ? "" : "s"}`);
  if (hours) parts.push(`${hours} Hour${hours === 1 ? "" : "s"}`);
  if (minutes) parts.push(`${minutes} Minute${minutes === 1 ? "" : "s"}`);
  if (remainingSeconds || !parts.length) parts.push(`${remainingSeconds} Second${remainingSeconds === 1 ? "" : "s"}`);

  if (options.compactParts && parts.length > options.compactParts) {
    return parts.slice(0, options.compactParts).join(" ");
  }

  return parts.join(" ");
}

function formatHumanDurationCompact(totalSeconds) {
  const seconds = Math.floor(totalSeconds);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  const parts = [];

  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (remainingSeconds || !parts.length) parts.push(`${remainingSeconds}s`);

  return parts.slice(0, 2).join(" ");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function downloadCsv(filename, rows) {
  const csv = rows
    .map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function renderLineChart(container, points, options = {}) {
  if (!points.length) {
    container.innerHTML = `<div class="empty-state">No data available for visualization.</div>`;
    return;
  }

  const width = 960;
  const height = 280;
  const padding = 32;
  const values = points.map((point) => Number(point.value || 0));
  const maxValue = Math.max(...values, 1);

  const coords = points.map((point, index) => {
    const x = points.length === 1 ? width / 2 : padding + (index * (width - padding * 2)) / (points.length - 1);
    const y = height - padding - (Number(point.value || 0) / maxValue) * (height - padding * 2);
    return { ...point, x, y };
  });

  const polyline = coords.map((point) => `${point.x},${point.y}`).join(" ");
  const fillPath = `${polyline} ${coords.at(-1).x},${height - padding} ${coords[0].x},${height - padding}`;

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" class="line-chart-svg" role="img" aria-label="${escapeHtml(options.title || "Line chart")}">
      <defs>
        <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="rgba(85,240,255,0.45)"></stop>
          <stop offset="100%" stop-color="rgba(85,240,255,0.03)"></stop>
        </linearGradient>
      </defs>
      <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" class="chart-axis"></line>
      <line x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}" class="chart-axis"></line>
      <polygon points="${fillPath}" class="chart-area"></polygon>
      <polyline points="${polyline}" class="chart-line"></polyline>
      ${coords
        .map(
          (point) => `
            <circle cx="${point.x}" cy="${point.y}" r="4" class="chart-point"></circle>
            <text x="${point.x}" y="${height - 10}" text-anchor="middle" class="chart-label">${escapeHtml(point.label)}</text>
          `
        )
        .join("")}
    </svg>
  `;
}

function renderMultiLineChart(container, series) {
  const activeSeries = series.filter((item) => item.points.length);
  if (!activeSeries.length) {
    container.innerHTML = `<div class="empty-state">No data available for visualization.</div>`;
    return;
  }

  const width = 960;
  const height = 320;
  const padding = 34;
  const colorPalette = ["#55f0ff", "#ff6b9f", "#ffbf69", "#2fe1c8", "#9f7aea", "#f97316"];
  const allPoints = activeSeries.flatMap((item) => item.points.map((point) => Number(point.value || 0)));
  const maxValue = Math.max(...allPoints, 1);
  const labels = [...new Set(activeSeries.flatMap((item) => item.points.map((point) => point.label)))];

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" class="line-chart-svg" role="img" aria-label="Multi line chart">
      <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" class="chart-axis"></line>
      <line x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}" class="chart-axis"></line>
      ${activeSeries
        .map((item, seriesIndex) => {
          const coords = item.points.map((point) => {
            const labelIndex = labels.indexOf(point.label);
            const x = labels.length === 1 ? width / 2 : padding + (labelIndex * (width - padding * 2)) / (labels.length - 1);
            const y = height - padding - (Number(point.value || 0) / maxValue) * (height - padding * 2);
            return { ...point, x, y };
          });

          const polyline = coords.map((point) => `${point.x},${point.y}`).join(" ");
          const color = colorPalette[seriesIndex % colorPalette.length];
          return `
            <polyline points="${polyline}" fill="none" stroke="${color}" stroke-width="3"></polyline>
            ${coords.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="3.5" fill="${color}"></circle>`).join("")}
          `;
        })
        .join("")}
      ${labels
        .map((label, index) => {
          const x = labels.length === 1 ? width / 2 : padding + (index * (width - padding * 2)) / (labels.length - 1);
          return `<text x="${x}" y="${height - 10}" text-anchor="middle" class="chart-label">${escapeHtml(label)}</text>`;
        })
        .join("")}
    </svg>
    <div class="chart-legend">
      ${activeSeries
        .map((item, index) => {
          const color = colorPalette[index % colorPalette.length];
          return `
            <div class="legend-chip">
              <span class="legend-chip-dot" style="background:${color}"></span>
              <span>${escapeHtml(item.name)}</span>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}
