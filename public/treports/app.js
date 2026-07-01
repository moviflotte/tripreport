import {
  todayISODate,
  mapVehicleRows,
  fetchHistoricalPositions,
} from "./report-utils.js";

const API_BASE = "/api";

const versionBadge = document.querySelector(".version-badge");
const progressBar = document.querySelector("#progressBar");
const progressFill = document.querySelector("#progressFill");
const dateInput = document.querySelector("#reportDate");
const timeInput = document.querySelector("#reportTime");
const reportRows = document.querySelector("#reportRows");
const tableTitle = document.querySelector("#tableTitle");
const reportSummary = document.querySelector("#reportSummary");
const emptyState = document.querySelector("#emptyState");
const printButton = document.querySelector("#printReport");
const excelLink = document.querySelector("#excelReport");
const printLogo = document.querySelector("#printLogo");

const numberFormatter = new Intl.NumberFormat("fr-FR");
const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  year: "numeric",
  month: "short",
  day: "2-digit",
});
let activeLoadId = 0;

function formatDate(date) {
  const parsedDate = new Date(`${date}T00:00:00`);
  return dateFormatter.format(parsedDate);
}

async function fetchJson(path) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: "application/json" },
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(`API ${response.status} ${response.statusText}`);
  }

  return response.json();
}

function showProgress(indeterminate) {
  progressBar.hidden = false;
  progressBar.classList.toggle("indeterminate", indeterminate);
  progressFill.style.width = indeterminate ? "" : "0%";
}

function updateProgress(done, total) {
  progressFill.style.width = `${Math.round(done / total * 100)}%`;
}

function hideProgress() {
  progressBar.hidden = true;
  progressBar.classList.remove("indeterminate");
  progressFill.style.width = "0%";
}

function setLoadingState(mode) {
  const selectedDate = dateInput.value;

  tableTitle.textContent = `Relevés du ${formatDate(selectedDate)}`;
  reportSummary.textContent =
    mode === "historical"
      ? "Chargement de l'historique des véhicules..."
      : "Chargement des véhicules depuis l'API...";
  reportRows.innerHTML = "";
  emptyState.hidden = true;
  showProgress(mode === "latest");
}

function renderRows(rows) {
  hideProgress();
  const selectedDate = dateInput.value;

  tableTitle.textContent = `Relevés du ${formatDate(selectedDate)}`;
  reportSummary.textContent = `${rows.length} véhicules audités le ${formatDate(selectedDate)}.`;
  reportRows.innerHTML = "";
  emptyState.textContent = "Aucun véhicule n'a été retourné par l'API.";
  emptyState.hidden = rows.length > 0;

  rows.forEach((item) => {
    const row = document.createElement("tr");
    const vehicleCell = document.createElement("td");
    const odometerCell = document.createElement("td");
    const fuelLevelCell = document.createElement("td");
    const fuelLitersCell = document.createElement("td");
    const driverCell = document.createElement("td");

    vehicleCell.textContent = item.vehicle;
    odometerCell.textContent =
      item.odometer == null ? "—" : `${numberFormatter.format(Math.round(item.odometer))} km`;
    fuelLevelCell.textContent =
      item.fuelLevel == null ? "—" : `${numberFormatter.format(Math.round(item.fuelLevel))}%`;
    fuelLitersCell.textContent =
      item.fuelLiters == null ? "—" : `${numberFormatter.format(item.fuelLiters)} L`;
    driverCell.textContent = item.driver ?? "—";

    row.append(vehicleCell, odometerCell, fuelLevelCell, fuelLitersCell, driverCell);
    reportRows.append(row);
  });
}

function renderError(error) {
  hideProgress();
  console.error("[treports] failed to load vehicles", error);

  tableTitle.textContent = "Relevés indisponibles";
  reportSummary.textContent = "Impossible de charger les véhicules depuis l'API.";
  reportRows.innerHTML = "";
  emptyState.textContent = "Vérifiez votre session et réessayez.";
  emptyState.hidden = false;
}

function updateExcelLink() {
  const params = new URLSearchParams({ date: dateInput.value, time: timeInput.value });
  excelLink.href = `/treports/vehicles-xlsx?${params}`;
}

async function loadReport() {
  const loadId = ++activeLoadId;
  const selectedDate = dateInput.value;
  const selectedTime = timeInput.value;
  const isLive = selectedDate === today && selectedTime === "23:59:59";

  updateExcelLink();
  setLoadingState(isLive ? "latest" : "historical");

  try {
    const [devices, drivers] = await Promise.all([
      fetchJson("/devices"),
      fetchJson("/drivers").catch(() => []),
    ]);
    const driverByUniqueId = new Map(drivers.map((d) => [d.uniqueId, d.name]));
    const positions = isLive
      ? await fetchJson("/positions")
      : await fetchHistoricalPositions(devices, selectedDate, selectedTime, fetchJson, updateProgress);

    if (loadId !== activeLoadId) return;
    renderRows(
      mapVehicleRows(devices, positions, { useDeviceAttributes: isLive, driverByUniqueId })
    );
  } catch (error) {
    if (loadId !== activeLoadId) return;
    renderError(error);
  }
}

const today = todayISODate();

dateInput.max = today;
dateInput.value = today;
dateInput.disabled = false;

timeInput.value = "23:59:59";

dateInput.addEventListener("change", loadReport);
timeInput.addEventListener("change", loadReport);
printButton.addEventListener("click", () => window.print());
updateExcelLink();

fetch("/treports/version")
  .then((r) => r.json())
  .then(({ version }) => { versionBadge.textContent = `v${version}`; })
  .catch(() => {});

printLogo.src = `/img/logos/${window.location.hostname}.png`;
printLogo.addEventListener("error", () => {
  printLogo.hidden = true;
});

loadReport();
