import type {
  SchoolLevelCode,
  SchoolLevelMatches,
  SchoolMatch as RankedSchoolMatch,
  SchoolSector as RankedSchoolSector,
} from './school-rankings';

export type Priority = 'must' | 'nice' | 'neutral';

export type Criterion = {
  id: string;
  label: string;
  group: 'Must-haves' | 'Nice-to-haves';
  priorities: Record<string, Priority>;
  autoNote: string;
  assessmentPrompt?: string;
  guidanceMode?: 'auto' | 'manual';
};

export type HouseRankerPerson = {
  id: string;
  name: string;
};

export type Rating = {
  auto: number | null;
  override?: number;
  details?: string[];
  schoolLevels?: SchoolLevelMatch[];
  rationale?: string;
  confidence?: 'low' | 'medium' | 'high';
  sources?: Array<{ title: string; url: string }>;
};

export type SchoolMatch = RankedSchoolMatch;
export type SchoolLevelMatch = SchoolLevelMatches;

export type House = {
  id: string;
  name: string;
  price?: string;
  listingUrl?: string;
  estimatedPriceLow?: number;
  estimatedPriceHigh?: number;
  priceEstimateRationale?: string;
  priceEstimateSources?: Array<{ title: string; url: string }>;
  commute: string;
  nearby: string;
  schools: string;
  notes: string;
  ratings: Record<string, Rating>;
};

export type CommuteMode =
  | 'driving'
  | 'public_transport'
  | 'walking'
  | 'cycling';
export type PlaceCategory =
  | 'grocery'
  | 'coffee'
  | 'restaurant'
  | 'park'
  | 'transit';

export const placeCategoryLabels: Record<PlaceCategory, string> = {
  grocery: 'Grocery store',
  coffee: 'Coffee shop',
  restaurant: 'Restaurant',
  park: 'Park',
  transit: 'Transit stop',
};
export type SchoolLevel = SchoolLevelCode;
export type SchoolSector = RankedSchoolSector;

export type HouseRankerSettings = {
  people: HouseRankerPerson[];
  criteria: Criterion[];
  budget: {
    targetPrice: number;
    maxPrice: number;
  };
  commute: {
    addresses: string[];
    modes: CommuteMode[];
    targetMinutes: number;
    arrivalTimes: string[];
  };
  walkability: {
    categories: PlaceCategory[];
    targetMinutes: number;
  };
  schools: {
    levelCodes: SchoolLevel[];
    sectors: SchoolSector[];
    maxTravelMinutes: number;
    minimumRating: number;
  };
};

export const computedCriteria: Criterion[] = [
  {
    id: 'budget',
    label: 'Budget',
    group: 'Must-haves',
    priorities: { 'person-1': 'must' },
    autoNote: 'Computed from the asking price and your target range',
  },
  {
    id: 'commute',
    label: 'Commute',
    group: 'Nice-to-haves',
    priorities: { 'person-1': 'nice' },
    autoNote: 'Computed from your destinations, travel modes, and time limit',
  },
  {
    id: 'walkable',
    label: 'Walkability',
    group: 'Nice-to-haves',
    priorities: { 'person-1': 'nice' },
    autoNote: 'Computed from walking times to your selected essentials',
  },
  {
    id: 'schools',
    label: 'Schools',
    group: 'Nice-to-haves',
    priorities: { 'person-1': 'nice' },
    autoNote:
      'Computed from reachable school quality, travel time, and nearby choices',
  },
];

