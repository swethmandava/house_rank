'use client';

import {
  SyntheticEvent,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AlertCircle,
  Check,
  CircleCheck,
  Cloud,
  ExternalLink,
  Eye,
  EyeOff,
  House as HouseIcon,
  LoaderCircle,
  Minus,
  Pencil,
  Plus,
  RotateCw,
  Settings2,
  Share2,
  Sparkles,
  Trash2,
  UserPlus,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  applyAutoGradeResult,
  type AutoGradeResponse,
} from '@/lib/auto-grade-result';
import {
  buildSubjectiveAssessmentCriteria,
  criterionPriority,
  defaultCriteria,
  defaultSettings,
  type Criterion,
  type House,
  type HouseRankerPerson,
  type HouseRankerSettings,
  type Priority,
  type Rating,
  normalizeSettings,
  sortCriteriaByImportance,
  type SchoolLevelMatch,
  type SchoolMatch,
} from '@/lib/house-ranker';
import { useBoardId } from '@/hooks/use-board-id';
import { setBoardState, subscribeToBoardState } from '@/lib/house-ranker-store';
import { readJsonResponse } from '@/lib/http';
import { ratingContent, type RatingSource } from '@/lib/rating-content';
import { SCHOOL_DATA_VERSION } from '@/lib/school-rankings';

type ModelContext = {
  registerTool: (
    tool: {
      name: string;
      title: string;
      description: string;
      inputSchema: Record<string, unknown>;
      annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
      execute: (input: unknown) => unknown;
    },
    options?: { signal?: AbortSignal },
  ) => void | Promise<void>;
};

type ListingResearchResult = {
  address: string;
  listingPrice: number;
  estimatedPriceLow: number;
  estimatedPriceHigh: number;
  estimateRationale: string;
  sources: Array<{ title: string; url: string }>;
};

const priorityLabel: Record<Priority, string> = {
  must: 'Must',
  nice: 'Nice',
  neutral: 'Neutral',
};

const priorityWeight: Record<Priority, number> = {
  must: 3,
  nice: 1.5,
  neutral: 0,
};

const systemCriterionIds = new Set([
  'budget',
  'walkable',
  'commute',
  'schools',
]);

function effectiveScore(rating: Rating | undefined) {
  if (!rating) return null;
  return rating.override ?? rating.auto;
}

function criterionDisplayGroup(
  criterion: Criterion,
  people: HouseRankerPerson[],
): Criterion['group'] | null {
  const priorities = people.map((person) =>
    criterionPriority(criterion, person.id),
  );
  if (priorities.includes('must')) return 'Must-haves';
  if (priorities.includes('nice')) return 'Nice-to-haves';
  return null;
}

