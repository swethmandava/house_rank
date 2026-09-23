import fs from 'node:fs/promises';
import path from 'node:path';
import { Workbook } from '@oai/artifact-tool';

const workspace = '/Users/swethamandava/Documents/ChatGPT/house_rank';
const preparedPath = path.join(workspace, 'prepared_schools.json');
const outputDir = path.join(
  workspace,
  'outputs',
  '01a0cb83-f11d-7e90-953a-f71b9bcb7d9d',
);
const outputPath = path.join(outputDir, 'san_francisco_schools_ratings.csv');
const previewPath = '/private/tmp/san_francisco_schools_ratings_preview.png';

const prepared = JSON.parse(await fs.readFile(preparedPath, 'utf8'));
const headers = [
  'school',
  'address',
  'public_vs_private',
  'school_type',
  'greatschools_rating',
  'greatschools_rating_as_of',
  'greatschools_profile_url',
  'private_staffing_proxy_rating',
  'private_staffing_proxy_basis',
  'rating_notes',
  'cds_code',
];
const dataRows = prepared.rows.map((record) =>
  headers.map((header) => record[header] ?? ''),
);

const workbook = Workbook.create();
const sheet = workbook.worksheets.add('Schools');
sheet.getRange(`K2:K${dataRows.length + 1}`).format.numberFormat = '@';
sheet.getRangeByIndexes(0, 0, dataRows.length + 1, headers.length).values = [
  headers,
  ...dataRows,
];
sheet.showGridLines = false;
sheet.freezePanes.freezeRows(1);
sheet.getRange('A1:K1').format = {
  fill: '#1F4E78',
  font: { name: 'Arial', bold: true, color: '#FFFFFF', size: 10 },
  horizontalAlignment: 'center',
  verticalAlignment: 'center',
};
sheet.getRange(`A2:K${dataRows.length + 1}`).format.font = {
  name: 'Arial',
  size: 10,
};
sheet.getRange(`A1:K${dataRows.length + 1}`).format.verticalAlignment =
  'center';
sheet.getRange(`E2:E${dataRows.length + 1}`).format.numberFormat = '0';
sheet.getRange(`H2:H${dataRows.length + 1}`).format.numberFormat = '0.0';
sheet.getRange('A:A').format.columnWidth = 34;
sheet.getRange('B:B').format.columnWidth = 42;
sheet.getRange('C:C').format.columnWidth = 16;
sheet.getRange('D:D').format.columnWidth = 26;
sheet.getRange('E:E').format.columnWidth = 20;
sheet.getRange('F:F').format.columnWidth = 22;
sheet.getRange('G:G').format.columnWidth = 48;
sheet.getRange('H:H').format.columnWidth = 30;
sheet.getRange('I:I').format.columnWidth = 68;
sheet.getRange('J:J').format.columnWidth = 58;
sheet.getRange('K:K').format.columnWidth = 18;
workbook.recalculate();

const escapeCsv = (value) => {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replaceAll('"', '""')}"`;
};
const csvText =
  [headers, ...dataRows]
    .map((row) => row.map(escapeCsv).join(','))
    .join('\r\n') + '\r\n';
await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(outputPath, csvText, 'utf8');

const preview = await workbook.render({
  sheetName: 'Schools',
  range: 'A1:K24',
  scale: 1,
  format: 'png',
});
await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));

const topInspect = await workbook.inspect({
  kind: 'table',
  range: 'Schools!A1:K8',
  include: 'values,formulas',
  tableMaxRows: 8,
  tableMaxCols: 11,
  maxChars: 8000,
});
const bottomStart = dataRows.length - 4;
const bottomInspect = await workbook.inspect({
  kind: 'table',
  range: `Schools!A${bottomStart}:K${dataRows.length + 1}`,
  include: 'values,formulas',
  tableMaxRows: 8,
  tableMaxCols: 11,
  maxChars: 8000,
});
const errors = await workbook.inspect({
  kind: 'match',
  searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',
  options: { useRegex: true, maxResults: 50 },
  summary: 'final formula error scan',
  maxChars: 4000,
});

const roundTrip = await Workbook.fromCSV(csvText, { sheetName: 'Schools' });
const roundTripInspect = await roundTrip.inspect({
  kind: 'table',
  range: `Schools!A1:K${dataRows.length + 1}`,
  include: 'values',
  tableMaxRows: 2,
  tableMaxCols: 11,
  maxChars: 4000,
});

console.log(
  JSON.stringify(
    {
      outputPath,
      previewPath,
      metadata: prepared.metadata,
      fileBytes: Buffer.byteLength(csvText, 'utf8'),
      expectedDataRows: dataRows.length,
      topInspect: topInspect.ndjson,
      bottomInspect: bottomInspect.ndjson,
      errors: errors.ndjson,
      roundTripInspect: roundTripInspect.ndjson,
    },
    null,
    2,
  ),
);
