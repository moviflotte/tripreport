import ExcelJS from "exceljs";

export const XLSX_CONTENT_TYPE =
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

export async function buildVehicleReportXlsx(rows, date) {
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

  return workbook.xlsx.writeBuffer();
}
