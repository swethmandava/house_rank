import { rateHouseCharacteristics } from '../lib/openai-house';
import {
  sanFranciscoPreschools,
  sanFranciscoSchools,
} from '../lib/school-data';
import {
  rankNearbySchools,
  rerankSchoolsWithDriveTimes,
  type Coordinates,
  type SchoolLevelCode,
  type SchoolRankingResult,
  type SchoolSector,
} from '../lib/school-rankings';

type ApiResult = { status: number; body: unknown };

type AutoGradeRequest = {
  houseAddress: string;
  commute: {
    addresses: string[];
    modes: Array<'driving' | 'public_transport' | 'walking' | 'cycling'>;
    targetMinutes: number;
    arrivalTimes: string[];
  };
  walkability: {
    categories: Array<'grocery' | 'coffee' | 'restaurant' | 'park' | 'transit'>;
    targetMinutes: number;
  };
  schools: {
    levelCodes: SchoolLevelCode[];
    sectors: SchoolSector[];
    maxTravelMinutes: number;
    minimumRating: number;
  };
  subjectiveCriteria?: Array<{
    id: string;
    label: string;
    requirements: string;
    priorities: Record<string, 'must' | 'nice' | 'neutral'>;
    suggestedEvidence: string;
  }>;
  listingUrl?: string;
  notes?: string;
  timeZoneOffsetMinutes?: number;
};

const travelTimeBaseUrl = 'https://api.traveltimeapp.com/v4';
const placePrimaryTypes = {
  grocery: ['grocery_store', 'supermarket'],
  coffee: ['coffee_shop', 'cafe'],
  restaurant: ['restaurant'],
  park: ['park'],
  transit: [
    'transit_station',
    'transit_stop',
    'bus_stop',
    'subway_station',
    'light_rail_station',
    'train_station',
    'tram_stop',
  ],
} as const;

