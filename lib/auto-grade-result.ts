import {
  placeCategoryLabels,
  type House,
  type HouseRankerSettings,
  type PlaceCategory,
  type SchoolLevelMatch,
  type SchoolMatch,
} from '@/lib/house-ranker';

export type AutoGradeResponse = {
  error?: string;
  commute: null | {
    minutes: number[];
    bestModes?: Array<string | null>;
    averageMinutes: number;
    grade: number;
  };
  walkability:
    | { unavailable: true; reason: string }
    | {
        places: Array<{
          category: PlaceCategory;
          name: string | null;
          distanceMeters: number | null;
          walkingMinutes: number | null;
        }>;
        averageMinutes: number;
        grade: number;
      };
  schools:
    | { unavailable: true; reason: string }
    | {
        matchesByLevel: SchoolLevelMatch[];
        grade: number | null;
      };
  subjectiveRatings: Array<{
    criterionId: string;
    score: number;
    rationale: string;
    evidence: string[];
    confidence: 'low' | 'medium' | 'high';
    sources: Array<{ title: string; url: string }>;
  }>;
};

export function applyAutoGradeResult(
  house: House,
  grade: AutoGradeResponse,
  settings: HouseRankerSettings,
  criterionIds?: Iterable<string>,
): House {
  const targets = new Set(
    criterionIds ?? [
      'commute',
      'walkable',
      'schools',
      ...grade.subjectiveRatings.map((rating) => rating.criterionId),
    ],
  );
  const commuteText = grade.commute
    ? `${grade.commute.averageMinutes} min average · ${grade.commute.minutes.join(' / ')} min`
    : 'Add commute addresses in setup';
  const nearbyText =
    'unavailable' in grade.walkability
      ? grade.walkability.reason
      : `${grade.walkability.averageMinutes} min average walk · ${grade.walkability.places.length} essentials`;
  const schoolsText =
    'unavailable' in grade.schools
      ? grade.schools.reason
      : schoolSummaryText(grade.schools.matchesByLevel);
  const commuteDetails = grade.commute
    ? grade.commute.minutes.map((minutes, index) => {
        const mode = grade.commute?.bestModes?.[index]?.replace('_', ' ');
        const destination = settings.commute.addresses[index];
        return `${minutes} min${mode ? ` · ${mode}` : ''}${destination ? ` to ${destination}` : ''}`;
      })
    : [];
  const walkabilityDetails =
    'unavailable' in grade.walkability
      ? []
      : grade.walkability.places.flatMap((place) => {
          if (
            !place.name ||
            place.distanceMeters === null ||
            place.walkingMinutes === null
          ) {
            return [];
          }
          return [
            `${placeCategoryLabels[place.category]} — ${place.name} · ${formatDistance(place.distanceMeters)} · ~${place.walkingMinutes} min walk`,
          ];
        });
  const walkabilityRationale =
    'grade' in grade.walkability
      ? `${grade.walkability.averageMinutes} min average walk against a ${settings.walkability.targetMinutes} min maximum. The maximum scores 3/5; faster walks score higher and slower walks score lower.${walkabilityDetails.length ? ` Amenities found: ${walkabilityDetails.join('; ')}.` : ''}`
      : undefined;
  const schoolDetails =
    'unavailable' in grade.schools
      ? []
      : grade.schools.matchesByLevel.flatMap((level) => [
          `${level.levelLabel} access: ${level.levelScore.toFixed(1)}/5 · ${level.suitableOptionCount} option${level.suitableOptionCount === 1 ? '' : 's'} rated ${level.minimumRating}+/10 within ${level.maxTravelMinutes} min`,
          `${level.levelLabel} closest suitable: ${level.closestSuitable ? schoolMatchText(level.closestSuitable) : 'No suitable option within the travel limit'}`,
          `${level.levelLabel} best suitable: ${level.bestReachable ? schoolMatchText(level.bestReachable) : 'No school meets the minimum rating within the travel limit'}`,
        ]);
  const schoolSources =
    'unavailable' in grade.schools
      ? []
      : schoolMatchSources(grade.schools.matchesByLevel);
  const compactSchoolLevels =
    'unavailable' in grade.schools
      ? []
      : grade.schools.matchesByLevel.map((level) => ({
          ...level,
          candidateOptions: [],
        }));
  const subjectiveRatings = Object.fromEntries(
    grade.subjectiveRatings
      .filter((rating) => targets.has(rating.criterionId))
      .map((rating) => [
        rating.criterionId,
        {
          ...house.ratings[rating.criterionId],
          auto: rating.score,
          details: rating.evidence,
          rationale: rating.rationale,
          confidence: rating.confidence,
          sources: rating.sources,
        },
      ]),
  );

  return {
    ...house,
    commute: targets.has('commute') ? commuteText : house.commute,
    nearby: targets.has('walkable') ? nearbyText : house.nearby,
    schools: targets.has('schools') ? schoolsText : house.schools,
    ratings: {
      ...house.ratings,
      ...subjectiveRatings,
      ...(targets.has('commute') && grade.commute
        ? {
            commute: {
              ...house.ratings.commute,
              auto: grade.commute.grade,
              details: commuteDetails,
              rationale: `${grade.commute.averageMinutes} min average against a ${settings.commute.targetMinutes} min maximum. The maximum scores 3/5; faster trips score higher and slower trips score lower.`,
            },
          }
        : {}),
      ...(targets.has('walkable') && 'grade' in grade.walkability
        ? {
            walkable: {
              ...house.ratings.walkable,
              auto: grade.walkability.grade,
              details: walkabilityDetails,
              rationale: walkabilityRationale,
            },
          }
        : {}),
      ...(targets.has('schools') &&
      'grade' in grade.schools &&
      typeof grade.schools.grade === 'number'
        ? {
            schools: {
              ...house.ratings.schools,
              auto: grade.schools.grade,
              details: schoolDetails,
              schoolLevels: compactSchoolLevels,
              sources: schoolSources,
            },
          }
        : {}),
    },
  };
}

