import ExcelJS from "exceljs";
import { todayISODate, mapVehicleRows, fetchHistoricalPositions } from "../../public/treports/report-utils.js";

const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function formatDateFR(date) {
  const parsedDate = new Date(`${date}T00:00:00Z`);

  return new Intl.DateTimeFormat("fr-FR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "UTC",
  }).format(parsedDate);
}

// Proxies through the same /api route the browser uses (functions/api/[[path]].js)
// instead of hand-rolling a direct-to-Traccar fetch, so both surfaces share one
// tested path to the upstream server and can't drift out of sync.
async function traccarFetchJson(request, path) {
  const upstream = new URL(`/api/${path.replace(/^\//, "")}`, request.url);
  const response = await fetch(new Request(upstream, request));

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${response.statusText} :: ${body}`);
  }

  return response.json();
}

function addVehicleRows(worksheet, rows) {
  rows.forEach((row) => {
    worksheet.addRow({
      vehicle: row.vehicle,
      odometer: row.odometer == null ? null : Math.round(row.odometer),
      fuelLevel: row.fuelLevel == null ? null : Math.round(row.fuelLevel),
      fuelLiters: row.fuelLiters ?? null,
      driver: row.driver ?? null,
    });
  });
}

function configureWorksheet(worksheet) {
  worksheet.columns = [
    { key: "vehicle", width: 36 },
    { key: "odometer", width: 18, style: { numFmt: '#,##0 "km"' } },
    { key: "fuelLevel", width: 18, style: { numFmt: '0"%"' } },
    { key: "fuelLiters", width: 18, style: { numFmt: '#,##0 "L"' } },
    { key: "driver", width: 28 },
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
  worksheet.autoFilter = "A4:E4";

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
  const { request } = context;
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
    const time = url.searchParams.get("time") || "23:59:59";
    const isLive = date === todayISODate() && time === "23:59:59";
    const [devices, drivers] = await Promise.all([
      traccarFetchJson(request, "/devices"),
      traccarFetchJson(request, "/drivers").catch(() => []),
    ]);
    const driverByUniqueId = new Map(drivers.map((d) => [d.uniqueId, d.name]));
    const positions = isLive
      ? await traccarFetchJson(request, "/positions")
      : await fetchHistoricalPositions(devices, date, time, (path) => traccarFetchJson(request, path));
    const rows = mapVehicleRows(devices, positions, {
      useDeviceAttributes: isLive,
      driverByUniqueId,
    });
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Releves");

    workbook.creator = "Trip Report";
    workbook.created = new Date();

    configureWorksheet(worksheet);
    worksheet.addRow(["Rapport d'audit des véhicules"]);
    worksheet.addRow([`Date du rapport: ${formatDateFR(date)}`]);
    worksheet.addRow([]);
    worksheet.addRow(["Véhicule", "Kilométrage", "Carburant (%)", "Carburant (L)", "Dernier conducteur"]);
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