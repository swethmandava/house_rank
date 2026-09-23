import fs from 'node:fs/promises';
import path from 'node:path';
import { Workbook } from '@oai/artifact-tool';

const workspace = '/Users/swethamandava/Documents/ChatGPT/house_rank';
const preparedPath = '/tmp/san_francisco_preschools_rows.json';
const outputDir = path.join(
  workspace,
  'outputs',
  '01a0cb83-f11d-7e90-953a-f71b9bcb7d9d',
);
const outputPath = path.join(outputDir, 'san_francisco_preschools_ratings.csv');
const previewCorePath = '/private/tmp/san_francisco_preschools_core.png';
const previewRatingPath = '/private/tmp/san_francisco_preschools_rating.png';
const previewSourcesPath = '/private/tmp/san_francisco_preschools_sources.png';

const prepared = JSON.parse(await fs.readFile(preparedPath, 'utf8'));
const headers = [
  'preschool',
  'address',
  'city',
  'state',
  'zip',
  'provider_type',
  'license_number',
  'license_status_in_cdss_2025_export',
  'licensed_capacity',
  'phone',
  'license_first_date',
  'elfa_network_member',
  'preschool_screening_rating',
  'rating_basis',
  'rating_limitations',
  'address_source',
  'cdss_facility_detail_url',
  'cdss_dataset_url',
  'elfa_directory_url',
  'cdss_export_data_date',
  'elfa_directory_access_date',
];
const dataRows = prepared.rows.map((record) =>
  headers.map((header) => {
    if (header === 'licensed_capacity' && /^\d+$/.test(record[header] ?? '')) {
      return Number(record[header]);
    }
    return record[header] ?? '';
  }),
);

const workbook = Workbook.create();
const sheet = workbook.worksheets.add('Preschools');
const rowCount = dataRows.length + 1;
const columnCount = headers.length;
sheet.getRangeByIndexes(0, 0, rowCount, columnCount).values = [
  headers,
  ...dataRows,
];
sheet.showGridLines = false;
sheet.freezePanes.freezeRows(1);
sheet.freezePanes.freezeColumns(2);
sheet.getRange('A1:U1').format = {
  fill: '#385723',
  font: { name: 'Arial', bold: true, color: '#FFFFFF', size: 10 },
  horizontalAlignment: 'center',
  verticalAlignment: 'center',
};
sheet.getRange(`A2:U${rowCount}`).format.font = {
  name: 'Arial',
  size: 10,
};
sheet.getRange(`A1:U${rowCount}`).format.verticalAlignment = 'center';
sheet.getRange(`E2:E${rowCount}`).format.numberFormat = '@';
sheet.getRange(`G2:G${rowCount}`).format.numberFormat = '@';
sheet.getRange(`I2:I${rowCount}`).format.numberFormat = '0';
sheet.getRange('A:A').format.columnWidth = 38;
sheet.getRange('B:B').format.columnWidth = 48;
sheet.getRange('C:C').format.columnWidth = 16;
sheet.getRange('D:E').format.columnWidth = 10;
sheet.getRange('F:F').format.columnWidth = 33;
sheet.getRange('G:G').format.columnWidth = 18;
sheet.getRange('H:H').format.columnWidth = 33;
sheet.getRange('I:I').format.columnWidth = 22;
sheet.getRange('J:J').format.columnWidth = 26;
sheet.getRange('K:K').format.columnWidth = 20;
sheet.getRange('L:L').format.columnWidth = 20;
sheet.getRange('M:M').format.columnWidth = 42;
sheet.getRange('N:O').format.columnWidth = 90;
sheet.getRange('P:P').format.columnWidth = 24;
sheet.getRange('Q:S').format.columnWidth = 60;
sheet.getRange('T:U').format.columnWidth = 25;
sheet.getRange(`H2:L${rowCount}`).format.horizontalAlignment = 'center';
sheet.getRange(`N2:O${rowCount}`).format.wrapText = true;
sheet.getRange(`N2:O${rowCount}`).format.rowHeight = 36;
workbook.recalculate();

const escapeCsv = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  const text = String(value);
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
};
const csvText =
  [headers, ...dataRows]
    .map((row) => row.map(escapeCsv).join(','))
    .join('\r\n') + '\r\n';
await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(outputPath, csvText, 'utf8');

for (const [range, destination] of [
  ['A1:L18', previewCorePath],
  ['M1:P18', previewRatingPath],
  ['Q1:U10', previewSourcesPath],
]) {
  const preview = await workbook.render({
    sheetName: 'Preschools',
    range,
    scale: 1,
    format: 'png',
  });
  await fs.writeFile(destination, new Uint8Array(await preview.arrayBuffer()));
}

const topInspect = await workbook.inspect({
  kind: 'table',
  range: 'Preschools!A1:U6',
  include: 'values,formulas',
  tableMaxRows: 6,
  tableMaxCols: 21,
  maxChars: 12000,
});
const bottomInspect = await workbook.inspect({
  kind: 'table',
  range: `Preschools!A${rowCount - 4}:U${rowCount}`,
  include: 'values,formulas',
  tableMaxRows: 6,
  tableMaxCols: 21,
  maxChars: 12000,
});
const errors = await workbook.inspect({
  kind: 'match',
  searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',
  options: { useRegex: true, maxResults: 100 },
  summary: 'final formula error scan',
  maxChars: 4000,
});

const roundTrip = await Workbook.fromCSV(csvText, { sheetName: 'Preschools' });
const roundTripInspect = await roundTrip.inspect({
  kind: 'table',
  range: `Preschools!A1:U${rowCount}`,
  include: 'values',
  tableMaxRows: 3,
  tableMaxCols: 21,
  maxChars: 8000,
});

console.log(
  JSON.stringify(
    {
      outputPath,
      previews: [previewCorePath, previewRatingPath, previewSourcesPath],
      fileBytes: Buffer.byteLength(csvText, 'utf8'),
      expectedDataRows: dataRows.length,
      sourceSummary: {
        activeCdssPreschools: prepared.active_cdss_preschools,
        elfaPreschoolLicenses: prepared.elfa_preschool_licenses,
        ratingCounts: prepared.rating_counts,
      },
      topInspect: topInspect.ndjson,
      bottomInspect: bottomInspect.ndjson,
      errors: errors.ndjson,
      roundTripInspect: roundTripInspect.ndjson,
    },
    null,
    2,
  ),
);