export const defaultCriteria: Criterion[] = [
  ...computedCriteria,
  {
    id: 'neighborhood',
    label: 'Safe neighborhood',
    group: 'Must-haves',
    priorities: { 'person-1': 'must' },
    autoNote: 'Local data plus your own visit assessment',
    guidanceMode: 'manual',
    assessmentPrompt:
      'Use recent local crime trends, traffic safety, street lighting, and visible street conditions. A 5/5 has low incident levels compared with nearby areas and no material safety concerns; reduce the score for recurring violent or property crime, hazardous traffic, or weak evidence.',
  },
  {
    id: 'outdoor-space',
    label: 'Backyard / terrace',
    group: 'Must-haves',
    priorities: { 'person-1': 'must' },
    autoNote: 'Listing details and outdoor square footage',
    guidanceMode: 'manual',
    assessmentPrompt:
      'Use listing photos, floor plans, dimensions, and descriptions to assess private, usable outdoor space. A 5/5 is a generous and functional private yard or terrace; reduce the score for small, shared, exposed, poorly maintained, or absent space.',
  },
];

export const defaultSettings: HouseRankerSettings = {
  people: [{ id: 'person-1', name: 'Alex' }],
  criteria: defaultCriteria,
  budget: {
    targetPrice: 0,
    maxPrice: 0,
  },
  commute: {
    addresses: [''],
    modes: ['driving'],
    targetMinutes: 30,
    arrivalTimes: ['09:00'],
  },
  walkability: {
    categories: ['grocery', 'coffee', 'restaurant', 'park', 'transit'],
    targetMinutes: 15,
  },
  schools: {
    levelCodes: ['p', 'e', 'm', 'h'],
    sectors: ['public'],
    maxTravelMinutes: 20,
    minimumRating: 7,
  },
};

export function normalizeSettings(
  saved?: Partial<HouseRankerSettings>,
): HouseRankerSettings {
  if (!saved) return structuredClone(defaultSettings);
  const people = normalizePeople(saved.people);
  const savedCriteria = Array.isArray(saved.criteria)
    ? saved.criteria
    : defaultCriteria;
  const savedCriteriaById = new Map(
    savedCriteria.map((criterion) => [criterion.id, criterion]),
  );
  const sourceCriteria = [
    ...savedCriteria,
    ...computedCriteria.filter((preset) => !savedCriteriaById.has(preset.id)),
  ];
  const criteria = sourceCriteria
    .filter((criterion) => criterion.id && criterion.label)
    .map((criterion) => {
      const preset = defaultCriteria.find((item) => item.id === criterion.id);
      return {
        id: criterion.id,
        label: criterion.label,
        group:
          criterion.group === 'Must-haves'
            ? ('Must-haves' as const)
            : ('Nice-to-haves' as const),
        priorities: normalizePriorities(
          criterion.priorities,
          people,
          preset?.priorities['person-1'] ?? 'nice',
        ),
        autoNote:
          criterion.autoNote ||
          preset?.autoNote ||
          'Your custom assessment guidance',
        ...(criterion.assessmentPrompt === undefined
          ? preset?.assessmentPrompt === undefined
            ? {}
            : { assessmentPrompt: preset.assessmentPrompt }
          : { assessmentPrompt: criterion.assessmentPrompt }),
        ...(criterion.guidanceMode === undefined
          ? preset?.guidanceMode === undefined
            ? {}
            : { guidanceMode: preset.guidanceMode }
          : { guidanceMode: criterion.guidanceMode }),
      };
    });
  return {
    people,
    criteria,
    budget: {
      ...defaultSettings.budget,
      ...saved.budget,
    },
    commute: {
      addresses: saved.commute?.addresses?.length
        ? saved.commute.addresses
        : defaultSettings.commute.addresses,
      modes: normalizeCommuteModes(saved.commute),
      targetMinutes:
        typeof saved.commute?.targetMinutes === 'number'
          ? saved.commute.targetMinutes
          : defaultSettings.commute.targetMinutes,
      arrivalTimes: normalizeArrivalTimes(saved.commute),
    },
    walkability: {
      categories: saved.walkability?.categories?.length
        ? saved.walkability.categories
        : defaultSettings.walkability.categories,
      targetMinutes:
        typeof saved.walkability?.targetMinutes === 'number'
          ? saved.walkability.targetMinutes
          : defaultSettings.walkability.targetMinutes,
    },
    schools: normalizeSchoolSettings(saved.schools),
  };
}