export async function handleAutoGradeRequest(
  body: unknown,
): Promise<ApiResult> {
  const input = body as AutoGradeRequest | undefined;
  if (!input?.houseAddress?.trim()) {
    return {
      status: 400,
      body: { error: 'A house address is required' },
    };
  }

  const appId = process.env.TRAVELTIME_APP_ID;
  const apiKey = process.env.TRAVELTIME_API_KEY;
  const subjectiveRatingsPromise = input.subjectiveCriteria?.length
    ? rateHouseCharacteristics(
        {
          address: input.houseAddress,
          listingUrl: input.listingUrl,
          notes: input.notes,
        },
        input.subjectiveCriteria,
      ).catch(() => [])
    : Promise.resolve([]);
  const houseCoordinatesPromise = geocodeHouseAddress(
    input.houseAddress,
    appId,
    apiKey,
  );
  const schoolsPromise = houseCoordinatesPromise
    .then(async (coordinates) => {
      const schools = rankNearbySchools(
        coordinates,
        input.schools,
        sanFranciscoSchools,
        sanFranciscoPreschools,
      );
      if (!appId || !apiKey) return schools;
      return calculateSchoolDriveTimes(
        coordinates,
        schools,
        input.timeZoneOffsetMinutes ?? 0,
        appId,
        apiKey,
      ).catch(() => schools);
    })
    .catch((error) => ({
      unavailable: true as const,
      reason:
        error instanceof Error ? error.message : 'School research unavailable',
    }));
  if (!appId || !apiKey) {
    return {
      status: 200,
      body: {
        commute: null,
        walkability: {
          unavailable: true,
          reason: 'TravelTime is not configured',
        },
        schools: await schoolsPromise,
        subjectiveRatings: await subjectiveRatingsPromise,
      },
    };
  }

  try {
    const commuteAddresses = input.commute.addresses
      .map((address) => address.trim())
      .filter(Boolean)
      .slice(0, 10);
    const [houseCoordinates, ...destinationCoordinates] = await Promise.all([
      houseCoordinatesPromise,
      ...commuteAddresses.map((address) =>
        geocodeTravelTime(address, appId, apiKey),
      ),
    ]);

    const [commute, walkability, schools, subjectiveRatings] =
      await Promise.all([
        destinationCoordinates.length
          ? calculateCommute(
              houseCoordinates,
              destinationCoordinates,
              input,
              appId,
              apiKey,
            )
          : null,
        calculateWalkability(houseCoordinates, input).catch((error) => ({
          unavailable: true as const,
          reason:
            error instanceof Error ? error.message : 'Walkability unavailable',
        })),
        schoolsPromise,
        subjectiveRatingsPromise,
      ]);

    return {
      status: 200,
      body: { commute, walkability, schools, subjectiveRatings },
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Automatic grading failed';
    return { status: 502, body: { error: message } };
  }
}

async function calculateSchoolDriveTimes(
  house: Coordinates,
  ranking: SchoolRankingResult,
  timeZoneOffsetMinutes: number,
  appId: string,
  apiKey: string,
): Promise<SchoolRankingResult> {
  const matches = ranking.matchesByLevel.flatMap(
    (level) => level.candidateOptions,
  );
  const destinations = [
    ...new Map(
      matches.map((match) => [coordinateKey(match.coordinates), match]),
    ).values(),
  ];
  if (!destinations.length) return ranking;

  const minutesByCoordinate = new Map<string, number>();
  const batches = Array.from(
    { length: Math.ceil(destinations.length / 8) },
    (_, index) => destinations.slice(index * 8, index * 8 + 8),
  );
  await Promise.all(
    batches.map(async (batch, batchIndex) => {
      const result = await fetch(`${travelTimeBaseUrl}/time-filter`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Application-Id': appId,
          'X-Api-Key': apiKey,
        },
        body: JSON.stringify({
          locations: [
            { id: 'house', coords: house },
            ...batch.map((match, index) => ({
              id: `school-${batchIndex}-${index}`,
              coords: match.coordinates,
            })),
          ],
          arrival_searches: batch.map((_, index) => ({
            id: `school-drive-${batchIndex}-${index}`,
            departure_location_ids: ['house'],
            arrival_location_id: `school-${batchIndex}-${index}`,
            arrival_time: nextWeekdayArrival('08:00', timeZoneOffsetMinutes),
            travel_time: Math.max(300, ranking.maxTravelMinutes * 60),
            properties: ['travel_time'],
            transportation: { type: 'driving' },
          })),
        }),
      });
      if (!result.ok) throw new Error('School travel times are unavailable');
      const data = (await result.json()) as {
        results?: Array<{
          search_id?: string;
          locations?: Array<{ properties?: Array<{ travel_time?: number }> }>;
        }>;
      };
      const resultsBySearchId = new Map(
        (data.results ?? []).map((item) => [item.search_id, item]),
      );
      batch.forEach((match, index) => {
        const seconds = resultsBySearchId.get(
          `school-drive-${batchIndex}-${index}`,
        )?.locations?.[0]?.properties?.[0]?.travel_time;
        if (typeof seconds === 'number') {
          minutesByCoordinate.set(
            coordinateKey(match.coordinates),
            Math.max(1, Math.round(seconds / 60)),
          );
        }
      });
    }),
  );

  return rerankSchoolsWithDriveTimes(ranking, minutesByCoordinate);
}

function coordinateKey(coordinates: Coordinates) {
  return `${coordinates.lat},${coordinates.lng}`;
}

async function geocodeHouseAddress(
  address: string,
  appId: string | undefined,
  apiKey: string | undefined,
): Promise<Coordinates> {
  if (appId && apiKey) {
    try {
      return await geocodeTravelTime(address, appId, apiKey);
    } catch {
      return geocodeCensus(address);
    }
  }
  return geocodeCensus(address);
}

async function geocodeTravelTime(
  address: string,
  appId: string,
  apiKey: string,
): Promise<Coordinates> {
  const url = new URL(`${travelTimeBaseUrl}/geocoding/search`);
  url.searchParams.set('query', address);
  url.searchParams.set('limit', '1');
  const result = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'X-Application-Id': appId,
      'X-Api-Key': apiKey,
    },
  });
  if (!result.ok) throw new Error(`Could not locate “${address}”`);
  const data = (await result.json()) as {
    features?: Array<{ geometry?: { coordinates?: [number, number] } }>;
  };
  const coordinates = data.features?.[0]?.geometry?.coordinates;
  if (!coordinates) throw new Error(`Could not locate “${address}”`);
  return { lng: coordinates[0], lat: coordinates[1] };
}

