const vehicleReadings = [
  {
    date: "2026-06-03",
    vehicles: [
      { vehicle: "Audi A3 - 12-AB-34", odometer: 18420, fuelLevel: 72 },
      { vehicle: "Audi Q5 - 56-CD-78", odometer: 43910, fuelLevel: 46 },
      { vehicle: "Audi e-tron - 90-EF-12", odometer: 12875, fuelLevel: 88 },
      { vehicle: "Audi A6 Avant - 34-GH-56", odometer: 61204, fuelLevel: 31 },
    ],
  },
  {
    date: "2026-06-02",
    vehicles: [
      { vehicle: "Audi A3 - 12-AB-34", odometer: 18375, fuelLevel: 78 },
      { vehicle: "Audi Q5 - 56-CD-78", odometer: 43820, fuelLevel: 52 },
      { vehicle: "Audi e-tron - 90-EF-12", odometer: 12840, fuelLevel: 94 },
      { vehicle: "Audi A6 Avant - 34-GH-56", odometer: 61150, fuelLevel: 36 },
    ],
  },
  {
    date: "2026-06-01",
    vehicles: [
      { vehicle: "Audi A3 - 12-AB-34", odometer: 18302, fuelLevel: 84 },
      { vehicle: "Audi Q5 - 56-CD-78", odometer: 43744, fuelLevel: 59 },
      { vehicle: "Audi e-tron - 90-EF-12", odometer: 12792, fuelLevel: 63 },
      { vehicle: "Audi A6 Avant - 34-GH-56", odometer: 61072, fuelLevel: 44 },
    ],
  },
];

const dateInput = document.querySelector("#reportDate");
const reportRows = document.querySelector("#reportRows");
const tableTitle = document.querySelector("#tableTitle");
const reportSummary = document.querySelector("#reportSummary");
const emptyState = document.querySelector("#emptyState");
const printButton = document.querySelector("#printReport");

const numberFormatter = new Intl.NumberFormat("fr-FR");
const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  year: "numeric",
  month: "short",
  day: "2-digit",
});

function findReadingsForDate(date) {
  return vehicleReadings.find((reading) => reading.date === date);
}

function formatDate(date) {
  const parsedDate = new Date(`${date}T00:00:00`);
  return dateFormatter.format(parsedDate);
}

function renderReport() {
  const selectedDate = dateInput.value;
  const report = findReadingsForDate(selectedDate);
  const rows = report?.vehicles ?? [];

  tableTitle.textContent = `Relevés du ${formatDate(selectedDate)}`;
  reportSummary.textContent = `${rows.length} véhicules audités le ${formatDate(selectedDate)}.`;
  reportRows.innerHTML = "";
  emptyState.hidden = rows.length > 0;

  rows.forEach((item) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${item.vehicle}</td>
      <td>${numberFormatter.format(item.odometer)} km</td>
      <td>${item.fuelLevel}%</td>
    `;
    reportRows.append(row);
  });
}

dateInput.min = vehicleReadings.at(-1).date;
dateInput.max = vehicleReadings[0].date;
dateInput.value = vehicleReadings[0].date;

dateInput.addEventListener("change", renderReport);
printButton.addEventListener("click", () => window.print());

renderReport();
