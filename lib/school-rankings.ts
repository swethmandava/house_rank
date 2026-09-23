export type SchoolLevelCode = 'p' | 'e' | 'm' | 'h';
export type SchoolSector = 'public' | 'private';

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
  sector: SchoolSector | 'preschool';
  distanceMiles: number;
  driveMinutes: number;
  ratingBand: string;
  qualityScore: number | null;
  accessScore: number | null;
  overviewUrl: string | null;
  coordinates: Coordinates;
};

export type SchoolLevelMatches = {
  levelCode: SchoolLevelCode;
  levelLabel: string;
  includedSectors: SchoolSector[];
  maxTravelMinutes: number;
  minimumRating: number;
  levelScore: number;
  suitableOptionCount: number;
  closestSuitable: SchoolMatch | null;
  bestReachable: SchoolMatch | null;
  topOptions: SchoolMatch[];
  candidateOptions: SchoolMatch[];
  closestPublic: SchoolMatch | null;
  closestPrivate: SchoolMatch | null;
  bestPublic: SchoolMatch | null;
  bestPrivate: SchoolMatch | null;
  bestPreschool: SchoolMatch | null;
};

export type SchoolRankingResult = {
  matchesByLevel: SchoolLevelMatches[];
  grade: number | null;
  maxTravelMinutes: number;
  minimumRating: number;
  travelTimesEstimated: boolean;
};

export type SchoolRankingSettings = {
  levelCodes: SchoolLevelCode[];
  maxTravelMinutes: number;
  minimumRating: number;
  sectors: SchoolSector[];
};

const levelLabels: Record<SchoolLevelCode, string> = {
  p: 'Preschool',
  e: 'Elementary',
  m: 'Middle school',
  h: 'High school',
};

const candidateLimitPerSector = 8;

export function rankNearbySchools(
  home: Coordinates,
  settings: SchoolRankingSettings,
  schools: K12SchoolRecord[],
  preschools: PreschoolRecord[],
): SchoolRankingResult {
  const maxTravelMinutes = clamp(
    Math.round(settings.maxTravelMinutes || 20),
    5,
    60,
  );
  const sectors = normalizeSectors(settings.sectors);
  const minimumRating = clamp(Math.round(settings.minimumRating || 7), 1, 10);
  const levelCodes = [...new Set(settings.levelCodes)];
  const maximumCandidateDistance = Math.min(
    25,
    Math.max(4, maxTravelMinutes * 0.6),
  );

  const matchesByLevel = levelCodes.map((levelCode) => {
    const candidateOptions =
      levelCode === 'p'
        ? selectCandidatePool(
            preschools
              .map((preschool) =>
                createPreschoolMatch(home, maximumCandidateDistance, preschool),
              )
              .filter((match): match is SchoolMatch => match !== null),
          )
        : (['public', 'private'] as const).flatMap((sector) => {
            const matches = schools
              .filter(
                (school) =>
                  school.publicVsPrivate ===
                    (sector === 'public' ? 'Public' : 'Private') &&
                  schoolCoversLevel(school.schoolType, levelCode),
              )
              .map((school) =>
                createK12Match(home, maximumCandidateDistance, school, sector),
              )
              .filter((match): match is SchoolMatch => match !== null);
            return selectCandidatePool(matches);
          });

    return finalizeLevel(
      levelCode,
      deduplicateMatches(candidateOptions),
      maxTravelMinutes,
      minimumRating,
      sectors,
    );
  });

  return finalizeRanking(matchesByLevel, maxTravelMinutes, minimumRating, true);
}

