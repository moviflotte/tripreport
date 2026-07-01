// Shared vehicle-report logic used by both the browser UI (app.js) and the
// Excel export function (functions/treports/vehicles-xlsx.js). Keeping this in
// one place avoids the two surfaces drifting apart and disagreeing on values.

export const ROUTE_CONCURRENCY = 6;

export function todayISODate() {
  const today = new Date();
  const offsetMs = today.getTimezoneOffset() * 60 * 1000;
  return new Date(today.getTime() - offsetMs).toISOString().slice(0, 10);
}

export function dateRangeParams(date, time = "23:59:59") {
  const to = new Date(`${date}T${time}Z`);
  const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);
  return new URLSearchParams({
    from: from.toISOString(),
    to: to.toISOString(),
  });
}

export async function mapWithConcurrency(items, limit, mapper) {
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

export function findNumericValue(source, keys) {
  for (const key of keys) {
    const value = source?.[key];
    const number = Number(value);

    if (Number.isFinite(number)) return number;
  }

  return null;
}

export function normalizeKilometers(value) {
  if (value == null) return null;

  return value > 100000 ? value / 1000 : value;
}

export function normalizeFuelLevel(value) {
  if (value == null) return null;

  const percent = value > 0 && value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, percent));
}

export function latestPositionForRoute(route) {
  if (!Array.isArray(route) || route.length === 0) return null;

  return [...route]
    .sort((a, b) => {
      const aTime = new Date(a.fixTime || a.deviceTime || a.serverTime || 0).getTime();
      const bTime = new Date(b.fixTime || b.deviceTime || b.serverTime || 0).getTime();

      return aTime - bTime;
    })
    .at(-1);
}

export function mapVehicleRows(devices, positions, options = {}) {
  const { useDeviceAttributes = true, driverByUniqueId = new Map() } = options;
  const positionByDeviceId = new Map(
    positions.map((position) => [position.deviceId, position])
  );

  return devices
    .map((device) => {
      const position = positionByDeviceId.get(device.id);
      const positionAttributes = position?.attributes ?? {};
      const deviceAttributes = useDeviceAttributes ? (device.attributes ?? {}) : {};
      const odometer =
        findNumericValue(positionAttributes, ["odometer", "totalDistance", "distance"]) ??
        findNumericValue(deviceAttributes, ["odometer", "totalDistance", "distance"]);
      const fuelLevel =
        findNumericValue(positionAttributes, ["fuelLevel", "fuel", "fuelPercent"]) ??
        findNumericValue(deviceAttributes, ["fuelLevel", "fuel", "fuelPercent"]);
      const fuelCapacity = findNumericValue(device.attributes ?? {}, [
        "fuel_tank_capacity", "fuelCapacity", "tankCapacity", "tank_capacity", "capacity",
      ]);
      const normalizedFuelLevel = normalizeFuelLevel(fuelLevel);
      const fuelLiters = normalizedFuelLevel != null && fuelCapacity
        ? Math.round(normalizedFuelLevel / 100 * fuelCapacity)
        : null;
      const driverUniqueId = positionAttributes.driverUniqueId ?? null;
      const driver = driverUniqueId ? (driverByUniqueId.get(driverUniqueId) ?? driverUniqueId) : null;

      return {
        vehicle: device.name || device.uniqueId || `Véhicule ${device.id}`,
        odometer: normalizeKilometers(odometer),
        fuelLevel: normalizedFuelLevel,
        fuelLiters,
        driver,
      };
    })
    .sort((a, b) => a.vehicle.localeCompare(b.vehicle, "fr"));
}

// `fetchRouteJson(path)` is supplied by the caller so this stays agnostic of
// how each environment reaches the Traccar API (browser fetch vs. edge fetch).
export async function fetchHistoricalPositions(devices, date, time, fetchRouteJson, onProgress) {
  const range = dateRangeParams(date, time);
  let done = 0;
  const positions = await mapWithConcurrency(
    devices,
    ROUTE_CONCURRENCY,
    async (device) => {
      const params = new URLSearchParams(range);
      params.set("deviceId", device.id);

      try {
        return latestPositionForRoute(await fetchRouteJson(`/reports/route?${params}`));
      } catch (error) {
        console.warn(`[treports] no route for device ${device.id} on ${date}`, error);
        return null;
      } finally {
        onProgress?.(++done, devices.length);
      }
    }
  );

  return positions.filter(Boolean);
}