function normalizeSchoolSettings(
  savedSchools: Partial<HouseRankerSettings['schools']> | undefined,
) {
  const sectors = Array.isArray(savedSchools?.sectors)
    ? savedSchools.sectors.filter(
        (sector): sector is SchoolSector =>
          sector === 'public' || sector === 'private',
      )
    : [];
  return {
    levelCodes: Array.isArray(savedSchools?.levelCodes)
      ? savedSchools.levelCodes
      : defaultSettings.schools.levelCodes,
    sectors: sectors.length ? sectors : defaultSettings.schools.sectors,
    maxTravelMinutes:
      typeof savedSchools?.maxTravelMinutes === 'number'
        ? savedSchools.maxTravelMinutes
        : defaultSettings.schools.maxTravelMinutes,
    minimumRating:
      typeof savedSchools?.minimumRating === 'number'
        ? savedSchools.minimumRating
        : defaultSettings.schools.minimumRating,
  };
}

export function criterionPriority(
  criterion: Criterion,
  personId: string,
): Priority {
  return criterion.priorities[personId] ?? 'nice';
}

export function sortCriteriaByImportance(
  criteria: Criterion[],
  people: HouseRankerPerson[],
) {
  return criteria
    .map((criterion, index) => {
      const priorities = people.map((person) =>
        criterionPriority(criterion, person.id),
      );
      return {
        criterion,
        index,
        mustCount: priorities.filter((priority) => priority === 'must').length,
        niceCount: priorities.filter((priority) => priority === 'nice').length,
      };
    })
    .sort(
      (first, second) =>
        second.mustCount - first.mustCount ||
        second.niceCount - first.niceCount ||
        first.index - second.index,
    )
    .map(({ criterion }) => criterion);
}

export function buildSubjectiveAssessmentCriteria(criteria: Criterion[]) {
  return criteria
    .filter(
      (criterion) =>
        criterion.guidanceMode === 'auto' || criterion.assessmentPrompt?.trim(),
    )
    .map((criterion) => ({
      id: criterion.id,
      label: criterion.label,
      requirements:
        criterion.assessmentPrompt?.trim() ||
        `Assess “${criterion.label}” using observable listing, location, and public-record evidence. A 5/5 should be an unusually strong match; use lower scores when evidence is weak or the home falls short.`,
      priorities: criterion.priorities,
      suggestedEvidence: criterion.autoNote,
    }));
}

function normalizeCommuteModes(
  commute: Partial<HouseRankerSettings['commute']> | undefined,
) {
  return commute?.modes?.length ? commute.modes : defaultSettings.commute.modes;
}

function normalizeArrivalTimes(
  commute: Partial<HouseRankerSettings['commute']> | undefined,
) {
  const arrivalTimes = commute?.arrivalTimes
    ?.filter((time) => time.trim())
    .slice(0, 4);
  return arrivalTimes?.length
    ? arrivalTimes
    : defaultSettings.commute.arrivalTimes;
}

function normalizePeople(value: unknown): HouseRankerPerson[] {
  if (!Array.isArray(value)) return structuredClone(defaultSettings.people);
  const seen = new Set<string>();
  const people = value
    .filter((person): person is HouseRankerPerson =>
      Boolean(person?.id && person?.name?.trim()),
    )
    .filter((person) => {
      if (seen.has(person.id)) return false;
      seen.add(person.id);
      return true;
    })
    .slice(0, 5)
    .map((person) => ({ id: person.id, name: person.name.trim() }));
  return people.length ? people : structuredClone(defaultSettings.people);
}

function normalizePriorities(
  value: unknown,
  people: HouseRankerPerson[],
  fallback: Priority,
) {
  const priorities =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    people.map((person) => {
      const priority = priorities[person.id];
      return [
        person.id,
        priority === 'must' || priority === 'nice' || priority === 'neutral'
          ? priority
          : fallback,
      ];
    }),
  ) as Record<string, Priority>;
}