export function rerankSchoolsWithDriveTimes(
  ranking: SchoolRankingResult,
  minutesByCoordinate: Map<string, number>,
): SchoolRankingResult {
  const matchesByLevel = ranking.matchesByLevel.map((level) => {
    const candidateOptions = level.candidateOptions.map((match) => ({
      ...match,
      driveMinutes:
        minutesByCoordinate.get(coordinateKey(match.coordinates)) ??
        ranking.maxTravelMinutes + 1,
    }));
    return finalizeLevel(
      level.levelCode,
      candidateOptions,
      ranking.maxTravelMinutes,
      ranking.minimumRating,
      level.includedSectors,
    );
  });
  return finalizeRanking(
    matchesByLevel,
    ranking.maxTravelMinutes,
    ranking.minimumRating,
    false,
  );
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

function createK12Match(
  home: Coordinates,
  maximumDistanceMiles: number,
  school: K12SchoolRecord,
  sector: SchoolSector,
): SchoolMatch | null {
  const distanceMiles = haversineMiles(home, {
    lat: school.latitude,
    lng: school.longitude,
  });
  if (distanceMiles > maximumDistanceMiles) return null;
  const sourceRating =
    sector === 'public'
      ? school.greatSchoolsRating
      : school.privateStaffingProxyRating;
  const qualityScore =
    sourceRating === null ? null : clamp(sourceRating / 2, 0, 5);
  const driveMinutes = estimatedDriveMinutes(distanceMiles);
  return {
    name: school.name,
    sector,
    distanceMiles: roundDistance(distanceMiles),
    driveMinutes,
    ratingBand:
      sourceRating === null
        ? sector === 'public'
          ? 'GreatSchools rating unavailable'
          : 'Proxy Score unavailable'
        : sector === 'public'
          ? `GreatSchools ${formatScore(sourceRating)}/10`
          : `Proxy Score ${formatScore(sourceRating)}/10`,
    qualityScore,
    accessScore: accessScore(qualityScore, driveMinutes),
    overviewUrl: sector === 'public' ? school.greatSchoolsProfileUrl : null,
    coordinates: { lat: school.latitude, lng: school.longitude },
  };
}

function createPreschoolMatch(
  home: Coordinates,
  maximumDistanceMiles: number,
  preschool: PreschoolRecord,
): SchoolMatch | null {
  const distanceMiles = haversineMiles(home, {
    lat: preschool.latitude,
    lng: preschool.longitude,
  });
  if (distanceMiles > maximumDistanceMiles) return null;
  const screening = preschoolScreening(preschool.screeningRating);
  const driveMinutes = estimatedDriveMinutes(distanceMiles);
  return {
    name: preschool.name,
    sector: 'preschool',
    distanceMiles: roundDistance(distanceMiles),
    driveMinutes,
    ratingBand: screening.label,
    qualityScore: screening.baseScore,
    accessScore: accessScore(screening.baseScore, driveMinutes),
    overviewUrl: preschool.overviewUrl,
    coordinates: { lat: preschool.latitude, lng: preschool.longitude },
  };
}

function finalizeLevel(
  levelCode: SchoolLevelCode,
  candidates: SchoolMatch[],
  maxTravelMinutes: number,
  minimumRating: number,
  includedSectors: SchoolSector[],
): SchoolLevelMatches {
  const reachable = candidates
    .filter(
      (match) =>
        match.driveMinutes <= maxTravelMinutes && match.qualityScore !== null,
    )
    .map((match) => ({
      ...match,
      accessScore: accessScore(match.qualityScore, match.driveMinutes),
    }))
    .sort(compareAccess);
  const scoredReachable = reachable.filter(
    (match) =>
      match.sector === 'preschool' || includedSectors.includes(match.sector),
  );
  const topOptions = scoredReachable.slice(0, 3);
  const suitableOptions = scoredReachable
    .filter((match) => (match.qualityScore ?? 0) >= minimumRating / 2)
    .sort(
      (first, second) =>
        first.driveMinutes - second.driveMinutes ||
        compareAccess(first, second),
    );
  const levelScore = scoreOptions(topOptions, suitableOptions.length);
  const bestSuitable = [...suitableOptions].sort(compareAccess)[0] ?? null;

  return {
    levelCode,
    levelLabel: levelLabels[levelCode],
    includedSectors,
    maxTravelMinutes,
    minimumRating,
    levelScore,
    suitableOptionCount: suitableOptions.length,
    closestSuitable: suitableOptions[0] ?? null,
    bestReachable: bestSuitable,
    topOptions,
    candidateOptions: candidates,
    closestPublic: closestBySector(reachable, 'public'),
    closestPrivate: closestBySector(reachable, 'private'),
    bestPublic: reachable.find((match) => match.sector === 'public') ?? null,
    bestPrivate: reachable.find((match) => match.sector === 'private') ?? null,
    bestPreschool:
      reachable.find((match) => match.sector === 'preschool') ?? null,
  };
}

function closestBySector(
  matches: SchoolMatch[],
  sector: SchoolSector,
): SchoolMatch | null {
  return (
    [...matches]
      .filter((match) => match.sector === sector)
      .sort(
        (first, second) =>
          first.driveMinutes - second.driveMinutes ||
          first.distanceMiles - second.distanceMiles ||
          first.name.localeCompare(second.name),
      )[0] ?? null
  );
}

function finalizeRanking(
  matchesByLevel: SchoolLevelMatches[],
  maxTravelMinutes: number,
  minimumRating: number,
  travelTimesEstimated: boolean,
): SchoolRankingResult {
  return {
    matchesByLevel,
    grade: matchesByLevel.length
      ? roundToTenth(
          matchesByLevel.reduce((sum, level) => sum + level.levelScore, 0) /
            matchesByLevel.length,
        )
      : null,
    maxTravelMinutes,
    minimumRating,
    travelTimesEstimated,
  };
}

function scoreOptions(topOptions: SchoolMatch[], suitableCount: number) {
  if (!topOptions.length) return 0;
  const weights = [0.6, 0.25, 0.15];
  const usedWeights = weights.slice(0, topOptions.length);
  const weightTotal = usedWeights.reduce((sum, weight) => sum + weight, 0);
  const weightedAccess = topOptions.reduce(
    (sum, match, index) => sum + (match.accessScore ?? 0) * usedWeights[index],
    0,
  );
  const choiceBonus = Math.min(0.4, Math.max(0, suitableCount - 1) * 0.2);
  return roundToTenth(clamp(weightedAccess / weightTotal + choiceBonus, 0, 5));
}

function selectCandidatePool(matches: SchoolMatch[]) {
  const nearest = [...matches]
    .sort(
      (first, second) =>
        first.driveMinutes - second.driveMinutes ||
        first.name.localeCompare(second.name),
    )
    .slice(0, 3);
  const strongestAccess = [...matches]
    .sort(compareAccess)
    .slice(0, candidateLimitPerSector);
  return deduplicateMatches([...nearest, ...strongestAccess]).slice(
    0,
    candidateLimitPerSector,
  );
}

function deduplicateMatches(matches: SchoolMatch[]) {
  return [
    ...new Map(
      matches.map((match) => [
        `${match.name}:${coordinateKey(match.coordinates)}`,
        match,
      ]),
    ).values(),
  ];
}

function compareAccess(first: SchoolMatch, second: SchoolMatch) {
  return (
    (second.accessScore ?? -1) - (first.accessScore ?? -1) ||
    first.driveMinutes - second.driveMinutes ||
    first.name.localeCompare(second.name)
  );
}

function accessScore(qualityScore: number | null, driveMinutes: number) {
  if (qualityScore === null) return null;
  const travelWeight = clamp(1 - Math.max(0, driveMinutes - 5) * 0.04, 0.35, 1);
  return roundToTenth(qualityScore * travelWeight);
}

function estimatedDriveMinutes(distanceMiles: number) {
  return Math.max(3, Math.round(3 + distanceMiles * 4));
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

function normalizeSectors(sectors: SchoolSector[] | undefined): SchoolSector[] {
  const filtered = [...new Set(sectors ?? ['public'])].filter(
    (sector): sector is SchoolSector =>
      sector === 'public' || sector === 'private',
  );
  return filtered.length ? filtered : ['public'];
}

function formatScore(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function roundDistance(value: number) {
  return Math.round(value * 10) / 10;
}

function roundToTenth(value: number) {
  return clamp(Math.round(value * 10) / 10, 0, 5);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function coordinateKey(coordinates: Coordinates) {
  return `${coordinates.lat},${coordinates.lng}`;
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