function parsePrice(price?: string) {
  if (!price?.trim()) return null;
  const normalized = price.toLowerCase().replace(/[$,\s]/g, '');
  const value = Number.parseFloat(normalized);
  if (!Number.isFinite(value)) return null;
  if (normalized.endsWith('m')) return value * 1_000_000;
  if (normalized.endsWith('k')) return value * 1_000;
  return value;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatCompactCurrency(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

async function fetchListingResearch(
  listingUrl: string,
): Promise<ListingResearchResult> {
  const result = await fetch('/api/openai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'research_listing', listingUrl }),
  });
  const data = await readJsonResponse<{
    research?: ListingResearchResult;
    error?: string;
  }>(result);
  if (!result.ok || !data.research?.address) {
    throw new Error(data.error || 'Could not research this listing');
  }
  return data.research;
}

function initialForName(name: string) {
  return name.trim().charAt(0).toUpperCase() || '?';
}

function budgetRating(
  house: House,
  settings: HouseRankerSettings['budget'],
): Rating {
  const previous = house.ratings.budget;
  if (settings.targetPrice <= 0 || settings.maxPrice <= 0) {
    return {
      auto: null,
      ...(previous?.override === undefined
        ? {}
        : { override: previous.override }),
      details: ['Set your target and maximum in setup'],
    };
  }

  const price = parsePrice(house.price);
  if (price === null) {
    return {
      auto: null,
      ...(previous?.override === undefined
        ? {}
        : { override: previous.override }),
      details: ['Add an asking price to grade the budget'],
    };
  }

  const target = Math.max(0, settings.targetPrice);
  const maximum = Math.max(target + 1, settings.maxPrice);
  const auto =
    price <= target
      ? 5
      : price > maximum
        ? 1
        : Math.round((5 - ((price - target) / (maximum - target)) * 3) * 10) /
          10;
  const difference = maximum - price;
  return {
    auto,
    ...(previous?.override === undefined
      ? {}
      : { override: previous.override }),
    details: [
      `${formatCurrency(price)} asking`,
      difference >= 0
        ? `${formatCurrency(difference)} below maximum`
        : `${formatCurrency(Math.abs(difference))} over maximum`,
    ],
  };
}

function houseSummary(
  house: House,
  criteria: Criterion[],
  people: HouseRankerPerson[],
) {
  let total = 0;
  let weightTotal = 0;
  let graded = 0;
  const issues: Criterion[] = [];

  for (const criterion of criteria) {
    const weight = people.reduce(
      (sum, person) =>
        sum + priorityWeight[criterionPriority(criterion, person.id)],
      0,
    );
    if (weight === 0) continue;
    const score = effectiveScore(house.ratings[criterion.id]);
    if (score === null) continue;
    graded += 1;
    total += score * weight;
    weightTotal += 5 * weight;
    if (
      people.some(
        (person) => criterionPriority(criterion, person.id) === 'must',
      ) &&
      score < 3
    ) {
      issues.push(criterion);
    }
  }

  return {
    score: weightTotal ? Math.round((total / weightTotal) * 100) : null,
    graded,
    issues,
  };
}

function cellLabel(rating: Rating | undefined) {
  const score = effectiveScore(rating);
  if (score === null) return 'Not graded';
  return `${score.toFixed(1)} out of 5${rating?.override === undefined ? '' : ', edited'}`;
}

function scoreBarColor(score: number) {
  if (score >= 4) return 'bg-emerald-500';
  if (score >= 3) return 'bg-yellow-400';
  return 'bg-red-500';
}

function scoreTextColor(score: number) {
  if (score >= 4) return 'text-emerald-600 dark:text-emerald-400';
  if (score >= 3) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-red-600 dark:text-red-400';
}

function scoreSliderColor(score: number) {
  if (score >= 4) {
    return '[&_[data-slot=slider-range]]:bg-emerald-500 [&_[data-slot=slider-thumb]]:border-emerald-500';
  }
  if (score >= 3) {
    return '[&_[data-slot=slider-range]]:bg-yellow-400 [&_[data-slot=slider-thumb]]:border-yellow-400';
  }
  return '[&_[data-slot=slider-range]]:bg-red-500 [&_[data-slot=slider-thumb]]:border-red-500';
}

function ratingDetails(
  house: House,
  criterion: Criterion,
  rating: Rating | undefined,
) {
  if (rating?.details?.length) {
    const details =
      criterion.id === 'schools'
        ? rating.details.filter(
            (detail) =>
              !detail.startsWith('Each public K–12 component is the current'),
          )
        : rating.details;
    return details.slice(0, criterion.id === 'schools' ? 8 : 2);
  }
  if (criterion.id === 'commute') return [house.commute];
  if (criterion.id === 'walkable') return [house.nearby];
  if (criterion.id === 'schools') return [house.schools];
  return [`Based on ${criterion.autoNote.toLowerCase()}`];
}

function ratingNarrative(
  house: House,
  criterion: Criterion,
  rating: Rating | undefined,
) {
  const details = ratingDetails(house, criterion, rating);
  return ratingContent(
    rating?.rationale ?? details.join(' · '),
    rating?.sources,
  );
}

function SourceLinks({
  sources,
  limit = 8,
}: {
  sources: RatingSource[];
  limit?: number;
}) {
  if (!sources.length) return null;
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1.5">
      {sources.slice(0, limit).map((source) => (
        <a
          key={source.url}
          href={source.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-w-0 items-center gap-1 text-[11px] font-medium text-primary underline-offset-2 hover:underline"
        >
          <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{source.title}</span>
        </a>
      ))}
    </div>
  );
}

function schoolRatingLabel(match: SchoolMatch) {
  return match.ratingBand.replace(/^Private staffing proxy/, 'Proxy Score');
}

function schoolResultsMatchSettings(
  rating: Rating | undefined,
  settings: HouseRankerSettings['schools'],
) {
  const levels = rating?.schoolLevels;
  if (!levels?.length) return true;
  const expectedLevels = [...new Set(settings.levelCodes)].sort().join(',');
  const resultLevels = levels
    .map((level) => level.levelCode)
    .sort()
    .join(',');
  const expectedSectors = [...new Set(settings.sectors)].sort().join(',');
  return (
    expectedLevels === resultLevels &&
    levels.every(
      (level) =>
        level.dataVersion === SCHOOL_DATA_VERSION &&
        level.minimumRating === settings.minimumRating &&
        level.maxTravelMinutes === settings.maxTravelMinutes &&
        [...(level.includedSectors ?? [])].sort().join(',') === expectedSectors,
    )
  );
}

const schoolLevelOrder = new Map([
  ['p', 0],
  ['e', 1],
  ['m', 2],
  ['h', 3],
]);

type SchoolEvidenceRow = {
  levelCode?: SchoolLevelMatch['levelCode'];
  label: string;
  access: string;
  closestPublic: SchoolMatch | null;
  closestPrivate: SchoolMatch | null;
  bestPublic: SchoolMatch | null;
  bestPrivate: SchoolMatch | null;
  closestAll?: SchoolMatch | null;
  bestAll?: SchoolMatch | null;
  closestText?: string;
  bestText?: string;
};

function schoolEvidenceRows(
  levels: SchoolLevelMatch[] | undefined,
  fallbackDetails: string[],
): SchoolEvidenceRow[] {
  if (levels?.length) {
    return [...levels]
      .sort(
        (first, second) =>
          (schoolLevelOrder.get(first.levelCode) ?? 4) -
          (schoolLevelOrder.get(second.levelCode) ?? 4),
      )
      .map((level) => ({
        levelCode: level.levelCode,
        label: level.levelLabel,
        access: `${level.levelScore.toFixed(1)}/5 · ${level.suitableOptionCount} suitable`,
        closestPublic: level.closestPublic,
        closestPrivate: level.closestPrivate,
        bestPublic: level.bestPublic,
        bestPrivate: level.bestPrivate,
        closestAll: level.levelCode === 'p' ? level.closestSuitable : undefined,
        bestAll: level.levelCode === 'p' ? level.bestPreschool : undefined,
      }));
  }

  const rows = new Map<string, SchoolEvidenceRow>();
  for (const detail of fallbackDetails) {
    const match = detail.match(
      /^(Preschool|Elementary|Middle school|High school) (access|closest suitable|best suitable): (.+)$/i,
    );
    if (!match) continue;
    const [, level, kind, text] = match;
    const row = rows.get(level) ?? {
      label: level,
      access: 'Not available',
      closestPublic: null,
      closestPrivate: null,
      bestPublic: null,
      bestPrivate: null,
    };
    if (kind.toLowerCase() === 'access') row.access = text;
    if (kind.toLowerCase() === 'closest suitable') {
      row.closestText = text;
    }
    if (kind.toLowerCase() === 'best suitable') {
      row.bestText = text;
    }
    rows.set(level, row);
  }
  return [...rows.values()];
}

function SchoolMatchSummary({ match }: { match: SchoolMatch | null }) {
  if (!match) return <span className="text-muted-foreground">—</span>;
  const travel = `${match.driveMinutes} min`;
  return (
    <span className="block min-w-0">
      <span className="block font-medium text-foreground">{match.name}</span>
      <span className="block text-[11px] leading-4 text-muted-foreground">
        {match.gradeSpan ? `Grades ${match.gradeSpan} · ` : ''}
        {travel} · {schoolRatingLabel(match)}
      </span>
    </span>
  );
}

function blankHouse(
  name: string,
  criteria: Criterion[],
  price = '',
  listingUrl = '',
  marketEstimate?: Pick<
    House,
    | 'estimatedPriceLow'
    | 'estimatedPriceHigh'
    | 'priceEstimateRationale'
    | 'priceEstimateSources'
  >,
): House {
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `house-${Date.now()}`;
  return {
    id,
    name,
    price,
    listingUrl,
    ...marketEstimate,
    commute: 'Waiting for auto grade',
    nearby: 'Waiting for auto grade',
    schools: 'Waiting for school criteria',
    notes: '',
    ratings: Object.fromEntries(
      criteria.map((criterion) => [criterion.id, { auto: null }]),
    ),
  };
}

export default function Home() {
  const boardId = useBoardId();
  const [houses, setHouses] = useState<House[]>([]);
  const [criteria, setCriteria] = useState<Criterion[]>(defaultCriteria);
  const [settings, setSettings] =
    useState<HouseRankerSettings>(defaultSettings);
  const [hiddenHouseIds, setHiddenHouseIds] = useState<string[]>([]);
  const [expandedCriterionIds, setExpandedCriterionIds] = useState<string[]>(
    [],
  );
  const [sheetOpen, setSheetOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const [namesOpen, setNamesOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [draftPeopleNames, setDraftPeopleNames] = useState<
    Record<string, string>
  >({});
  const [draftPeople, setDraftPeople] = useState<HouseRankerPerson[]>([]);
  const [selectedHouseId, setSelectedHouseId] = useState<string | null>(null);
  const [selectedCriterionId, setSelectedCriterionId] = useState<string | null>(
    null,
  );
  const [newHouseUrl, setNewHouseUrl] = useState('');
  const [researchingListing, setResearchingListing] = useState(false);
  const [listingResearchError, setListingResearchError] = useState('');
  const [shareStatus, setShareStatus] = useState<'idle' | 'copied'>('idle');
  const [recomputingHouseId, setRecomputingHouseId] = useState<string | null>(
    null,
  );
  const [gradingHouseIds, setGradingHouseIds] = useState<string[]>([]);
  const [remoteGradingHouseIds, setRemoteGradingHouseIds] = useState<string[]>(
    [],
  );
  const [remoteGradingCriterionIds, setRemoteGradingCriterionIds] = useState<
    string[]
  >([]);
  const [recomputingCriterionKey, setRecomputingCriterionKey] = useState<
    string | null
  >(null);
  const [aiRatingError, setAiRatingError] = useState('');
  const [syncStatus, setSyncStatus] = useState<
    'connecting' | 'saved' | 'saving' | 'error'
  >('connecting');
  const remoteReady = useRef(false);
  const lastSavedBoard = useRef<string | null>(null);
  const housesRef = useRef(houses);
  const schoolRefreshesRef = useRef(new Set<string>());
  const sheetScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!boardId) return;
    return subscribeToBoardState(
      boardId,
      (board, exists) => {
        const nextHouses = board?.houses ?? [];
        const nextSettings = normalizeSettings(board?.settings);
        const nextHiddenHouseIds = board?.hiddenHouseIds ?? [];
        const serialized = JSON.stringify({
          houses: nextHouses,
          settings: nextSettings,
          hiddenHouseIds: nextHiddenHouseIds,
        });
        lastSavedBoard.current = serialized;
        remoteReady.current = true;
        setHouses(nextHouses);
        setSettings(nextSettings);
        setCriteria(nextSettings.criteria);
        setHiddenHouseIds(nextHiddenHouseIds);
        setRemoteGradingHouseIds(
          board?.regrade?.status === 'running'
            ? board.regrade.pendingHouseIds
            : [],
        );
        setRemoteGradingCriterionIds(
          board?.regrade?.status === 'running'
            ? (board.regrade.criterionIds ??
                nextSettings.criteria.map((criterion) => criterion.id))
            : [],
        );
        setSyncStatus('saved');
        if (!exists) {
          void setBoardState(boardId, {
            houses: nextHouses,
            settings: nextSettings,
            hiddenHouseIds: nextHiddenHouseIds,
          }).catch(() => setSyncStatus('error'));
        }
      },
      () => setSyncStatus('error'),
    );
  }, [boardId]);

  useEffect(() => {
    if (!boardId || !remoteReady.current) return;
    const board = { houses, settings, hiddenHouseIds };
    const serialized = JSON.stringify(board);
    if (serialized === lastSavedBoard.current) return;
    setSyncStatus('saving');
    const timer = window.setTimeout(() => {
      lastSavedBoard.current = serialized;
      void setBoardState(boardId, board)
        .then(() => setSyncStatus('saved'))
        .catch(() => {
          lastSavedBoard.current = null;
          setSyncStatus('error');
        });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [boardId, hiddenHouseIds, houses, settings]);

  useEffect(() => {
    housesRef.current = houses;
  }, [houses]);

  useEffect(() => {
    if (!sheetOpen) return;
    const frame = window.requestAnimationFrame(() => {
      const container = sheetScrollRef.current;
      if (!container) return;
      if (!selectedCriterionId) {
        container.scrollTo({ top: 0 });
        return;
      }
      const target = document.getElementById(
        `house-detail-${selectedCriterionId}`,
      );
      if (!target) return;
      container.scrollTo({
        top: Math.max(0, target.offsetTop - 16),
        behavior: 'smooth',
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedCriterionId, selectedHouseId, sheetOpen]);

  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContext })
      .modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();

    const register = async () => {
      await context.registerTool(
        {
          name: 'add_house',
          title: 'Add house',
          description:
            'Research a listing link and add the house to the comparison table.',
          inputSchema: {
            type: 'object',
            properties: {
              listingUrl: {
                type: 'string',
                minLength: 1,
                description: 'A complete real-estate listing URL.',
              },
            },
            required: ['listingUrl'],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: true },
          async execute(input) {
            const value = input as { listingUrl?: unknown };
            if (
              typeof value.listingUrl !== 'string' ||
              !value.listingUrl.trim()
            ) {
              throw new Error('listingUrl must be a non-empty string');
            }
            const listingUrl = value.listingUrl.trim();
            const research = await fetchListingResearch(listingUrl);
            const house = blankHouse(
              research.address,
              criteria,
              research.listingPrice > 0
                ? formatCurrency(research.listingPrice)
                : '',
              listingUrl,
              {
                estimatedPriceLow: research.estimatedPriceLow,
                estimatedPriceHigh: research.estimatedPriceHigh,
                priceEstimateRationale: research.estimateRationale,
                priceEstimateSources: research.sources,
              },
            );
            setHouses((current) => [...current, house]);
            return { id: house.id, name: house.name, status: 'added' };
          },
        },
        { signal: lifecycle.signal },
      );

      await context.registerTool(
        {
          name: 'set_house_grade',
          title: 'Set house grade',
          description: 'Set a manual 0–5 grade for one house and criterion.',
          inputSchema: {
            type: 'object',
            properties: {
              houseId: { type: 'string' },
              criterionId: { type: 'string' },
              score: { type: 'number', minimum: 0, maximum: 5 },
            },
            required: ['houseId', 'criterionId', 'score'],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          execute(input) {
            const value = input as {
              houseId?: unknown;
              criterionId?: unknown;
              score?: unknown;
            };
            if (
              typeof value.houseId !== 'string' ||
              typeof value.criterionId !== 'string'
            ) {
              throw new Error('houseId and criterionId must be strings');
            }
            if (
              typeof value.score !== 'number' ||
              value.score < 0 ||
              value.score > 5
            ) {
              throw new Error('score must be between 0 and 5');
            }
            const house = housesRef.current.find(
              (item) => item.id === value.houseId,
            );
            const criterion = criteria.find(
              (item) => item.id === value.criterionId,
            );
            if (!house) throw new Error('House not found');
            if (!criterion) throw new Error('Criterion not found');
            setHouses((current) =>
              current.map((item) =>
                item.id === value.houseId
                  ? {
                      ...item,
                      ratings: {
                        ...item.ratings,
                        [value.criterionId as string]: {
                          ...item.ratings[value.criterionId as string],
                          override: value.score as number,
                        },
                      },
                    }
                  : item,
              ),
            );
            return {
              houseId: house.id,
              criterionId: criterion.id,
              score: value.score,
              status: 'updated',
            };
          },
        },
        { signal: lifecycle.signal },
      );
    };

    void register().catch(() => undefined);

    return () => lifecycle.abort();
  }, [criteria]);

  const rankedHouses = useMemo<House[]>(
    () =>
      houses.map((house) => {
        const schoolsCurrent = schoolResultsMatchSettings(
          house.ratings.schools,
          settings.schools,
        );
        return {
          ...house,
          ratings: {
            ...house.ratings,
            budget: budgetRating(house, settings.budget),
            ...(schoolsCurrent
              ? {}
              : {
                  schools: {
                    auto: null,
                    details: ['Updating results for your school settings…'],
                  },
                }),
          },
        };
      }),
    [houses, settings.budget, settings.schools],
  );
  const people = settings.people;
  const activeGradingHouseIds = useMemo(
    () => [...new Set([...gradingHouseIds, ...remoteGradingHouseIds])],
    [gradingHouseIds, remoteGradingHouseIds],
  );
  const activeCriteria = useMemo(
    () =>
      criteria.filter(
        (criterion) => criterionDisplayGroup(criterion, people) !== null,
      ),
    [criteria, people],
  );
  const activeGradingCriterionKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const houseId of gradingHouseIds) {
      for (const criterion of activeCriteria) {
        keys.add(`${houseId}:${criterion.id}`);
      }
    }
    for (const houseId of remoteGradingHouseIds) {
      for (const criterionId of remoteGradingCriterionIds) {
        keys.add(`${houseId}:${criterionId}`);
      }
    }
    return keys;
  }, [
    activeCriteria,
    gradingHouseIds,
    remoteGradingCriterionIds,
    remoteGradingHouseIds,
  ]);

  const selectedHouse = useMemo(
    () => rankedHouses.find((house) => house.id === selectedHouseId) ?? null,
    [rankedHouses, selectedHouseId],
  );
  const visibleHouses = useMemo(
    () => rankedHouses.filter((house) => !hiddenHouseIds.includes(house.id)),
    [hiddenHouseIds, rankedHouses],
  );
  const hiddenHouses = useMemo(
    () => rankedHouses.filter((house) => hiddenHouseIds.includes(house.id)),
    [hiddenHouseIds, rankedHouses],
  );
  const selectedSummary = selectedHouse
    ? houseSummary(selectedHouse, activeCriteria, people)
    : null;
  const allDetailsExpanded =
    activeCriteria.length > 0 &&
    activeCriteria.every((criterion) =>
      expandedCriterionIds.includes(criterion.id),
    );

  function openHouse(houseId: string) {
    setSelectedHouseId(houseId);
    setSelectedCriterionId(null);
    setSheetOpen(true);
  }

  function openRating(houseId: string, criterionId: string) {
    setSelectedHouseId(houseId);
    setSelectedCriterionId(criterionId);
    setAiRatingError('');
    setSheetOpen(true);
  }

  function saveOverride(criterionId: string, score: number) {
    if (!selectedHouse) return;
    setHouses((current) =>
      current.map((house) =>
        house.id === selectedHouse.id
          ? {
              ...house,
              ratings: {
                ...house.ratings,
                [criterionId]: {
                  ...house.ratings[criterionId],
                  override: score,
                },
              },
            }
          : house,
      ),
    );
  }

  function saveRationale(criterionId: string, rationale: string) {
    if (!selectedHouse) return;
    setHouses((current) =>
      current.map((house) =>
        house.id === selectedHouse.id
          ? {
              ...house,
              ratings: {
                ...house.ratings,
                [criterionId]: {
                  ...house.ratings[criterionId],
                  rationale,
                },
              },
            }
          : house,
      ),
    );
  }

  function clearOverride(houseId: string, criterionId: string) {
    setHouses((current) =>
      current.map((house) => {
        if (house.id !== houseId) return house;
        const rating = { ...house.ratings[criterionId] };
        delete rating.override;
        return {
          ...house,
          ratings: { ...house.ratings, [criterionId]: rating },
        };
      }),
    );
  }

  async function addHouse(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const listingUrl = newHouseUrl.trim();
    if (!listingUrl) return;
    setResearchingListing(true);
    setListingResearchError('');
    try {
      const research = await fetchListingResearch(listingUrl);
      const house = blankHouse(
        research.address,
        criteria,
        research.listingPrice > 0 ? formatCurrency(research.listingPrice) : '',
        listingUrl,
        {
          estimatedPriceLow: research.estimatedPriceLow,
          estimatedPriceHigh: research.estimatedPriceHigh,
          priceEstimateRationale: research.estimateRationale,
          priceEstimateSources: research.sources,
        },
      );
      setHouses((current) => [...current, house]);
      setNewHouseUrl('');
      setAddOpen(false);
      void autoGradeHouse(house);
    } catch (error) {
      setListingResearchError(
        error instanceof Error
          ? error.message
          : 'Could not research this listing',
      );
    } finally {
      setResearchingListing(false);
    }
  }

  async function autoGradeHouse(
    house: House,
    includeSubjective = true,
    requiredCriterionId?: string,
  ): Promise<{ success: boolean; score?: number; error?: string }> {
    if (!requiredCriterionId) {
      setGradingHouseIds((current) =>
        current.includes(house.id) ? current : [...current, house.id],
      );
    }
    try {
      const result = await fetch('/api/auto-grade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          houseAddress: house.name,
          listingUrl: house.listingUrl,
          notes: house.notes,
          commute: settings.commute,
          walkability: settings.walkability,
          schools: settings.schools,
          subjectiveCriteria: includeSubjective
            ? buildSubjectiveAssessmentCriteria(activeCriteria)
            : [],
          ...(requiredCriterionId
            ? { requestedCriterionIds: [requiredCriterionId] }
            : {}),
          timeZoneOffsetMinutes: new Date().getTimezoneOffset(),
        }),
      });
      const grade = await readJsonResponse<AutoGradeResponse>(result);
      if (!result.ok) {
        return {
          success: false,
          error: grade.error || 'Automatic grading failed',
        };
      }
      const requestedScore =
        requiredCriterionId === 'commute'
          ? (grade.commute?.grade ?? null)
          : requiredCriterionId === 'walkable' && 'grade' in grade.walkability
            ? grade.walkability.grade
            : requiredCriterionId === 'schools' &&
                'grade' in grade.schools &&
                typeof grade.schools.grade === 'number'
              ? grade.schools.grade
              : null;
      const requestedGradeAvailable =
        !requiredCriterionId || requestedScore !== null;
      const requestedError =
        requiredCriterionId === 'commute' && !grade.commute
          ? 'Add commute addresses in setup'
          : requiredCriterionId === 'walkable' &&
              'unavailable' in grade.walkability
            ? grade.walkability.reason
            : requiredCriterionId === 'schools' &&
                'unavailable' in grade.schools
              ? grade.schools.reason
              : undefined;
      setHouses((current) =>
        current.map((item) =>
          item.id === house.id
            ? applyAutoGradeResult(item, grade, settings)
            : item,
        ),
      );
      return {
        success: requestedGradeAvailable,
        ...(requestedScore === null ? {} : { score: requestedScore }),
        ...(requestedError ? { error: requestedError } : {}),
      };
    } catch (error) {
      // A house stays pending when API credentials or network access are unavailable.
      return {
        success: false,
        error:
          error instanceof Error ? error.message : 'Automatic grading failed',
      };
    } finally {
      if (!requiredCriterionId) {
        setGradingHouseIds((current) =>
          current.filter((houseId) => houseId !== house.id),
        );
      }
    }
  }

  const refreshStaleSchoolResult = useEffectEvent((house: House) => {
    void autoGradeHouse(house, false, 'schools');
  });

  useEffect(() => {
    if (!remoteReady.current || remoteGradingHouseIds.length) return;
    const settingsKey = JSON.stringify(settings.schools);
    const timer = window.setTimeout(() => {
      for (const house of houses) {
        if (
          schoolResultsMatchSettings(house.ratings.schools, settings.schools)
        ) {
          continue;
        }
        const refreshKey = `${house.id}:${settingsKey}`;
        if (schoolRefreshesRef.current.has(refreshKey)) continue;
        schoolRefreshesRef.current.add(refreshKey);
        refreshStaleSchoolResult(house);
      }
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [houses, remoteGradingHouseIds, settings.schools]);

  async function recomputeHouse(house: House) {
    setRecomputingHouseId(house.id);
    await autoGradeHouse(house);
    setRecomputingHouseId(null);
  }

  async function recomputeCharacteristic(house: House, criterion: Criterion) {
    const guidance =
      criterion.assessmentPrompt?.trim() ||
      buildSubjectiveAssessmentCriteria([criterion])[0]?.requirements;
    if (!guidance) return;
    const key = `${house.id}:${criterion.id}`;
    setRecomputingCriterionKey(key);
    setAiRatingError('');
    try {
      const result = await fetch('/api/openai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'rate_characteristic',
          house: {
            address: house.name,
            listingUrl: house.listingUrl,
            notes: house.notes,
          },
          criterion: {
            id: criterion.id,
            label: criterion.label,
            requirements: guidance,
            suggestedEvidence: criterion.autoNote,
          },
        }),
      });
      const data = await readJsonResponse<{
        rating?: {
          score: number;
          rationale: string;
          evidence: string[];
          confidence: 'low' | 'medium' | 'high';
          sources: Array<{ title: string; url: string }>;
        };
        error?: string;
      }>(result);
      if (!result.ok || !data.rating) {
        throw new Error(data.error || 'Could not grade this priority');
      }
      setHouses((current) =>
        current.map((item) =>
          item.id === house.id
            ? {
                ...item,
                ratings: {
                  ...item.ratings,
                  [criterion.id]: {
                    auto: data.rating!.score,
                    details: data.rating!.evidence,
                    rationale: data.rating!.rationale,
                    confidence: data.rating!.confidence,
                    sources: data.rating!.sources,
                  },
                },
              }
            : item,
        ),
      );
    } catch (error) {
      setAiRatingError(
        error instanceof Error
          ? error.message
          : 'Could not grade this priority',
      );
    } finally {
      setRecomputingCriterionKey(null);
    }
  }

  async function refreshGrade(house: House, criterion: Criterion) {
    setSelectedCriterionId(criterion.id);
    if (!systemCriterionIds.has(criterion.id)) {
      await recomputeCharacteristic(house, criterion);
      return;
    }

    const key = `${house.id}:${criterion.id}`;
    setRecomputingCriterionKey(key);
    setAiRatingError('');
    try {
      if (criterion.id === 'budget') {
        clearOverride(house.id, criterion.id);
        return;
      }
      const refreshed = await autoGradeHouse(house, false, criterion.id);
      if (!refreshed.success) {
        throw new Error(refreshed.error || 'Could not refresh this grade');
      }
      clearOverride(house.id, criterion.id);
    } catch (error) {
      setAiRatingError(
        error instanceof Error ? error.message : 'Could not refresh this grade',
      );
    } finally {
      setRecomputingCriterionKey(null);
    }
  }

  function removeSelectedHouse() {
    if (!selectedHouse) return;
    setHouses((current) =>
      current.filter((house) => house.id !== selectedHouse.id),
    );
    setHiddenHouseIds((current) =>
      current.filter((houseId) => houseId !== selectedHouse.id),
    );
    setDeleteOpen(false);
    setSheetOpen(false);
  }

  function hideHouse(houseId: string) {
    setHiddenHouseIds((current) =>
      current.includes(houseId) ? current : [...current, houseId],
    );
  }

  function showHouse(houseId: string) {
    setHiddenHouseIds((current) => current.filter((id) => id !== houseId));
  }

  function setAllDetails(expanded: boolean) {
    setExpandedCriterionIds(
      expanded ? activeCriteria.map((criterion) => criterion.id) : [],
    );
  }

  function openNames() {
    setDraftPeople(people);
    setDraftPeopleNames(
      Object.fromEntries(people.map((person) => [person.id, person.name])),
    );
    setNamesOpen(true);
  }

  function addDraftPerson() {
    if (draftPeople.length >= 5) return;
    const personId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `person-${Date.now()}`;
    const name = `Person ${draftPeople.length + 1}`;
    setDraftPeople((current) => [...current, { id: personId, name }]);
    setDraftPeopleNames((current) => ({ ...current, [personId]: name }));
  }

  function removeDraftPerson(personId: string) {
    if (draftPeople.length <= 1) return;
    setDraftPeople((current) =>
      current.filter((person) => person.id !== personId),
    );
    setDraftPeopleNames((current) => {
      const next = { ...current };
      delete next[personId];
      return next;
    });
  }

  function saveNames(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setSettings((current) => ({
      ...current,
      people: draftPeople.map((person, index) => ({
        ...person,
        name: draftPeopleNames[person.id]?.trim() || `Person ${index + 1}`,
      })),
      criteria: current.criteria.map((criterion) => ({
        ...criterion,
        priorities: Object.fromEntries(
          draftPeople.map((person) => [
            person.id,
            criterion.priorities[person.id] ??
              (criterion.id === 'budget' ? 'must' : 'nice'),
          ]),
        ),
      })),
    }));
    setNamesOpen(false);
  }

  async function shareBoard() {
    if (!boardId) return;
    const boardUrl = `${window.location.origin}/${boardId}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'House Ranker', url: boardUrl });
        return;
      }
      await navigator.clipboard.writeText(boardUrl);
      setShareStatus('copied');
      window.setTimeout(() => setShareStatus('idle'), 1800);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      await navigator.clipboard.writeText(boardUrl);
      setShareStatus('copied');
      window.setTimeout(() => setShareStatus('idle'), 1800);
    }
  }

  const groupedCriteria = (['Must-haves', 'Nice-to-haves'] as const).filter(
    (group) =>
      activeCriteria.some(
        (criterion) => criterionDisplayGroup(criterion, people) === group,
      ),
  );

  if (!boardId) {
    return (
      <main className="grid min-h-screen place-items-center bg-background text-sm text-muted-foreground">
        Creating your board…
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border/70 bg-background/92 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1500px] items-center justify-between gap-4 px-4 sm:px-7">
          <div className="flex items-center gap-2.5 font-medium tracking-[-0.02em]">
            <span className="grid size-8 place-items-center rounded-[10px] bg-foreground text-background">
              <HouseIcon className="size-4" aria-hidden="true" />
            </span>
            House ranker
          </div>
          <div className="flex items-center gap-2">
            {syncStatus === 'error' && (
              <span className="hidden items-center gap-1.5 text-xs text-destructive sm:inline-flex">
                <Cloud className="size-3.5" aria-hidden="true" />
                Sync issue
              </span>
            )}
            <button
              type="button"
              className="mr-1 flex items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Edit names: ${people.map((person) => person.name).join(', ')}`}
              title="Edit names"
              onClick={openNames}
            >
              <span className="flex -space-x-1.5">
                {people.map((person) => (
                  <span
                    key={person.id}
                    className="grid size-7 place-items-center rounded-full border-2 border-background bg-secondary text-[11px] font-medium text-muted-foreground"
                  >
                    {initialForName(person.name)}
                  </span>
                ))}
              </span>
              <Pencil
                className="ml-1 size-3 text-muted-foreground"
                aria-hidden="true"
              />
            </button>
            <Button
              variant="ghost"
              className="rounded-full px-3"
              onClick={() => void shareBoard()}
              aria-label="Share this board"
            >
              <Share2 data-icon="inline-start" />
              <span className="hidden sm:inline">
                {shareStatus === 'copied' ? 'Copied' : 'Share'}
              </span>
            </Button>
            <Button
              className="rounded-full px-3.5"
              render={<a href={`/${boardId}/setup`} aria-label="Open setup" />}
            >
              <Settings2 data-icon="inline-start" />
              Setup
            </Button>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-[1500px] px-4 py-8 sm:px-7 sm:py-11">
        <div className="mb-8">
          <div>
            <h1 className="text-3xl font-medium tracking-[-0.045em] sm:text-4xl">
              Homes
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Compare every home against the same priorities.
            </p>
          </div>
        </div>

        <div className="overflow-hidden rounded-[22px] border border-border/80 bg-card shadow-[0_18px_50px_rgb(0_0_0/0.055)]">
          <Table
            className="table-fixed"
            style={{
              minWidth: Math.max(820, 260 + visibleHouses.length * 180 + 104),
            }}
          >
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="sticky left-0 z-20 w-[220px] border-r border-border/60 bg-card px-5 py-5 align-middle sm:w-[260px]">
                  <div className="flex w-full items-center justify-between gap-3">
                    <span>Criteria</span>
                    <div className="flex shrink-0 items-center gap-2 text-[11px] font-normal text-muted-foreground">
                      <Switch
                        size="sm"
                        checked={allDetailsExpanded}
                        onCheckedChange={setAllDetails}
                        aria-label="Show score details"
                      />
                      <span>Details</span>
                    </div>
                  </div>
                </TableHead>
                {visibleHouses.map((house) => {
                  const summary = houseSummary(house, activeCriteria, people);
                  const pending = summary.graded < activeCriteria.length;
                  const isGrading = activeGradingHouseIds.includes(house.id);
                  const listingPrice = parsePrice(house.price);
                  const [streetAddress, ...localityParts] = house.name
                    .split(',')
                    .map((part) => part.trim());
                  const locality = localityParts.join(', ');
                  const priceDetails = [
                    listingPrice
                      ? `${formatCompactCurrency(listingPrice)} list`
                      : null,
                    house.estimatedPriceLow && house.estimatedPriceHigh
                      ? `${formatCompactCurrency(house.estimatedPriceLow)}–${formatCompactCurrency(house.estimatedPriceHigh)} est.`
                      : null,
                  ].filter((detail): detail is string => detail !== null);
                  return (
                    <TableHead
                      key={house.id}
                      className="min-w-[165px] px-3 py-5 align-bottom text-center"
                    >
                      <div className="relative">
                        <button
                          type="button"
                          className="group w-full rounded-xl px-6 py-2 text-center transition-colors hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() => openHouse(house.id)}
                          title={house.name}
                        >
                          <span className="block min-h-8 text-[13px] leading-4 font-medium">
                            <span className="block truncate">
                              {streetAddress}
                            </span>
                            {locality && (
                              <span className="block truncate">{locality}</span>
                            )}
                          </span>
                          {priceDetails.length > 0 && (
                            <span className="mt-0.5 block truncate text-[10px] font-normal tabular-nums text-muted-foreground/80">
                              {priceDetails.join(' · ')}
                            </span>
                          )}
                          <span className="mt-2 block text-[28px] font-medium tracking-[-0.05em] tabular-nums">
                            {summary.score ?? '—'}
                          </span>
                          <span
                            className="mt-1 inline-flex items-center gap-1 text-[11px] font-normal text-muted-foreground"
                            aria-live="polite"
                          >
                            {pending ? (
                              <>
                                {isGrading && (
                                  <LoaderCircle
                                    className="size-3 animate-spin text-primary"
                                    aria-hidden="true"
                                  />
                                )}
                                {summary.graded} of {activeCriteria.length}{' '}
                                graded
                              </>
                            ) : summary.issues.length ? (
                              <>
                                <AlertCircle
                                  className="size-3 text-destructive"
                                  aria-hidden="true"
                                />
                                {summary.issues.length} issue
                                {summary.issues.length === 1 ? '' : 's'}
                              </>
                            ) : (
                              <>
                                <Check
                                  className="size-3 text-emerald-600 dark:text-emerald-400"
                                  aria-hidden="true"
                                />
                                Eligible
                              </>
                            )}
                          </span>
                        </button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="absolute top-1 right-1 rounded-full text-muted-foreground hover:text-foreground"
                          aria-label={`Hide ${house.name}`}
                          title={`Hide ${house.name}`}
                          onClick={() => hideHouse(house.id)}
                        >
                          <EyeOff />
                        </Button>
                      </div>
                    </TableHead>
                  );
                })}
                <TableHead className="w-[104px] px-3 py-5 text-center align-middle">
                  <div className="flex flex-col items-center gap-2">
                    <Button
                      variant="secondary"
                      size="icon-lg"
                      className="rounded-full"
                      aria-label="Add a house"
                      onClick={() => setAddOpen(true)}
                    >
                      <Plus />
                    </Button>
                    {hiddenHouses.length > 0 && (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-[11px] font-normal text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => setHiddenOpen(true)}
                      >
                        <Eye className="size-3" aria-hidden="true" />
                        {hiddenHouses.length} hidden
                      </button>
                    )}
                  </div>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groupedCriteria.map((group) => (
                <FragmentGroup
                  key={group}
                  group={group}
                  criteria={activeCriteria}
                  houses={visibleHouses}
                  people={people}
                  expandedCriterionIds={expandedCriterionIds}
                  gradingCriterionKeys={activeGradingCriterionKeys}
                  recomputingCriterionKey={recomputingCriterionKey}
                  onOpenRating={openRating}
                />
              ))}
            </TableBody>
          </Table>
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          Values are auto-filled when available. A pencil marks anything you
          changed.
        </p>
      </section>

      <Sheet
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open);
          if (!open) setDeleteOpen(false);
        }}
      >
        <SheetContent
          className="w-full gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[560px] data-[side=right]:md:max-w-[640px] data-[side=right]:lg:max-w-[760px] data-[side=right]:xl:max-w-[860px]"
          side="right"
        >
          {selectedHouse && (
            <>
              {selectedHouse.listingUrl && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="absolute top-3 right-[76px] z-10 text-muted-foreground"
                  aria-label="View listing"
                  title="View listing"
                  render={
                    <a
                      href={selectedHouse.listingUrl}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="View listing"
                    >
                      <span className="sr-only">View listing</span>
                    </a>
                  }
                >
                  <ExternalLink />
                </Button>
              )}
              <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
                <AlertDialogTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="absolute top-3 right-11 z-10 text-muted-foreground hover:text-destructive"
                    />
                  }
                >
                  <Trash2 />
                  <span className="sr-only">Remove listing</span>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Remove {selectedHouse.name}?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      This removes the listing and all of its grades from this
                      board. This cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      onClick={removeSelectedHouse}
                    >
                      Remove listing
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <SheetHeader className="border-b px-6 py-6 pr-32">
                <SheetTitle className="text-xl tracking-[-0.03em]">
                  {selectedHouse.listingUrl ? (
                    <a
                      href={selectedHouse.listingUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="group inline-flex max-w-full items-center gap-1.5 rounded-sm hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={`View listing for ${selectedHouse.name}`}
                    >
                      <span className="truncate">{selectedHouse.name}</span>
                      <ExternalLink
                        className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary"
                        aria-hidden="true"
                      />
                    </a>
                  ) : (
                    selectedHouse.name
                  )}
                </SheetTitle>
                <SheetDescription className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span>
                    {selectedHouse.price
                      ? `${selectedHouse.price} asking`
                      : 'Asking price unavailable'}
                  </span>
                  {Boolean(
                    selectedHouse.estimatedPriceLow &&
                    selectedHouse.estimatedPriceHigh,
                  ) && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>
                        {formatCurrency(selectedHouse.estimatedPriceLow!)}–
                        {formatCurrency(selectedHouse.estimatedPriceHigh!)}{' '}
                        estimated
                      </span>
                    </>
                  )}
                </SheetDescription>
              </SheetHeader>
              <div
                ref={sheetScrollRef}
                className="relative flex-1 overflow-y-auto px-6 py-5"
              >
                <section className="rounded-2xl bg-secondary/55 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-3xl font-medium tracking-[-0.05em] tabular-nums">
                          {selectedSummary?.score ?? '—'}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          / 100
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {selectedSummary?.graded ?? 0} of{' '}
                        {activeCriteria.length} criteria graded
                      </p>
                    </div>
                    <Button
                      variant="secondary"
                      className="rounded-full bg-background"
                      disabled={recomputingHouseId === selectedHouse.id}
                      onClick={() => void recomputeHouse(selectedHouse)}
                    >
                      <RotateCw
                        data-icon="inline-start"
                        className={
                          recomputingHouseId === selectedHouse.id
                            ? 'animate-spin'
                            : ''
                        }
                      />
                      {recomputingHouseId === selectedHouse.id
                        ? 'Recomputing'
                        : 'Recompute'}
                    </Button>
                  </div>
                </section>

                <section className="mt-6">
                  <h3 className="mb-3 font-medium">Grades</h3>
                  <div className="divide-y border-y border-border/80">
                    {activeCriteria.map((criterion) => (
                      <ScoreDetailCard
                        key={criterion.id}
                        house={selectedHouse}
                        criterion={criterion}
                        onScoreChange={(score) =>
                          saveOverride(criterion.id, score)
                        }
                        onRationaleChange={(rationale) =>
                          saveRationale(criterion.id, rationale)
                        }
                        onRecompute={() =>
                          void refreshGrade(selectedHouse, criterion)
                        }
                        recomputing={
                          recomputingCriterionKey ===
                          `${selectedHouse.id}:${criterion.id}`
                        }
                        grading={
                          activeGradingCriterionKeys.has(
                            `${selectedHouse.id}:${criterion.id}`,
                          ) ||
                          recomputingCriterionKey ===
                            `${selectedHouse.id}:${criterion.id}`
                        }
                        aiError={
                          selectedCriterionId === criterion.id
                            ? aiRatingError
                            : ''
                        }
                      />
                    ))}
                  </div>
                </section>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          if (!open && researchingListing) return;
          setAddOpen(open);
          if (!open) {
            setNewHouseUrl('');
            setListingResearchError('');
          }
        }}
      >
        <DialogContent className="rounded-[20px] p-5 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg tracking-[-0.025em]">
              Add a house
            </DialogTitle>
            <DialogDescription>
              Paste a listing link. We’ll find the address, asking price, and a
              market estimate from recent nearby sales.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={addHouse} className="mt-1 space-y-4">
            <label
              className="block space-y-2.5 text-sm"
              htmlFor="new-house-url"
            >
              <span>Listing link</span>
              <Input
                id="new-house-url"
                type="url"
                value={newHouseUrl}
                onChange={(event) => {
                  setNewHouseUrl(event.target.value);
                  setListingResearchError('');
                }}
                placeholder="https://www.redfin.com/…"
                autoComplete="url"
                disabled={researchingListing}
                required
              />
            </label>
            {listingResearchError && (
              <p
                className="flex items-start gap-2 text-sm text-destructive"
                role="alert"
              >
                <AlertCircle
                  className="mt-0.5 size-4 shrink-0"
                  aria-hidden="true"
                />
                {listingResearchError}
              </p>
            )}
            <p className="text-xs leading-relaxed text-muted-foreground">
              The estimate is based on available listing data and comparable
              sales. It is not an appraisal.
            </p>
            <DialogFooter className="-mx-5 -mb-5 mt-5 rounded-b-[20px] px-5 py-4">
              <Button
                className="rounded-full px-5"
                type="submit"
                disabled={researchingListing || !newHouseUrl.trim()}
              >
                {researchingListing && <Spinner data-icon="inline-start" />}
                {researchingListing ? 'Researching…' : 'Research & add'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={hiddenOpen} onOpenChange={setHiddenOpen}>
        <DialogContent className="rounded-[20px] p-5 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg tracking-[-0.025em]">
              Hidden houses
            </DialogTitle>
            <DialogDescription>
              Bring a house back into the comparison table.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-1 divide-y">
            {hiddenHouses.map((house) => (
              <div
                key={house.id}
                className="flex items-center justify-between gap-4 py-3"
              >
                <span className="min-w-0 truncate text-sm font-medium">
                  {house.name}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  className="rounded-full"
                  onClick={() => showHouse(house.id)}
                >
                  <Eye data-icon="inline-start" />
                  Show
                </Button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={namesOpen} onOpenChange={setNamesOpen}>
        <DialogContent className="rounded-[20px] p-5 sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center justify-between gap-4 pr-7">
              <DialogTitle className="text-lg tracking-[-0.025em]">
                People
              </DialogTitle>
              <span className="text-xs text-muted-foreground">
                {draftPeople.length} of 5
              </span>
            </div>
            <DialogDescription>
              Add everyone who will set priorities for this board.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={saveNames} className="mt-1 space-y-4">
            {draftPeople.map((person, index) => (
              <div key={person.id} className="flex items-center gap-2">
                <Input
                  id={`person-name-${person.id}`}
                  className="flex-1"
                  value={draftPeopleNames[person.id] ?? ''}
                  onChange={(event) =>
                    setDraftPeopleNames((current) => ({
                      ...current,
                      [person.id]: event.target.value,
                    }))
                  }
                  placeholder={`Person ${index + 1}`}
                  aria-label={`Person ${index + 1} name`}
                />
                {draftPeople.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="rounded-full text-muted-foreground hover:text-destructive"
                    onClick={() => removeDraftPerson(person.id)}
                    aria-label={`Remove person ${index + 1}`}
                  >
                    <Trash2 />
                  </Button>
                )}
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full rounded-xl border-dashed text-primary hover:text-primary"
              disabled={draftPeople.length >= 5}
              onClick={addDraftPerson}
            >
              <UserPlus data-icon="inline-start" />
              {draftPeople.length >= 5
                ? 'Maximum of 5 people reached'
                : 'Add another person'}
            </Button>
            <DialogFooter className="-mx-5 -mb-5 mt-5 rounded-b-[20px] px-5 py-4">
              <Button className="rounded-full px-5" type="submit">
                Save people
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function ScoreDetailCard({
  house,
  criterion,
  onScoreChange,
  onRationaleChange,
  onRecompute,
  recomputing,
  grading,
  aiError,
}: {
  house: House;
  criterion: Criterion;
  onScoreChange: (score: number) => void;
  onRationaleChange: (rationale: string) => void;
  onRecompute: () => void;
  recomputing: boolean;
  grading: boolean;
  aiError: string;
}) {
  const rating = house.ratings[criterion.id];
  const score = effectiveScore(rating);
  const details = ratingDetails(house, criterion, rating);
  const narrative = ratingNarrative(house, criterion, rating);
  const schoolRows = schoolEvidenceRows(rating?.schoolLevels, details);
  const aiEligible = Boolean(
    criterion.assessmentPrompt?.trim() || criterion.guidanceMode === 'auto',
  );
  const canRecompute = systemCriterionIds.has(criterion.id) || aiEligible;

  return (
    <section id={`house-detail-${criterion.id}`} className="py-7">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3">
        <h4 className="min-w-0 text-sm font-medium">{criterion.label}</h4>
        <div className="flex min-h-8 items-center justify-end">
          {canRecompute && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="rounded-full text-muted-foreground"
              onClick={onRecompute}
              disabled={recomputing}
              aria-label={`Recompute ${criterion.label}`}
              title="Recompute grade"
            >
              <RotateCw className={recomputing ? 'animate-spin' : ''} />
            </Button>
          )}
        </div>
        {score === null && grading ? (
          <output className="col-span-2 flex min-h-5 items-center gap-2 text-xs text-muted-foreground">
            <LoaderCircle
              className="size-3.5 animate-spin text-primary"
              aria-hidden="true"
            />
            <span>Calculating grade</span>
          </output>
        ) : score === null ? (
          <output className="col-span-2 flex min-h-5 items-center gap-2 text-xs text-muted-foreground">
            <AlertCircle
              className="size-3.5 text-amber-500"
              aria-hidden="true"
            />
            <span>Not graded</span>
          </output>
        ) : (
          <>
            <div className="min-w-0">
              <Slider
                className={scoreSliderColor(score)}
                min={0}
                max={5}
                step={0.5}
                value={[score]}
                onValueChange={(value) =>
                  onScoreChange(Array.isArray(value) ? value[0] : value)
                }
                aria-label={`Grade ${criterion.label}; saves automatically`}
              />
            </div>
            <span
              className={`w-8 shrink-0 text-right text-sm font-medium tabular-nums ${scoreTextColor(score)}`}
            >
              {score.toFixed(1)}
            </span>
          </>
        )}
      </div>

      {score !== null && criterion.id === 'schools' ? (
        <div className="mt-4 overflow-hidden rounded-xl border bg-secondary/25">
          <Table className="min-w-[780px] table-fixed text-xs">
            <TableHeader className="bg-secondary/70">
              <TableRow className="border-b-0 hover:bg-transparent">
                <TableHead
                  rowSpan={2}
                  className="h-9 w-[14%] px-3 text-[11px] text-muted-foreground"
                >
                  Level
                </TableHead>
                <TableHead
                  rowSpan={2}
                  className="h-9 w-[14%] px-2 text-[11px] text-muted-foreground"
                >
                  Access
                </TableHead>
                <TableHead
                  colSpan={2}
                  className="h-8 border-l px-2 text-center text-[11px] font-medium text-foreground"
                >
                  Public
                </TableHead>
                <TableHead
                  colSpan={2}
                  className="h-8 border-l px-2 text-center text-[11px] font-medium text-foreground"
                >
                  Private
                </TableHead>
              </TableRow>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-8 w-[18%] border-l px-2 text-[10px] text-muted-foreground">
                  Closest
                </TableHead>
                <TableHead className="h-8 w-[18%] px-2 text-[10px] text-muted-foreground">
                  Best
                </TableHead>
                <TableHead className="h-8 w-[18%] border-l px-2 text-[10px] text-muted-foreground">
                  Closest
                </TableHead>
                <TableHead className="h-8 w-[18%] px-2 text-[10px] text-muted-foreground">
                  Best
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {schoolRows.map((row) => (
                <TableRow key={row.label} className="hover:bg-transparent">
                  <TableCell className="px-3 py-2.5 align-top whitespace-normal">
                    <span className="font-medium text-foreground">
                      {row.label}
                    </span>
                  </TableCell>
                  <TableCell className="px-2 py-2.5 align-top whitespace-normal text-muted-foreground">
                    {row.access}
                  </TableCell>
                  {row.levelCode === 'p' ? (
                    <>
                      <TableCell
                        className="border-l px-2 py-2.5"
                        aria-label="No public preschool result"
                      />
                      <TableCell
                        className="px-2 py-2.5"
                        aria-label="No public preschool result"
                      />
                      <TableCell className="border-l px-2 py-2.5 align-top whitespace-normal">
                        <SchoolMatchSummary match={row.closestAll ?? null} />
                      </TableCell>
                      <TableCell className="px-2 py-2.5 align-top whitespace-normal">
                        <SchoolMatchSummary match={row.bestAll ?? null} />
                      </TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell className="border-l px-2 py-2.5 align-top whitespace-normal">
                        {row.closestText ? (
                          <span className="text-muted-foreground">
                            {row.closestText}
                          </span>
                        ) : (
                          <SchoolMatchSummary match={row.closestPublic} />
                        )}
                      </TableCell>
                      <TableCell className="px-2 py-2.5 align-top whitespace-normal">
                        {row.bestText ? (
                          <span className="text-muted-foreground">
                            {row.bestText}
                          </span>
                        ) : (
                          <SchoolMatchSummary match={row.bestPublic} />
                        )}
                      </TableCell>
                      <TableCell className="border-l px-2 py-2.5 align-top whitespace-normal">
                        <SchoolMatchSummary match={row.closestPrivate} />
                      </TableCell>
                      <TableCell className="px-2 py-2.5 align-top whitespace-normal">
                        <SchoolMatchSummary match={row.bestPrivate} />
                      </TableCell>
                    </>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : score !== null ? (
        <Textarea
          value={narrative.text}
          onChange={(event) => onRationaleChange(event.target.value)}
          aria-label={`Rationale for ${criterion.label}; saves automatically`}
          placeholder="Add a rationale"
          className="mt-4 min-h-20 resize-y rounded-xl border-0 bg-secondary/45 text-xs leading-5 shadow-none"
        />
      ) : null}

      {score !== null && criterion.id !== 'schools' && (
        <div className="mt-2 px-1">
          <SourceLinks sources={narrative.sources} />
        </div>
      )}

      {aiError && (
        <p className="mt-2 text-xs text-destructive" role="alert">
          {aiError}
        </p>
      )}
    </section>
  );
}

function FragmentGroup({
  group,
  criteria,
  houses,
  people,
  expandedCriterionIds,
  gradingCriterionKeys,
  recomputingCriterionKey,
  onOpenRating,
}: {
  group: 'Must-haves' | 'Nice-to-haves';
  criteria: Criterion[];
  houses: House[];
  people: HouseRankerPerson[];
  expandedCriterionIds: string[];
  gradingCriterionKeys: ReadonlySet<string>;
  recomputingCriterionKey: string | null;
  onOpenRating: (houseId: string, criterionId: string) => void;
}) {
  const rows = sortCriteriaByImportance(criteria, people).filter(
    (criterion) => criterionDisplayGroup(criterion, people) === group,
  );
  return (
    <>
      <TableRow className="border-b-0 bg-secondary/45 hover:bg-secondary/45">
        <TableCell className="sticky left-0 z-20 h-10 w-[220px] border-r border-border/60 bg-secondary px-5 py-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground sm:w-[260px]">
          {group}
        </TableCell>
        <TableCell
          colSpan={houses.length + 1}
          className="h-10 bg-secondary px-0 py-0"
          aria-hidden="true"
        />
      </TableRow>
      {rows.map((criterion) => {
        const isExpanded = expandedCriterionIds.includes(criterion.id);
        return (
          <TableRow key={criterion.id} className="hover:bg-transparent">
            <TableCell className="sticky left-0 z-10 border-r border-border/60 bg-card px-5 py-3.5 align-top">
              <div className="max-w-[220px] whitespace-normal text-sm font-medium leading-5">
                {criterion.label}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {people.map((person) => (
                  <PriorityMark
                    key={person.id}
                    priority={criterionPriority(criterion, person.id)}
                    person={person.name}
                  />
                ))}
              </div>
            </TableCell>
            {houses.map((house) => {
              const rating = house.ratings[criterion.id];
              const score = effectiveScore(rating);
              const isGrading =
                gradingCriterionKeys.has(`${house.id}:${criterion.id}`) ||
                recomputingCriterionKey === `${house.id}:${criterion.id}`;
              const isIssue =
                people.some(
                  (person) =>
                    criterionPriority(criterion, person.id) === 'must',
                ) &&
                score !== null &&
                score < 3;
              const narrative = ratingNarrative(house, criterion, rating);
              return (
                <TableCell key={house.id} className="p-0 text-center align-top">
                  <button
                    type="button"
                    aria-label={`${house.name}, ${criterion.label}: ${cellLabel(rating)}`}
                    className={`group flex min-h-20 w-full flex-col items-center justify-center px-3 py-2 text-sm font-medium tabular-nums transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${isIssue ? 'text-destructive' : ''}`}
                    onClick={() => onOpenRating(house.id, criterion.id)}
                  >
                    {score === null && isGrading ? (
                      <output className="flex min-h-11 w-full items-center justify-center gap-2 px-3 text-xs font-normal text-muted-foreground">
                        <LoaderCircle
                          className="size-3.5 animate-spin text-primary"
                          aria-hidden="true"
                        />
                        Calculating grade
                      </output>
                    ) : score === null ? (
                      <span className="flex min-h-11 w-full items-center justify-center gap-2 px-3 text-xs font-normal text-muted-foreground">
                        <AlertCircle
                          className="size-3.5 text-amber-500"
                          aria-hidden="true"
                        />
                        Not graded
                      </span>
                    ) : (
                      <span className="flex min-h-11 w-full max-w-[240px] items-center gap-3 rounded-xl px-3">
                        <span
                          className="h-2 flex-1 overflow-hidden rounded-full bg-foreground/10"
                          aria-hidden="true"
                        >
                          <span
                            className={`block h-full rounded-full transition-[width] duration-300 ${scoreBarColor(score)}`}
                            style={{ width: `${(score / 5) * 100}%` }}
                          />
                        </span>
                        <span className="w-8 text-right text-base font-semibold">
                          {score.toFixed(1)}
                        </span>
                        {rating?.override !== undefined && (
                          <Pencil
                            className="size-3 text-primary"
                            aria-label="Edited"
                          />
                        )}
                      </span>
                    )}
                  </button>
                  {isExpanded && !(score === null && isGrading) && (
                    <div className="mx-auto w-full max-w-[520px] px-4 pb-3 text-left text-[11px] leading-4 whitespace-normal text-muted-foreground">
                      <p className="line-clamp-3">{narrative.text}</p>
                    </div>
                  )}
                </TableCell>
              );
            })}
            <TableCell />
          </TableRow>
        );
      })}
    </>
  );
}

function PriorityMark({
  priority,
  person,
}: {
  priority: Priority;
  person: string;
}) {
  const Icon =
    priority === 'must' ? CircleCheck : priority === 'nice' ? Sparkles : Minus;
  const label = priorityLabel[priority];
  const fullLabel =
    priority === 'must'
      ? 'Must-have'
      : priority === 'nice'
        ? 'Nice-to-have'
        : 'Neutral';
  const colorClass =
    priority === 'must'
      ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:text-emerald-300 dark:hover:bg-emerald-950'
      : priority === 'nice'
        ? 'bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-950/60 dark:text-amber-300 dark:hover:bg-amber-950'
        : 'bg-secondary/75 text-muted-foreground hover:bg-secondary';
  return (
    <Tooltip>
      <TooltipTrigger
        className={`inline-flex items-center gap-1 rounded-full px-1.5 py-1 text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${colorClass}`}
        aria-label={`${person}: ${label}`}
      >
        <Icon className="size-3" aria-hidden="true" />
        {person}
      </TooltipTrigger>
      <TooltipContent>
        {person}: {fullLabel}
      </TooltipContent>
    </Tooltip>
  );
}