async function geocodeCensus(address: string): Promise<Coordinates> {
  const url = new URL(
    'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress',
  );
  url.searchParams.set('address', address);
  url.searchParams.set('benchmark', 'Public_AR_Current');
  url.searchParams.set('format', 'json');
  const result = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!result.ok) throw new Error(`Could not locate “${address}”`);
  const data = (await result.json()) as {
    result?: {
      addressMatches?: Array<{
        coordinates?: { x?: number; y?: number };
      }>;
    };
  };
  const coordinates = data.result?.addressMatches?.[0]?.coordinates;
  if (typeof coordinates?.x !== 'number' || typeof coordinates.y !== 'number') {
    throw new Error(`Could not locate “${address}”`);
  }
  return { lng: coordinates.x, lat: coordinates.y };
}

async function calculateCommute(
  house: Coordinates,
  destinations: Coordinates[],
  input: AutoGradeRequest,
  appId: string,
  apiKey: string,
) {
  const locations = [
    { id: 'house', coords: house },
    ...destinations.map((coords, index) => ({
      id: `destination-${index}`,
      coords,
    })),
  ];
  const selectedArrivalTimes = (input.commute.arrivalTimes ?? [])
    .filter(Boolean)
    .slice(0, 4);
  const arrivalTimes = (
    selectedArrivalTimes.length ? selectedArrivalTimes : ['09:00']
  ).map((time) => nextWeekdayArrival(time, input.timeZoneOffsetMinutes ?? 0));
  const modes = input.commute.modes.length
    ? input.commute.modes
    : (['driving'] as const);
  const resultsByMode = await Promise.all(
    modes.map(async (mode) => ({
      mode,
      minutes: await Promise.all(
        arrivalTimes.map((arrivalTime) =>
          calculateCommuteForMode(
            locations,
            destinations,
            arrivalTime,
            mode,
            appId,
            apiKey,
          ),
        ),
      ),
    })),
  );
  const minutes = destinations.map((_, destinationIndex) => {
    const samples = arrivalTimes
      .map((_, arrivalIndex) => {
        const candidates = resultsByMode
          .map((result) => result.minutes[arrivalIndex]?.[destinationIndex])
          .filter((value): value is number => typeof value === 'number');
        return candidates.length ? Math.min(...candidates) : null;
      })
      .filter((value): value is number => value !== null);
    return samples.length
      ? Math.round(
          samples.reduce((sum, value) => sum + value, 0) / samples.length,
        )
      : null;
  });
  const reachableMinutes = minutes.filter(
    (value): value is number => typeof value === 'number',
  );
  if (!reachableMinutes.length) throw new Error('No commute route was found');
  const bestModes = destinations.map((_, destinationIndex) => {
    const candidates = resultsByMode
      .map((result) => {
        const samples = result.minutes
          .map((timeResults) => timeResults[destinationIndex])
          .filter((value): value is number => typeof value === 'number');
        return {
          mode: result.mode,
          average: samples.length
            ? samples.reduce((sum, value) => sum + value, 0) / samples.length
            : null,
        };
      })
      .filter(
        (
          candidate,
        ): candidate is { mode: (typeof modes)[number]; average: number } =>
          candidate.average !== null,
      );
    return (
      candidates.sort((first, second) => first.average - second.average)[0]
        ?.mode ?? null
    );
  });
  const averageMinutes = Math.round(
    reachableMinutes.reduce((sum, value) => sum + value, 0) /
      reachableMinutes.length,
  );
  return {
    minutes: reachableMinutes,
    bestModes,
    sampleCount: arrivalTimes.length,
    averageMinutes,
    grade: gradeForTime(averageMinutes, input.commute.targetMinutes),
  };
}

