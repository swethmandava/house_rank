export type SchoolLevelCode = 'p' | 'e' | 'm' | 'h';

export type Coordinates = { lat: number; lng: number };

export type K12SchoolRecord = {
  name: string;
  publicVsPrivate: 'Public' | 'Private';
  schoolType: string;
  greatSchoolsRating: number | null;
  greatSchoolsProfileUrl: string | null;
  privateStaffingProxyRating: number | null;
  latitude: number;
  longitude: number;
};

export type PreschoolRecord = {
  name: string;
  screeningRating: string;
  overviewUrl: string | null;
  latitude: number;
  longitude: number;
};

export type SchoolMatch = {
  name: string;
  distanceMiles: number;
  driveMinutes: number | null;
  ratingBand: string;
  overviewUrl: string | null;
  coordinates: Coordinates;
};

export type SchoolLevelMatches = {
  levelCode: SchoolLevelCode;
  levelLabel: string;
  bestPublic: SchoolMatch | null;
  bestPrivate: SchoolMatch | null;
  bestPreschool: SchoolMatch | null;
};

export type SchoolRankingResult = {
  matchesByLevel: SchoolLevelMatches[];
  grade: number | null;
};

type RankedMatch = {
  match: SchoolMatch;
  rankScore: number;
  gradeScore: number | null;
};

const levelLabels: Record<SchoolLevelCode, string> = {
  p: 'Preschool',
  e: 'Elementary',
  m: 'Middle school',
  h: 'High school',
};

export function rankNearbySchools(
  home: Coordinates,
  settings: { levelCodes: SchoolLevelCode[]; radiusMiles: number },
  schools: K12SchoolRecord[],
  preschools: PreschoolRecord[],
): SchoolRankingResult {
  const radiusMiles = Math.max(0.25, Math.min(50, settings.radiusMiles));
  const levelCodes = [...new Set(settings.levelCodes)];
  const gradeScores: number[] = [];

  const matchesByLevel = levelCodes.map((levelCode) => {
    if (levelCode === 'p') {
      const rankedPreschools = preschools
        .map((preschool) => rankPreschool(home, radiusMiles, preschool))
        .filter((candidate): candidate is RankedMatch => candidate !== null)
        .sort(compareRankedMatches);
      const bestPreschool = rankedPreschools[0] ?? null;
      gradeScores.push(bestPreschool?.gradeScore ?? 0);
      return {
        levelCode,
        levelLabel: levelLabels[levelCode],
        bestPublic: null,
        bestPrivate: null,
        bestPreschool: bestPreschool?.match ?? null,
      };
    }

    const matchingSchools = schools.filter((school) =>
      schoolCoversLevel(school.schoolType, levelCode),
    );
    const publicCandidates = matchingSchools
      .filter((school) => school.publicVsPrivate === 'Public')
      .map((school) => rankPublic(home, radiusMiles, school))
      .filter((candidate): candidate is RankedMatch => candidate !== null)
      .sort(compareRankedMatches);
    const privateCandidates = matchingSchools
      .filter((school) => school.publicVsPrivate === 'Private')
      .map((school) => rankPrivate(home, radiusMiles, school))
      .filter((candidate): candidate is RankedMatch => candidate !== null)
      .sort(compareRankedMatches);
    const bestPublic = publicCandidates[0] ?? null;
    const bestPrivate = privateCandidates[0] ?? null;
    gradeScores.push(bestPublic?.gradeScore ?? 0);

    return {
      levelCode,
      levelLabel: levelLabels[levelCode],
      bestPublic: bestPublic?.match ?? null,
      bestPrivate: bestPrivate?.match ?? null,
      bestPreschool: null,
    };
  });

  return {
    matchesByLevel,
    grade: gradeScores.length
      ? roundToHalf(
          gradeScores.reduce((sum, score) => sum + score, 0) /
            gradeScores.length,
        )
      : null,
  };
}

export function schoolCoversLevel(
  schoolType: string,
  levelCode: Exclude<SchoolLevelCode, 'p'>,
) {
  if (schoolType === 'K-12/Combined School') return true;
  if (levelCode === 'e') {
    return (
      schoolType === 'Elementary School' ||
      schoolType === 'Elementary/Middle School'
    );
  }
  if (levelCode === 'm') {
    return (
      schoolType === 'Middle School' ||
      schoolType === 'Elementary/Middle School' ||
      schoolType === 'Middle/High School'
    );
  }
  return schoolType === 'High School' || schoolType === 'Middle/High School';
}

