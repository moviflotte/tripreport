import ExcelJS from "exceljs";

const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const ROUTE_CONCURRENCY = 6;

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

function formatDateFR(date) {
  const parsedDate = new Date(`${date}T00:00:00Z`);

  return new Intl.DateTimeFormat("fr-FR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "UTC",
  }).format(parsedDate);
}

function dateRangeParams(date) {
  return new URLSearchParams({
    from: `${date}T00:00:00Z`,
    to: `${date}T23:59:59Z`,
  });
}

async function traccarFetchJson(env, path, cookieHeader) {
  const upstream = new URL(
    `/api/${path.replace(/^\//, "")}`,
    "http://gps.fleetmap.pt"
  );
  upstream.host = env.TRACCAR_SERVER || "gps.fleetmap.pt";

  const response = await fetch(upstream, {
    headers: {
      Accept: "application/json",
      Cookie: cookieHeader,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${response.statusText} :: ${body}`);
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
  const { useDeviceAttributes = true } = options;
  const positionByDeviceId = new Map(
    positions.map((position) => [position.deviceId, position])
  );

  return devices
    .map((device) => {
      const position = positionByDeviceId.get(device.id);
      const positionAttributes = position?.attributes ?? {};
      const deviceAttributes = useDeviceAttributes ? (device.attributes ?? {}) : {};
      const odometer =
        findNumericValue(positionAttributes, [
          "odometer",
          "totalDistance",
          "distance",
        ]) ??
        findNumericValue(deviceAttributes, [
          "odometer",
          "totalDistance",
          "distance",
        ]);
      const fuelLevel =
        findNumericValue(positionAttributes, [
          "fuelLevel",
          "fuel",
          "fuelPercent",
        ]) ??
        findNumericValue(deviceAttributes, [
          "fuelLevel",
          "fuel",
          "fuelPercent",
        ]);

      return {
        vehicle: device.name || device.uniqueId || `Véhicule ${device.id}`,
        odometer: normalizeKilometers(odometer),
        fuelLevel: normalizeFuelLevel(fuelLevel),
      };
    })
    .sort((a, b) => a.vehicle.localeCompare(b.vehicle, "fr"));
}

function latestPositionForRoute(route) {
  if (!Array.isArray(route) || route.length === 0) return null;

  return [...route]
    .sort((a, b) => {
      const aTime = new Date(
        a.fixTime || a.deviceTime || a.serverTime || 0
      ).getTime();
      const bTime = new Date(
        b.fixTime || b.deviceTime || b.serverTime || 0
      ).getTime();

      return aTime - bTime;
    })
    .at(-1);
}

async function fetchHistoricalPositions(env, devices, date, cookieHeader) {
  const range = dateRangeParams(date);
  const positions = await mapWithConcurrency(
    devices,
    ROUTE_CONCURRENCY,
    async (device) => {
      const params = new URLSearchParams(range);
      params.set("deviceId", device.id);

      try {
        return latestPositionForRoute(
          await traccarFetchJson(
            env,
            `/reports/route?${params}`,
            cookieHeader
          )
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

function addVehicleRows(worksheet, rows) {
  rows.forEach((row) => {
    worksheet.addRow({
      vehicle: row.vehicle,
      odometer: row.odometer == null ? null : Math.round(row.odometer),
      fuelLevel: row.fuelLevel == null ? null : Math.round(row.fuelLevel),
    });
  });
}

function configureWorksheet(worksheet) {
  worksheet.columns = [
    { key: "vehicle", width: 36 },
    { key: "odometer", width: 18, style: { numFmt: '#,##0 "km"' } },
    { key: "fuelLevel", width: 20, style: { numFmt: '0"%"' } },
  ];
}

function styleWorksheet(worksheet) {
  worksheet.getRow(1).font = { bold: true, size: 14 };
  worksheet.getRow(2).font = { italic: true, color: { argb: "FF5C6870" } };
  worksheet.getRow(4).font = { bold: true, color: { argb: "FFFFFFFF" } };
  worksheet.getRow(4).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF39464E" },
  };

  worksheet.views = [{ state: "frozen", ySplit: 4 }];
  worksheet.autoFilter = "A4:C4";

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber < 4) return;

    row.eachCell((cell) => {
      cell.border = {
        bottom: { style: "thin", color: { argb: "FFEDF0F2" } },
      };
    });
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const cookieHeader = request.headers.get("cookie");

  if (!cookieHeader) {
    return Response.json(
      { error: "Missing credentials", hint: "No cookie header in request" },
      { status: 401 }
    );
  }

  try {
    const url = new URL(request.url);
    const date = url.searchParams.get("date") || todayISODate();
    const isToday = date === todayISODate();
    const devices = await traccarFetchJson(env, "/devices", cookieHeader);
    const positions = isToday
      ? await traccarFetchJson(env, "/positions", cookieHeader)
      : await fetchHistoricalPositions(env, devices, date, cookieHeader);
    const rows = mapVehicleRows(devices, positions, {
      useDeviceAttributes: isToday,
    });
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Releves");

    workbook.creator = "Trip Report";
    workbook.created = new Date();

    configureWorksheet(worksheet);
    worksheet.addRow(["Rapport d'audit des véhicules"]);
    worksheet.addRow([`Date du rapport: ${formatDateFR(date)}`]);
    worksheet.addRow([]);
    worksheet.addRow(["Véhicule", "Kilométrage", "Niveau de carburant"]);
    addVehicleRows(worksheet, rows);
    styleWorksheet(worksheet);

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `rapport-vehicules-${date}.xlsx`;

    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": XLSX_CONTENT_TYPE,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[/treports/vehicles-xlsx] error:", error);

    return Response.json(
      { error: "Export error", detail: String(error?.message || error) },
      { status: 500 }
    );
  }
}
