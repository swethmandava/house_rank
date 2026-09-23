import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  parseK12SchoolData,
  parsePreschoolData,
} from './school-data-parser.ts';
import { rankNearbySchools, schoolCoversLevel } from './school-rankings.ts';

const home = { lat: 37.75, lng: -122.45 };
const actualSchools = parseK12SchoolData(
  readFileSync(
    new URL('../data/san_francisco_schools_ratings.csv', import.meta.url),
    'utf8',
  ),
);
const actualPreschools = parsePreschoolData(
  readFileSync(
    new URL('../data/san_francisco_preschools_ratings.csv', import.meta.url),
    'utf8',
  ),
);

function school(overrides = {}) {
  return {
    name: 'Test school',
    publicVsPrivate: 'Public',
    schoolType: 'Elementary School',
    greatSchoolsRating: 8,
    greatSchoolsProfileUrl: 'https://example.com/public',
    privateStaffingProxyRating: null,
    latitude: home.lat,
    longitude: home.lng,
    ...overrides,
  };
}

function preschool(overrides = {}) {
  return {
    name: 'Test preschool',
    screeningRating: 'A - ELFA quality standards + licensed',
    overviewUrl: 'https://example.com/preschool',
    latitude: home.lat,
    longitude: home.lng,
    ...overrides,
  };
}

test('maps combined school types to every covered level', () => {
  assert.equal(schoolCoversLevel('Elementary/Middle School', 'e'), true);
  assert.equal(schoolCoversLevel('Elementary/Middle School', 'm'), true);
  assert.equal(schoolCoversLevel('Elementary/Middle School', 'h'), false);
  assert.equal(schoolCoversLevel('K-12/Combined School', 'h'), true);
});

test('loads the complete revised CSV schemas and current Alvarado rating', () => {
  assert.equal(actualSchools.length, 219);
  assert.equal(actualPreschools.length, 329);
  assert.equal(
    actualSchools.filter((item) => item.publicVsPrivate === 'Public').length,
    120,
  );
  assert.equal(
    actualSchools.filter((item) => item.publicVsPrivate === 'Private').length,
    99,
  );
  const alvarado = actualSchools.find(
    (item) => item.name === 'Alvarado Elementary',
  );
  assert.equal(alvarado?.greatSchoolsRating, 8);
  assert.equal(alvarado?.latitude, 37.7537507);
  assert.equal(alvarado?.longitude, -122.4385858);
});

test('uses GreatSchools for the house grade and keeps the private proxy separate', () => {
  const result = rankNearbySchools(
    home,
    { levelCodes: ['e'], radiusMiles: 5 },
    [
      school(),
      school({
        name: 'Private option',
        publicVsPrivate: 'Private',
        greatSchoolsRating: null,
        greatSchoolsProfileUrl: null,
        privateStaffingProxyRating: 10,
      }),
    ],
    [],
  );

  assert.equal(result.grade, 4);
  assert.equal(
    result.matchesByLevel[0].bestPublic.ratingBand,
    'GreatSchools 8/10',
  );
  assert.equal(
    result.matchesByLevel[0].bestPrivate.ratingBand,
    'Private staffing proxy 10/10',
  );
  assert.equal(result.matchesByLevel[0].bestPublic.driveMinutes, null);
});

test('ranks preschool screening without calling it an academic rating', () => {
  const result = rankNearbySchools(
    home,
    { levelCodes: ['p'], radiusMiles: 5 },
    [],
    [
      preschool({
        name: 'Licensed only',
        screeningRating: 'B - Licensed; no ELFA designation found',
      }),
      preschool({ name: 'ELFA option' }),
    ],
  );

  assert.equal(result.grade, 5);
  assert.equal(result.matchesByLevel[0].bestPreschool.name, 'ELFA option');
  assert.equal(
    result.matchesByLevel[0].bestPreschool.ratingBand,
    'ELFA quality standards + licensed',
  );
});

test('returns a zero component when a selected level has no public match', () => {
  const result = rankNearbySchools(
    home,
    { levelCodes: ['e'], radiusMiles: 1 },
    [
      school({
        publicVsPrivate: 'Private',
        greatSchoolsRating: null,
        privateStaffingProxyRating: 9,
      }),
    ],
    [],
  );

  assert.equal(result.grade, 0);
  assert.equal(result.matchesByLevel[0].bestPublic, null);
  assert.ok(result.matchesByLevel[0].bestPrivate);
});