function rankPublic(
  home: Coordinates,
  radiusMiles: number,
  school: K12SchoolRecord,
): RankedMatch | null {
  const distanceMiles = haversineMiles(home, {
    lat: school.latitude,
    lng: school.longitude,
  });
  if (distanceMiles > radiusMiles) return null;
  const rating = school.greatSchoolsRating;
  const gradeScore =
    rating === null
      ? null
      : clamp(rating / 2 - distancePenalty(distanceMiles, radiusMiles), 0, 5);
  return {
    match: {
      name: school.name,
      distanceMiles: roundDistance(distanceMiles),
      driveMinutes: null,
      ratingBand:
        rating === null
          ? 'GreatSchools rating unavailable'
          : `GreatSchools ${formatScore(rating)}/10`,
      overviewUrl: school.greatSchoolsProfileUrl,
      coordinates: { lat: school.latitude, lng: school.longitude },
    },
    rankScore: gradeScore ?? -1 - distanceMiles / radiusMiles,
    gradeScore,
  };
}

function rankPrivate(
  home: Coordinates,
  radiusMiles: number,
  school: K12SchoolRecord,
): RankedMatch | null {
  const distanceMiles = haversineMiles(home, {
    lat: school.latitude,
    lng: school.longitude,
  });
  if (distanceMiles > radiusMiles) return null;
  const proxy = school.privateStaffingProxyRating;
  return {
    match: {
      name: school.name,
      distanceMiles: roundDistance(distanceMiles),
      driveMinutes: null,
      ratingBand:
        proxy === null
          ? 'Private staffing proxy unavailable'
          : `Private staffing proxy ${formatScore(proxy)}/10`,
      overviewUrl: null,
      coordinates: { lat: school.latitude, lng: school.longitude },
    },
    rankScore:
      proxy === null
        ? -1 - distanceMiles / radiusMiles
        : proxy / 2 - distancePenalty(distanceMiles, radiusMiles),
    gradeScore: null,
  };
}

function rankPreschool(
  home: Coordinates,
  radiusMiles: number,
  preschool: PreschoolRecord,
): RankedMatch | null {
  const distanceMiles = haversineMiles(home, {
    lat: preschool.latitude,
    lng: preschool.longitude,
  });
  if (distanceMiles > radiusMiles) return null;
  const screening = preschoolScreening(preschool.screeningRating);
  const gradeScore = clamp(
    screening.baseScore - distancePenalty(distanceMiles, radiusMiles),
    0,
    5,
  );
  return {
    match: {
      name: preschool.name,
      distanceMiles: roundDistance(distanceMiles),
      driveMinutes: null,
      ratingBand: screening.label,
      overviewUrl: preschool.overviewUrl,
      coordinates: { lat: preschool.latitude, lng: preschool.longitude },
    },
    rankScore: gradeScore,
    gradeScore,
  };
}

function preschoolScreening(rating: string) {
  if (rating.startsWith('A -')) {
    return { baseScore: 5, label: 'ELFA quality standards + licensed' };
  }
  if (rating.startsWith('B -')) {
    return { baseScore: 3.5, label: 'Licensed · no ELFA designation' };
  }
  if (rating.startsWith('Review -')) {
    return { baseScore: 1.5, label: 'Verify license status' };
  }
  throw new Error(`Unknown preschool screening rating: ${rating}`);
}

function compareRankedMatches(first: RankedMatch, second: RankedMatch) {
  return (
    second.rankScore - first.rankScore ||
    first.match.distanceMiles - second.match.distanceMiles ||
    first.match.name.localeCompare(second.match.name)
  );
}

function distancePenalty(distanceMiles: number, radiusMiles: number) {
  return Math.min(1, distanceMiles / radiusMiles);
}

function formatScore(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function roundDistance(value: number) {
  return Math.round(value * 10) / 10;
}

function roundToHalf(value: number) {
  return clamp(Math.round(value * 2) / 2, 0, 5);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function haversineMiles(from: Coordinates, to: Coordinates) {
  const earthRadiusMiles = 3_958.7613;
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(to.lat - from.lat);
  const longitudeDelta = radians(to.lng - from.lng);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(from.lat)) *
      Math.cos(radians(to.lat)) *
      Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
