import ExcelJS from "exceljs";

const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

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

async function traccarFetchJson(env, path, cookieHeader) {
  const upstream = new URL("http://gps.fleetmap.pt");
  upstream.host = env.TRACCAR_SERVER || "gps.fleetmap.pt";
  upstream.pathname = `/api${path}`;

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
    const [devices, positions] = await Promise.all([
      traccarFetchJson(env, "/devices", cookieHeader),
      traccarFetchJson(env, "/positions", cookieHeader),
    ]);
    const rows = mapVehicleRows(devices, positions);
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