function formatDistance(distanceMeters: number) {
  return distanceMeters < 1000
    ? `${distanceMeters} m`
    : `${(distanceMeters / 1000).toFixed(1)} km`;
}

function schoolSummaryText(matchesByLevel: SchoolLevelMatch[]) {
  if (!matchesByLevel.length) return 'Select at least one school level';
  const suitableOptions = matchesByLevel.reduce(
    (sum, level) => sum + level.suitableOptionCount,
    0,
  );
  const { maxTravelMinutes, minimumRating } = matchesByLevel[0];
  return `${suitableOptions} suitable school option${suitableOptions === 1 ? '' : 's'} rated ${minimumRating}+/10 across ${matchesByLevel.length} selected level${matchesByLevel.length === 1 ? '' : 's'} · up to ${maxTravelMinutes} min`;
}

function schoolMatchText(match: SchoolMatch) {
  const sector =
    match.sector === 'public'
      ? 'Public · '
      : match.sector === 'private'
        ? 'Private · '
        : '';
  const travel =
    typeof match.driveMinutes === 'number'
      ? `${match.driveMinutes} min`
      : `${match.distanceMiles.toFixed(1)} mi`;
  return `${sector}${match.name} · ${travel} · ${match.ratingBand.replace(/^Private staffing proxy/, 'Proxy Score')}`;
}

function schoolMatchSources(matchesByLevel: SchoolLevelMatch[]) {
  const sources = new Map<string, { title: string; url: string }>();
  for (const level of matchesByLevel) {
    for (const match of level.topOptions) {
      if (!match.overviewUrl) continue;
      sources.set(match.overviewUrl, {
        title: `${match.name} profile`,
        url: match.overviewUrl,
      });
    }
  }
  return [...sources.values()];
}
