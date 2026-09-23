import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  parseK12SchoolData,
  parsePreschoolData,
} from './school-data-parser.ts';
import {
  rankNearbySchools,
  rerankSchoolsWithDriveTimes,
  schoolCoversLevel,
} from './school-rankings.ts';

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

test('uses public schools by default and keeps private schools out of the score', () => {
  const result = rankNearbySchools(
    home,
    { levelCodes: ['e'], sectors: ['public'], maxTravelMinutes: 20 },
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
  assert.equal(result.matchesByLevel[0].bestPrivate, null);
  assert.equal(result.matchesByLevel[0].bestPublic.driveMinutes, 3);
});

test('ranks preschool screening without calling it an academic rating', () => {
  const result = rankNearbySchools(
    home,
    { levelCodes: ['p'], sectors: ['public'], maxTravelMinutes: 20 },
    [],
    [
      preschool({
        name: 'Licensed only',
        screeningRating: 'B - Licensed; no ELFA designation found',
      }),
      preschool({ name: 'ELFA option' }),
    ],
  );

  assert.equal(result.grade, 4.8);
  assert.equal(result.matchesByLevel[0].bestPreschool.name, 'ELFA option');
  assert.equal(
    result.matchesByLevel[0].bestPreschool.ratingBand,
    'ELFA quality standards + licensed',
  );
});

test('returns zero when a selected level has no considered school', () => {
  const result = rankNearbySchools(
    home,
    { levelCodes: ['e'], sectors: ['public'], maxTravelMinutes: 20 },
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
  assert.equal(result.matchesByLevel[0].bestPrivate, null);
});

test('prefers a good nearby school over a perfect but distant school', () => {
  const result = rankNearbySchools(
    home,
    { levelCodes: ['e'], sectors: ['public'], maxTravelMinutes: 30 },
    [
      school({
        name: 'Nearby option',
        greatSchoolsRating: 7,
        longitude: -122.44,
      }),
      school({
        name: 'Distant option',
        greatSchoolsRating: 10,
        longitude: -122.37,
      }),
    ],
    [],
  );

  assert.equal(result.matchesByLevel[0].bestReachable.name, 'Nearby option');
});

test('includes private options only when the user selects them', () => {
  const result = rankNearbySchools(
    home,
    { levelCodes: ['e'], sectors: ['public', 'private'], maxTravelMinutes: 20 },
    [
      school({ name: 'Public option', greatSchoolsRating: 6 }),
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

  assert.equal(result.matchesByLevel[0].bestReachable.name, 'Private option');
  assert.equal(result.matchesByLevel[0].suitableOptionCount, 1);
});

test('reranks with actual travel times and excludes options beyond the limit', () => {
  const nearby = school({ name: 'Nearby option', longitude: -122.44 });
  const slow = school({
    name: 'Slow option',
    greatSchoolsRating: 10,
    longitude: -122.43,
  });
  const initial = rankNearbySchools(
    home,
    { levelCodes: ['e'], sectors: ['public'], maxTravelMinutes: 20 },
    [nearby, slow],
    [],
  );
  const result = rerankSchoolsWithDriveTimes(
    initial,
    new Map([
      [`${nearby.latitude},${nearby.longitude}`, 7],
      [`${slow.latitude},${slow.longitude}`, 24],
    ]),
  );

  assert.equal(result.matchesByLevel[0].bestReachable.name, 'Nearby option');
  assert.equal(result.matchesByLevel[0].topOptions.length, 1);
  assert.equal(result.travelTimesEstimated, false);
});
