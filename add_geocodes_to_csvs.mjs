import fs from 'node:fs/promises';
import path from 'node:path';
import { Workbook } from '@oai/artifact-tool';

const payloadPath = '/tmp/geocoded_csv_payload.json';
const payload = JSON.parse(await fs.readFile(payloadPath, 'utf8'));
const previewPaths = [];
const results = [];

const columnName = (oneBased) => {
  let value = oneBased;
  let output = '';
  while (value > 0) {
    value -= 1;
    output = String.fromCharCode(65 + (value % 26)) + output;
    value = Math.floor(value / 26);
  }
  return output;
};

const escapeCsv = (value, quoteAll) => {
  if (value === null || value === undefined) return quoteAll ? '""' : '';
  if (!quoteAll && (typeof value === 'number' || typeof value === 'boolean')) {
    return String(value);
  }
  const text = String(value);
  if (quoteAll || /[",\r\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
};

for (const filePayload of payload.files) {
  const csvPath = filePayload.path;
  const csvText = await fs.readFile(csvPath, 'utf8');
  const sheetName = filePayload.kind === 'schools' ? 'Schools' : 'Preschools';
  const workbook = await Workbook.fromCSV(csvText, { sheetName });
  const sheet = workbook.worksheets.getItem(sheetName);

  const oldColumnCount = filePayload.headers.length - 6;
  const newHeaders = filePayload.headers.slice(oldColumnCount);
  const rowCount = filePayload.rows.length + 1;
  const newValues = filePayload.rows.map((row) =>
    newHeaders.map((header) => row[header] ?? ''),
  );

  sheet.getRangeByIndexes(0, oldColumnCount, 1, newHeaders.length).values = [
    newHeaders,
  ];
  sheet.getRangeByIndexes(
    1,
    oldColumnCount,
    newValues.length,
    newHeaders.length,
  ).values = newValues;

  const firstNewColumn = columnName(oldColumnCount + 1);
  const secondNewColumn = columnName(oldColumnCount + 2);
  const lastColumn = columnName(filePayload.headers.length);
  sheet.getRange(
    `${firstNewColumn}2:${secondNewColumn}${rowCount}`,
  ).format.numberFormat = '0.0000000';
  sheet.getRange(`${firstNewColumn}1:${lastColumn}1`).format = {
    fill: filePayload.kind === 'schools' ? '#1F4E78' : '#385723',
    font: { name: 'Arial', bold: true, color: '#FFFFFF', size: 10 },
    horizontalAlignment: 'center',
    verticalAlignment: 'center',
  };
  sheet.getRange(`${firstNewColumn}2:${lastColumn}${rowCount}`).format.font = {
    name: 'Arial',
    size: 10,
  };
  sheet.getRange(`${firstNewColumn}:${secondNewColumn}`).format.columnWidth =
    24;
  sheet.getRange(
    `${columnName(oldColumnCount + 3)}:${columnName(oldColumnCount + 3)}`,
  ).format.columnWidth = 52;
  sheet.getRange(
    `${columnName(oldColumnCount + 4)}:${columnName(oldColumnCount + 4)}`,
  ).format.columnWidth = 56;
  sheet.getRange(
    `${columnName(oldColumnCount + 5)}:${columnName(oldColumnCount + 5)}`,
  ).format.columnWidth = 56;
  sheet.getRange(`${lastColumn}:${lastColumn}`).format.columnWidth = 28;
  workbook.recalculate();

  const matrix = [
    filePayload.headers,
    ...filePayload.rows.map((row) =>
      filePayload.headers.map((header) => {
        if (header === 'latitude' || header === 'longitude') {
          return Number(row[header]);
        }
        return row[header] ?? '';
      }),
    ),
  ];
  const quoteAll = filePayload.kind === 'schools';
  const outputText =
    matrix
      .map((row) => row.map((value) => escapeCsv(value, quoteAll)).join(','))
      .join('\r\n') + '\r\n';
  const temporaryPath = `${csvPath}.tmp`;
  await fs.writeFile(temporaryPath, outputText, 'utf8');
  await fs.rename(temporaryPath, csvPath);

  const previewPath = `/private/tmp/${filePayload.kind}_geocodes_preview.png`;
  const preview = await workbook.render({
    sheetName,
    range: `${firstNewColumn}1:${lastColumn}16`,
    scale: 1,
    format: 'png',
  });
  await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));
  previewPaths.push(previewPath);

  const topInspect = await workbook.inspect({
    kind: 'table',
    range: `${sheetName}!${firstNewColumn}1:${lastColumn}6`,
    include: 'values,formulas',
    tableMaxRows: 6,
    tableMaxCols: 6,
    maxChars: 8000,
  });
  const bottomInspect = await workbook.inspect({
    kind: 'table',
    range: `${sheetName}!${firstNewColumn}${rowCount - 3}:${lastColumn}${rowCount}`,
    include: 'values,formulas',
    tableMaxRows: 5,
    tableMaxCols: 6,
    maxChars: 8000,
  });
  const errors = await workbook.inspect({
    kind: 'match',
    searchTerm:
      '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',
    options: { useRegex: true, maxResults: 100 },
    summary: 'final formula error scan',
    maxChars: 4000,
  });

  const roundTrip = await Workbook.fromCSV(outputText, { sheetName });
  const roundTripInspect = await roundTrip.inspect({
    kind: 'table',
    range: `${sheetName}!A1:${lastColumn}${rowCount}`,
    include: 'values',
    tableMaxRows: 2,
    tableMaxCols: filePayload.headers.length,
    maxChars: 8000,
  });

  results.push({
    csvPath,
    dataRows: filePayload.rows.length,
    columns: filePayload.headers.length,
    previewPath,
    topInspect: topInspect.ndjson,
    bottomInspect: bottomInspect.ndjson,
    errors: errors.ndjson,
    roundTripInspect: roundTripInspect.ndjson,
  });
}

console.log(
  JSON.stringify(
    {
      geocodeSummary: payload.summary,
      previewPaths,
      results,
    },
    null,
    2,
  ),
);
