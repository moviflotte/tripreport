const API_BASE = "/api";

const dateInput = document.querySelector("#reportDate");
const reportRows = document.querySelector("#reportRows");
const tableTitle = document.querySelector("#tableTitle");
const reportSummary = document.querySelector("#reportSummary");
const emptyState = document.querySelector("#emptyState");
const printButton = document.querySelector("#printReport");
const printLogo = document.querySelector("#printLogo");

const numberFormatter = new Intl.NumberFormat("fr-FR");
const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  year: "numeric",
  month: "short",
  day: "2-digit",
});

function todayISODate() {
  const today = new Date();
  const offsetMs = today.getTimezoneOffset() * 60 * 1000;
  return new Date(today.getTime() - offsetMs).toISOString().slice(0, 10);
}

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

function findNumericValue(source, keys) {
  for (const key of keys) {
    const value = source?.[key];
    const number = Number(value);

    if (Number.isFinite(number)) return number;
  }

  return null;
}

function normalizeKilometers(value) {
  if (value == null) return null;

  return value > 100000 ? value / 1000 : value;
}

function normalizeFuelLevel(value) {
  if (value == null) return null;

  const percent = value > 0 && value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, percent));
}

function mapVehicleRows(devices, positions) {
  const positionByDeviceId = new Map(
    positions.map((position) => [position.deviceId, position])
  );

  return devices
    .map((device) => {
      const position = positionByDeviceId.get(device.id);
      const positionAttributes = position?.attributes ?? {};
      const deviceAttributes = device.attributes ?? {};
      const odometer = findNumericValue(positionAttributes, [
        "odometer",
        "totalDistance",
        "distance",
      ]) ?? findNumericValue(deviceAttributes, ["odometer", "totalDistance", "distance"]);
      const fuelLevel = findNumericValue(positionAttributes, [
        "fuelLevel",
        "fuel",
        "fuelPercent",
      ]) ?? findNumericValue(deviceAttributes, ["fuelLevel", "fuel", "fuelPercent"]);

      return {
        vehicle: device.name || device.uniqueId || `Véhicule ${device.id}`,
        odometer: normalizeKilometers(odometer),
        fuelLevel: normalizeFuelLevel(fuelLevel),
      };
    })
    .sort((a, b) => a.vehicle.localeCompare(b.vehicle, "fr"));
}

function setLoadingState() {
  const selectedDate = dateInput.value;

  tableTitle.textContent = `Relevés du ${formatDate(selectedDate)}`;
  reportSummary.textContent = "Chargement des véhicules depuis l'API...";
  reportRows.innerHTML = "";
  emptyState.hidden = true;
}

function renderRows(rows) {
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
    const fuelCell = document.createElement("td");

    vehicleCell.textContent = item.vehicle;
    odometerCell.textContent =
      item.odometer == null ? "—" : `${numberFormatter.format(Math.round(item.odometer))} km`;
    fuelCell.textContent =
      item.fuelLevel == null ? "—" : `${numberFormatter.format(Math.round(item.fuelLevel))}%`;

    row.append(vehicleCell, odometerCell, fuelCell);
    reportRows.append(row);
  });
}

function renderError(error) {
  console.error("[treports] failed to load vehicles", error);

  tableTitle.textContent = "Relevés indisponibles";
  reportSummary.textContent = "Impossible de charger les véhicules depuis l'API.";
  reportRows.innerHTML = "";
  emptyState.textContent = "Vérifiez votre session et réessayez.";
  emptyState.hidden = false;
}

async function loadReport() {
  setLoadingState();

  try {
    const [devices, positions] = await Promise.all([
      fetchJson("/devices"),
      fetchJson("/positions"),
    ]);

    renderRows(mapVehicleRows(devices, positions));
  } catch (error) {
    renderError(error);
  }
}

const today = todayISODate();

dateInput.min = today;
dateInput.max = today;
dateInput.value = today;
dateInput.disabled = true;

dateInput.addEventListener("change", loadReport);
printButton.addEventListener("click", () => window.print());

printLogo.src = `/img/logos/${window.location.hostname}.png`;
printLogo.addEventListener("error", () => {
  printLogo.hidden = true;
});

loadReport();