async function calculateCommuteForMode(
  locations: Array<{ id: string; coords: Coordinates }>,
  destinations: Coordinates[],
  arrivalTime: string,
  mode: 'driving' | 'public_transport' | 'walking' | 'cycling',
  appId: string,
  apiKey: string,
) {
  const result = await fetch(`${travelTimeBaseUrl}/time-filter`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Application-Id': appId,
      'X-Api-Key': apiKey,
    },
    body: JSON.stringify({
      locations,
      arrival_searches: destinations.map((_, destinationIndex) => ({
        id: `commute-${destinationIndex}`,
        departure_location_ids: ['house'],
        arrival_location_id: `destination-${destinationIndex}`,
        arrival_time: arrivalTime,
        travel_time: 14_400,
        properties: ['travel_time'],
        transportation: { type: mode },
      })),
    }),
  });
  if (!result.ok)
    throw new Error('TravelTime could not calculate this commute');
  const data = (await result.json()) as {
    results?: Array<{
      search_id?: string;
      locations?: Array<{ properties?: Array<{ travel_time?: number }> }>;
    }>;
  };
  const bySearchId = new Map(
    (data.results ?? []).map((item) => [item.search_id, item]),
  );
  return destinations.map((_, destinationIndex) => {
    const seconds = bySearchId.get(`commute-${destinationIndex}`)
      ?.locations?.[0]?.properties?.[0]?.travel_time;
    return typeof seconds === 'number' ? Math.round(seconds / 60) : null;
  });
}

async function calculateWalkability(
  house: Coordinates,
  input: AutoGradeRequest,
) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key)
    return { unavailable: true, reason: 'Google Places is not configured' };
  const categories = input.walkability.categories.slice(0, 5);
  const places = await Promise.all(
    categories.map(async (category) => {
      const result = await fetch(
        'https://places.googleapis.com/v1/places:searchNearby',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': key,
            'X-Goog-FieldMask': 'places.displayName,places.location',
          },
          body: JSON.stringify({
            includedPrimaryTypes: placePrimaryTypes[category],
            maxResultCount: 1,
            rankPreference: 'DISTANCE',
            locationRestriction: {
              circle: {
                center: { latitude: house.lat, longitude: house.lng },
                radius: 5000,
              },
            },
          }),
        },
      );
      if (!result.ok)
        throw new Error('Google Places could not find nearby essentials');
      const data = (await result.json()) as {
        places?: Array<{
          displayName?: { text?: string };
          location?: { latitude?: number; longitude?: number };
        }>;
      };
      const place = data.places?.[0];
      const latitude = place?.location?.latitude;
      const longitude = place?.location?.longitude;
      if (typeof latitude !== 'number' || typeof longitude !== 'number') {
        return {
          category,
          name: null,
          distanceMeters: null,
          walkingMinutes: null,
        };
      }
      const distanceMeters = Math.round(
        haversineMeters(house, { lat: latitude, lng: longitude }),
      );
      return {
        category,
        name: place?.displayName?.text ?? null,
        distanceMeters,
        walkingMinutes: Math.max(1, Math.round(distanceMeters / 80)),
      };
    }),
  );
  const walkingMinutes = places
    .map((place) => place.walkingMinutes)
    .filter((value): value is number => value !== null);
  if (!walkingMinutes.length)
    throw new Error('No nearby essentials were found');
  const averageMinutes = Math.round(
    walkingMinutes.reduce((sum, value) => sum + value, 0) /
      walkingMinutes.length,
  );
  return {
    places,
    averageMinutes,
    grade: gradeForTime(averageMinutes, input.walkability.targetMinutes),
  };
}

function nextWeekdayArrival(time: string, offsetMinutes: number) {
  const [hours, minutes] = time.split(':').map(Number);
  const localNow = new Date(Date.now() - offsetMinutes * 60_000);
  const arrival = new Date(localNow);
  arrival.setUTCDate(arrival.getUTCDate() + 1);
  while (arrival.getUTCDay() === 0 || arrival.getUTCDay() === 6) {
    arrival.setUTCDate(arrival.getUTCDate() + 1);
  }
  arrival.setUTCHours(
    Number.isFinite(hours) ? hours : 9,
    Number.isFinite(minutes) ? minutes : 0,
    0,
    0,
  );
  return new Date(arrival.getTime() + offsetMinutes * 60_000).toISOString();
}

function gradeForTime(minutes: number, target: number) {
  if (minutes <= target) return 5;
  return roundGrade(5 - ((minutes - target) / Math.max(target, 1)) * 5);
}

function roundGrade(value: number) {
  return Math.max(0, Math.min(5, Math.round(value * 2) / 2));
}

function haversineMeters(from: Coordinates, to: Coordinates) {
  const earthRadius = 6_371_000;
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(to.lat - from.lat);
  const longitudeDelta = radians(to.lng - from.lng);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(from.lat)) *
      Math.cos(radians(to.lat)) *
      Math.sin(longitudeDelta / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
