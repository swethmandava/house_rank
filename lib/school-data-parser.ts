import type { K12SchoolRecord, PreschoolRecord } from './school-rankings';

export function parseK12SchoolData(input: string): K12SchoolRecord[] {
  return parseCsv(input)
    .map((row): K12SchoolRecord => {
      if (
        row.public_vs_private !== 'Public' &&
        row.public_vs_private !== 'Private'
      ) {
        throw new Error(`Invalid school sector for ${row.school}`);
      }
      return {
        name: row.school,
        publicVsPrivate: row.public_vs_private,
        schoolType: row.school_type,
        gradeLow: optionalGrade(row.grade_low),
        gradeHigh: optionalGrade(row.grade_high),
        greatSchoolsRating: optionalNumber(row.greatschools_rating),
        greatSchoolsProfileUrl: optionalUrl(row.greatschools_profile_url),
        privateStaffingProxyRating: optionalNumber(
          row.private_staffing_proxy_rating,
        ),
        latitude: requiredNumber(row.latitude, row.school),
        longitude: requiredNumber(row.longitude, row.school),
      };
    })
    .filter((school) => school.name);
}

export function parsePreschoolData(input: string): PreschoolRecord[] {
  return parseCsv(input)
    .map(
      (row): PreschoolRecord => ({
        name: row.preschool,
        screeningRating: row.preschool_screening_rating,
        overviewUrl: optionalUrl(row.cdss_facility_detail_url),
        latitude: requiredNumber(row.latitude, row.preschool),
        longitude: requiredNumber(row.longitude, row.preschool),
      }),
    )
    .filter((school) => school.name);
}

function parseCsv(input: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (character !== '\r') {
      field += character;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const [rawHeaders = [], ...dataRows] = rows;
  const headers = rawHeaders.map((header, index) =>
    index === 0 ? header.replace(/^\uFEFF/, '') : header,
  );
  return dataRows
    .filter((values) => values.some(Boolean))
    .map((values) =>
      Object.fromEntries(
        headers.map((header, index) => [header, values[index] ?? '']),
      ),
    );
}

function optionalNumber(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid number: ${value}`);
  return parsed;
}

function optionalGrade(value = '') {
  const normalized = value.trim().toUpperCase();
  if (!normalized) return null;
  if (normalized === 'PK' || normalized === 'P') return -1;
  if (normalized === 'TK' || normalized === 'KG' || normalized === 'K')
    return 0;
  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 12) {
    throw new Error(`Invalid grade: ${value}`);
  }
  return parsed;
}

function requiredNumber(value: string, recordName: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid coordinate for ${recordName || 'school record'}`);
  }
  return parsed;
}

function optionalUrl(value: string) {
  return /^https?:\/\//.test(value) ? value : null;
}
