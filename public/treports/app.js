const API_BASE = "/api";

const dateInput = document.querySelector("#reportDate");
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
const ROUTE_CONCURRENCY = 6;
let activeLoadId = 0;

function todayISODate() {
  const today = new Date();
  const offsetMs = today.getTimezoneOffset() * 60 * 1000;
  return new Date(today.getTime() - offsetMs).toISOString().slice(0, 10);
}

function formatDate(date) {
  const parsedDate = new Date(`${date}T00:00:00`);
  return dateFormatter.format(parsedDate);
}

function dateRangeParams(date) {
  return new URLSearchParams({
    from: `${date}T00:00:00Z`,
    to: `${date}T23:59:59Z`,
  });
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

async function mapWithConcurrency(items, limit, mapper) {
  const results = [];
  const running = new Set();
  let index = 0;

  const run = async (item, itemIndex) => {
    const promise = Promise.resolve()
      .then(() => mapper(item, itemIndex))
      .then((result) => {
        results[itemIndex] = result;
      })
      .finally(() => {
        running.delete(promise);
      });

    running.add(promise);
  };

  while (index < items.length) {
    while (running.size < limit && index < items.length) {
      await run(items[index], index);
      index++;
    }

    if (running.size) await Promise.race(running);
  }

  await Promise.all(running);

  return results;
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

function mapVehicleRows(devices, positions, options = {}) {
  const { useDeviceAttributes = true, driverByUniqueId = new Map() } = options;
  const positionByDeviceId = new Map(
    positions.map((position) => [position.deviceId, position])
  );

  return devices
    .map((device) => {
      const position = positionByDeviceId.get(device.id);
      const positionAttributes = position?.attributes ?? {};
      const deviceAttributes = useDeviceAttributes ? (device.attributes ?? {}) : {};
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
      const driverUniqueId = positionAttributes.driverUniqueId ?? null;
      const driver = driverUniqueId ? (driverByUniqueId.get(driverUniqueId) ?? driverUniqueId) : null;

      return {
        vehicle: device.name || device.uniqueId || `Véhicule ${device.id}`,
        odometer: normalizeKilometers(odometer),
        fuelLevel: normalizeFuelLevel(fuelLevel),
        driver,
      };
    })
    .sort((a, b) => a.vehicle.localeCompare(b.vehicle, "fr"));
}

function latestPositionForRoute(route) {
  if (!Array.isArray(route) || route.length === 0) return null;

  return [...route].sort((a, b) => {
    const aTime = new Date(a.fixTime || a.deviceTime || a.serverTime || 0).getTime();
    const bTime = new Date(b.fixTime || b.deviceTime || b.serverTime || 0).getTime();

    return aTime - bTime;
  }).at(-1);
}

async function fetchHistoricalPositions(devices, date) {
  const range = dateRangeParams(date);
  const positions = await mapWithConcurrency(
    devices,
    ROUTE_CONCURRENCY,
    async (device) => {
      const params = new URLSearchParams(range);
      params.set("deviceId", device.id);

      try {
        return latestPositionForRoute(
          await fetchJson(`/reports/route?${params}`)
        );
      } catch (error) {
        console.warn(
          `[treports] no route for device ${device.id} on ${date}`,
          error
        );
        return null;
      }
    }
  );

  return positions.filter(Boolean);
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
    const driverCell = document.createElement("td");

    vehicleCell.textContent = item.vehicle;
    odometerCell.textContent =
      item.odometer == null ? "—" : `${numberFormatter.format(Math.round(item.odometer))} km`;
    fuelCell.textContent =
      item.fuelLevel == null ? "—" : `${numberFormatter.format(Math.round(item.fuelLevel))}%`;
    driverCell.textContent = item.driver ?? "—";

    row.append(vehicleCell, odometerCell, fuelCell, driverCell);
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

function updateExcelLink() {
  const params = new URLSearchParams({ date: dateInput.value });
  excelLink.href = `/treports/vehicles-xlsx?${params}`;
}

async function loadReport() {
  const loadId = ++activeLoadId;
  const selectedDate = dateInput.value;
  const isToday = selectedDate === today;

  updateExcelLink();
  setLoadingState(isToday ? "latest" : "historical");

  try {
    const [devices, drivers] = await Promise.all([
      fetchJson("/devices"),
      fetchJson("/drivers").catch(() => []),
    ]);
    const driverByUniqueId = new Map(drivers.map((d) => [d.uniqueId, d.name]));
    const positions = isToday
      ? await fetchJson("/positions")
      : await fetchHistoricalPositions(devices, selectedDate);

    if (loadId !== activeLoadId) return;
    renderRows(
      mapVehicleRows(devices, positions, { useDeviceAttributes: isToday, driverByUniqueId })
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

dateInput.addEventListener("change", loadReport);
printButton.addEventListener("click", () => window.print());
updateExcelLink();

printLogo.src = `/img/logos/${window.location.hostname}.png`;
printLogo.addEventListener("error", () => {
  printLogo.hidden = true;
});

loadReport();
