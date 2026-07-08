// Shared vehicle-report logic used by the browser UI (app.js) and the
// client-side Excel export (xlsx-builder.js). Keeping this in one place
// avoids the two surfaces drifting apart and disagreeing on values.

export const ROUTE_CONCURRENCY = 6;

export function todayISODate() {
  const today = new Date();
  const offsetMs = today.getTimezoneOffset() * 60 * 1000;
  return new Date(today.getTime() - offsetMs).toISOString().slice(0, 10);
}

const ROUTE_LOOKBACK_MS_SHORT = 24 * 60 * 60 * 1000;
const ROUTE_LOOKBACK_MS_LONG = 30 * 24 * 60 * 60 * 1000;

export function dateRangeParams(date, time = "23:59:59", lookbackMs = ROUTE_LOOKBACK_MS_SHORT) {
  const to = new Date(`${date}T${time}Z`);
  const from = new Date(to.getTime() - lookbackMs);
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

export function positionTimestamp(position) {
  return new Date(position?.fixTime || position?.deviceTime || position?.serverTime || 0).getTime();
}

export function latestPositionForRoute(route) {
  if (!Array.isArray(route) || route.length === 0) return null;

  return [...route]
    .sort((a, b) => positionTimestamp(a) - positionTimestamp(b))
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
async function fetchLatestPosition(device, date, time, lookbackMs, fetchRouteJson) {
  const params = dateRangeParams(date, time, lookbackMs);
  params.set("deviceId", device.id);

  try {
    return latestPositionForRoute(await fetchRouteJson(`/reports/route?${params}`));
  } catch (error) {
    console.warn(`[treports] route fetch failed for device ${device.id} on ${date}`, error);
    return null;
  }
}

export async function fetchHistoricalPositions(
  devices, date, time, fetchRouteJson, onProgress, livePositionByDeviceId = new Map()
) {
  const cutoff = new Date(`${date}T${time}Z`).getTime();
  let done = 0;
  const positions = await mapWithConcurrency(
    devices,
    ROUTE_CONCURRENCY,
    async (device) => {
      try {
        const position = await fetchLatestPosition(
          device, date, time, ROUTE_LOOKBACK_MS_SHORT, fetchRouteJson
        );

        if (position) return position;

        // The device's last known position (from the live endpoint) already
        // predates the selected time, so it's still accurate as-of that
        // time — no need to burn a wide 1-month route query on it. Checked
        // even if the short lookup above errored out, so one bad request
        // doesn't hide a perfectly good live fallback.
        const livePosition = livePositionByDeviceId.get(device.id);
        if (livePosition && positionTimestamp(livePosition) <= cutoff) return livePosition;

        return await fetchLatestPosition(device, date, time, ROUTE_LOOKBACK_MS_LONG, fetchRouteJson);
      } finally {
        onProgress?.(++done, devices.length);
      }
    }
  );

  return positions.filter(Boolean);
}
