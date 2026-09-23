'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import {
  ArrowLeft,
  ChevronDown,
  CircleCheck,
  Cloud,
  House as HouseIcon,
  MapPin,
  Minus,
  Plus,
  Sparkles,
  Trash2,
  WandSparkles,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  computedCriteria,
  criterionPriority,
  defaultSettings,
  type CommuteMode,
  type HouseRankerSettings,
  normalizeSettings,
  sortCriteriaByImportance,
  type PlaceCategory,
  type Priority,
  type SchoolLevel,
  type SchoolSector,
} from '@/lib/house-ranker';
import { useBoardId } from '@/hooks/use-board-id';
import {
  mergeBoardState,
  subscribeToBoardState,
} from '@/lib/house-ranker-store';
import { readJsonResponse } from '@/lib/http';

const priorityOptions = [
  {
    value: 'must',
    label: 'Must Have',
    shortLabel: 'Must Have',
    icon: CircleCheck,
  },
  {
    value: 'nice',
    label: 'Nice to Have',
    shortLabel: 'Nice to Have',
    icon: Sparkles,
  },
  { value: 'neutral', label: 'Neutral', shortLabel: 'Neutral', icon: Minus },
] as const;

const categoryOptions: Array<{ value: PlaceCategory; label: string }> = [
  { value: 'grocery', label: 'Grocery store' },
  { value: 'coffee', label: 'Coffee shop' },
  { value: 'restaurant', label: 'Restaurant' },
  { value: 'park', label: 'Park' },
  { value: 'transit', label: 'Transit stop' },
];

const schoolLevelOptions: Array<{ value: SchoolLevel; label: string }> = [
  { value: 'p', label: 'Preschool' },
  { value: 'e', label: 'Elementary' },
  { value: 'm', label: 'Middle school' },
  { value: 'h', label: 'High school' },
];

const schoolSectorOptions: Array<{ value: SchoolSector; label: string }> = [
  { value: 'public', label: 'Public' },
  { value: 'private', label: 'Private' },
];

const commuteModeOptions: Array<{ value: CommuteMode; label: string }> = [
  { value: 'driving', label: 'Driving' },
  { value: 'public_transport', label: 'Public transit' },
  { value: 'walking', label: 'Walking' },
  { value: 'cycling', label: 'Cycling' },
];

const computedCriterionIds = new Set(
  computedCriteria.map((criterion) => criterion.id),
);

function nextArrivalTime(time: string) {
  const [hours, minutes] = time.split(':').map(Number);
  const nextHour = (Number.isFinite(hours) ? hours + 1 : 10) % 24;
  const safeMinutes = Number.isFinite(minutes) ? minutes : 0;
  return `${String(nextHour).padStart(2, '0')}:${String(safeMinutes).padStart(2, '0')}`;
}

export default function SetupPage() {
  const boardId = useBoardId();
  const [settings, setSettings] =
    useState<HouseRankerSettings>(defaultSettings);
  const settingsReadyRef = useRef(false);
  const priorityOrderInitializedRef = useRef(false);
  const persistedSettingsRef = useRef('');
  const [expandedCriterionId, setExpandedCriterionId] = useState<string | null>(
    null,
  );
  const [addingCriterion, setAddingCriterion] = useState(false);
  const [newCriterionName, setNewCriterionName] = useState('');
  const [newCriterionGuidance, setNewCriterionGuidance] = useState('');
  const [generatingGuidance, setGeneratingGuidance] = useState(false);
  const [newCriterionError, setNewCriterionError] = useState('');
  const [syncStatus, setSyncStatus] = useState<
    'connecting' | 'saved' | 'saving' | 'error'
  >('connecting');

  useEffect(() => {
    if (!boardId) return;
    settingsReadyRef.current = false;
    priorityOrderInitializedRef.current = false;
    persistedSettingsRef.current = '';
    return subscribeToBoardState(
      boardId,
      (board) => {
        settingsReadyRef.current = true;
        const normalized = normalizeSettings(board?.settings);
        const nextSettings = priorityOrderInitializedRef.current
          ? normalized
          : {
              ...normalized,
              criteria: sortCriteriaByImportance(
                normalized.criteria,
                normalized.people,
              ),
            };
        priorityOrderInitializedRef.current = true;
        persistedSettingsRef.current = JSON.stringify(normalized);
        setSettings(nextSettings);
        setSyncStatus('saved');
      },
      () => setSyncStatus('error'),
    );
  }, [boardId]);

  useEffect(() => {
    if (!boardId || !settingsReadyRef.current) return;

    const persistedSettings = {
      ...settings,
      commute: {
        ...settings.commute,
        addresses: settings.commute.addresses.map((address) => address.trim()),
      },
    };
    const serializedSettings = JSON.stringify(persistedSettings);
    if (serializedSettings === persistedSettingsRef.current) return;

    const timer = window.setTimeout(() => {
      setSyncStatus('saving');
      void mergeBoardState(boardId, { settings: persistedSettings })
        .then(() => {
          persistedSettingsRef.current = serializedSettings;
          setSyncStatus('saved');
        })
        .catch(() => setSyncStatus('error'));
    }, 350);

    return () => window.clearTimeout(timer);
  }, [boardId, settings]);

  const people = settings.people;

  function setPriority(id: string, personId: string, priority: Priority) {
    setSettings((current) => ({
      ...current,
      criteria: current.criteria.map((criterion) =>
        criterion.id !== id
          ? criterion
          : {
              ...criterion,
              priorities: {
                ...criterion.priorities,
                [personId]: priority,
              },
            },
      ),
    }));
  }

  function addPerson() {
    setSettings((current) => {
      if (current.people.length >= 5) return current;
      const personId =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `person-${Date.now()}`;
      const personCount = current.people.length + 1;
      return {
        ...current,
        people: [
          ...current.people,
          { id: personId, name: `Person ${personCount}` },
        ],
        criteria: current.criteria.map((criterion) => ({
          ...criterion,
          priorities: {
            ...criterion.priorities,
            [personId]: criterion.id === 'budget' ? 'must' : 'nice',
          },
        })),
      };
    });
  }

  function removePerson(personId: string) {
    setSettings((current) => {
      if (current.people.length <= 1) return current;
      return {
        ...current,
        people: current.people.filter((person) => person.id !== personId),
        criteria: current.criteria.map((criterion) => {
          const priorities = { ...criterion.priorities };
          delete priorities[personId];
          return { ...criterion, priorities };
        }),
      };
    });
  }

  function removeCriterion(criterionId: string, label: string) {
    if (!window.confirm(`Delete “${label}”?`)) return;
    setExpandedCriterionId((current) =>
      current === criterionId ? null : current,
    );
    setSettings((current) => ({
      ...current,
      criteria: current.criteria.filter(
        (criterion) => criterion.id !== criterionId,
      ),
    }));
  }

  async function generateNewCriterionGuidance() {
    if (generatingGuidance) return;
    const label = newCriterionName.trim();
    if (!label) return;
    setGeneratingGuidance(true);
    setNewCriterionError('');
    try {
      const result = await fetch('/api/openai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate_guidance',
          characteristic: label,
        }),
      });
      const data = await readJsonResponse<{
        guidance?: string;
        error?: string;
      }>(result);
      if (!result.ok || !data.guidance) {
        throw new Error(data.error || 'Could not generate guidance');
      }
      setNewCriterionGuidance(data.guidance);
    } catch (error) {
      setNewCriterionError(
        error instanceof Error ? error.message : 'Could not generate guidance',
      );
    } finally {
      setGeneratingGuidance(false);
    }
  }

  function addCriterion() {
    const label = newCriterionName.trim();
    const guidance = newCriterionGuidance.trim();
    if (!label || !guidance || generatingGuidance) return;
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? `custom-${crypto.randomUUID()}`
        : `custom-${Date.now()}`;
    setSettings((current) => ({
      ...current,
      criteria: [
        ...current.criteria,
        {
          id,
          label,
          group: 'Nice-to-haves',
          priorities: Object.fromEntries(
            current.people.map((person) => [person.id, 'nice']),
          ),
          autoNote: 'Your custom assessment guidance',
          guidanceMode: 'manual',
          assessmentPrompt: guidance,
        },
      ],
    }));
    setNewCriterionName('');
    setNewCriterionGuidance('');
    setAddingCriterion(false);
  }

  function cancelAddCriterion() {
    setNewCriterionName('');
    setNewCriterionGuidance('');
    setNewCriterionError('');
    setAddingCriterion(false);
  }

  function setAssessmentPrompt(id: string, assessmentPrompt: string) {
    setSettings((current) => ({
      ...current,
      criteria: current.criteria.map((criterion) =>
        criterion.id === id
          ? { ...criterion, assessmentPrompt, guidanceMode: 'manual' }
          : criterion,
      ),
    }));
  }

  function toggleCommuteMode(mode: CommuteMode, checked: boolean) {
    setSettings((current) => {
      if (!checked && current.commute.modes.length === 1) return current;
      return {
        ...current,
        commute: {
          ...current.commute,
          modes: checked
            ? [...new Set([...current.commute.modes, mode])]
            : current.commute.modes.filter((item) => item !== mode),
        },
      };
    });
  }

  function setAddress(index: number, address: string) {
    setSettings((current) => ({
      ...current,
      commute: {
        ...current.commute,
        addresses: current.commute.addresses.map((item, itemIndex) =>
          itemIndex === index ? address : item,
        ),
      },
    }));
  }

  function addAddress() {
    setSettings((current) => ({
      ...current,
      commute: {
        ...current.commute,
        addresses: [...current.commute.addresses, ''],
      },
    }));
  }

  function removeAddress(index: number) {
    setSettings((current) => ({
      ...current,
      commute: {
        ...current.commute,
        addresses: current.commute.addresses.filter(
          (_, itemIndex) => itemIndex !== index,
        ),
      },
    }));
  }

  function setArrivalTime(index: number, arrivalTime: string) {
    setSettings((current) => ({
      ...current,
      commute: {
        ...current.commute,
        arrivalTimes: current.commute.arrivalTimes.map((time, itemIndex) =>
          itemIndex === index ? arrivalTime : time,
        ),
      },
    }));
  }

  function addArrivalTime() {
    setSettings((current) => {
      if (current.commute.arrivalTimes.length >= 4) return current;
      return {
        ...current,
        commute: {
          ...current.commute,
          arrivalTimes: [
            ...current.commute.arrivalTimes,
            nextArrivalTime(current.commute.arrivalTimes.at(-1) ?? '09:00'),
          ],
        },
      };
    });
  }

  function removeArrivalTime(index: number) {
    setSettings((current) => {
      if (current.commute.arrivalTimes.length === 1) return current;
      return {
        ...current,
        commute: {
          ...current.commute,
          arrivalTimes: current.commute.arrivalTimes.filter(
            (_, itemIndex) => itemIndex !== index,
          ),
        },
      };
    });
  }

  function toggleCategory(category: PlaceCategory, checked: boolean) {
    setSettings((current) => ({
      ...current,
      walkability: {
        ...current.walkability,
        categories: checked
          ? [...new Set([...current.walkability.categories, category])]
          : current.walkability.categories.filter((item) => item !== category),
      },
    }));
  }

  function toggleSchoolLevel(level: SchoolLevel, checked: boolean) {
    setSettings((current) => ({
      ...current,
      schools: {
        ...current.schools,
        levelCodes: checked
          ? [...new Set([...current.schools.levelCodes, level])]
          : current.schools.levelCodes.filter((item) => item !== level),
      },
    }));
  }

  function toggleSchoolSector(sector: SchoolSector, checked: boolean) {
    setSettings((current) => {
      if (!checked && current.schools.sectors.length === 1) return current;
      return {
        ...current,
        schools: {
          ...current.schools,
          sectors: checked
            ? [...new Set([...current.schools.sectors, sector])]
            : current.schools.sectors.filter((item) => item !== sector),
        },
      };
    });
  }

  function renderComputedSettings(criterionId: string) {
    if (criterionId === 'budget') {
      return (
        <div className="grid gap-5 sm:grid-cols-2">
          <CurrencyField
            label="Target price"
            placeholder="1,200,000"
            value={settings.budget.targetPrice}
            onChange={(targetPrice) => {
              setSettings((current) => ({
                ...current,
                budget: { ...current.budget, targetPrice },
              }));
            }}
          />
          <CurrencyField
            label="Maximum price"
            placeholder="1,400,000"
            value={settings.budget.maxPrice}
            onChange={(maxPrice) => {
              setSettings((current) => ({
                ...current,
                budget: { ...current.budget, maxPrice },
              }));
            }}
          />
        </div>
      );
    }

    if (criterionId === 'schools') {
      return (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-[1.35fr_0.8fr_180px_150px]">
          <Field label="Grade levels">
            <div className="flex flex-wrap gap-x-5 gap-y-2 pt-1">
              {schoolLevelOptions.map((option) => {
                const checked = settings.schools.levelCodes.includes(
                  option.value,
                );
                return (
                  <label
                    key={option.value}
                    className="flex cursor-pointer items-center gap-2 text-sm text-foreground"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(value) =>
                        toggleSchoolLevel(option.value, value === true)
                      }
                    />
                    {option.label}
                  </label>
                );
              })}
            </div>
          </Field>
          <Field label="School options">
            <div className="flex flex-wrap gap-x-5 gap-y-2 pt-1">
              {schoolSectorOptions.map((option) => {
                const checked = settings.schools.sectors.includes(option.value);
                return (
                  <label
                    key={option.value}
                    className="flex cursor-pointer items-center gap-2 text-sm text-foreground"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(value) =>
                        toggleSchoolSector(option.value, value === true)
                      }
                    />
                    {option.label}
                  </label>
                );
              })}
            </div>
          </Field>
          <Field label="Maximum school trip">
            <div className="relative">
              <Input
                type="number"
                min={5}
                max={60}
                step={5}
                value={settings.schools.maxTravelMinutes}
                onChange={(event) => {
                  setSettings((current) => ({
                    ...current,
                    schools: {
                      ...current.schools,
                      maxTravelMinutes: Number(event.target.value),
                    },
                  }));
                }}
                className="h-10 rounded-xl pr-16"
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
                minutes
              </span>
            </div>
          </Field>
          <Field label="Minimum rating">
            <div className="relative">
              <Input
                type="number"
                min={1}
                max={10}
                step={1}
                value={settings.schools.minimumRating}
                onChange={(event) => {
                  setSettings((current) => ({
                    ...current,
                    schools: {
                      ...current.schools,
                      minimumRating: Number(event.target.value),
                    },
                  }));
                }}
                className="h-10 rounded-xl pr-10"
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
                / 10
              </span>
            </div>
          </Field>
          <p className="text-xs leading-5 text-muted-foreground sm:col-span-2 lg:col-span-4">
            Scores balance school quality, travel time, and the number of
            options meeting your minimum—not just the single highest-rated
            school.
          </p>
        </div>
      );
    }

    if (criterionId === 'walkable') {
      return (
        <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
          <Field label="Nearby essentials">
            <div className="grid grid-cols-2 gap-2 pt-1 sm:grid-cols-3">
              {categoryOptions.map((option) => {
                const checked = settings.walkability.categories.includes(
                  option.value,
                );
                return (
                  <label
                    key={option.value}
                    className="flex cursor-pointer items-center gap-2 text-sm"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(value) =>
                        toggleCategory(option.value, value === true)
                      }
                    />
                    {option.label}
                  </label>
                );
              })}
            </div>
          </Field>
          <Field label="Maximum walk">
            <div className="relative">
              <Input
                type="number"
                min={5}
                max={60}
                value={settings.walkability.targetMinutes}
                onChange={(event) => {
                  setSettings((current) => ({
                    ...current,
                    walkability: {
                      ...current.walkability,
                      targetMinutes: Number(event.target.value),
                    },
                  }));
                }}
                className="h-10 rounded-xl pr-16"
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
                minutes
              </span>
            </div>
          </Field>
        </div>
      );
    }

    if (criterionId === 'commute') {
      return (
        <div className="space-y-5">
          <div className="space-y-2.5">
            {settings.commute.addresses.map((address, index) => (
              <div key={index} className="flex items-center gap-2">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-background text-muted-foreground">
                  <MapPin className="size-4" aria-hidden="true" />
                </span>
                <AddressAutocomplete
                  value={address}
                  onChange={(value) => setAddress(index, value)}
                  placeholder={
                    index === 0
                      ? 'Office address'
                      : 'Another office or destination'
                  }
                  aria-label={`Commute destination ${index + 1}`}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-full text-muted-foreground hover:text-destructive"
                  onClick={() => removeAddress(index)}
                  disabled={settings.commute.addresses.length === 1}
                  aria-label={`Remove destination ${index + 1}`}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
            <Button
              variant="secondary"
              size="sm"
              className="ml-11 rounded-full"
              onClick={addAddress}
            >
              <Plus data-icon="inline-start" /> Add address
            </Button>
          </div>

          <div className="grid gap-8 border-t pt-6 sm:grid-cols-[minmax(0,1.25fr)_minmax(260px,0.75fr)]">
            <Field label="Travel modes (fastest wins)">
              <div className="grid grid-cols-2 gap-x-8 gap-y-3 pt-1 sm:max-w-lg">
                {commuteModeOptions.map((option) => {
                  const checked = settings.commute.modes.includes(option.value);
                  return (
                    <label
                      key={option.value}
                      className="flex cursor-pointer items-center gap-2 text-sm text-foreground"
                    >
                      <Checkbox
                        checked={checked}
                        disabled={
                          checked && settings.commute.modes.length === 1
                        }
                        onCheckedChange={(value) =>
                          toggleCommuteMode(option.value, value === true)
                        }
                      />
                      {option.label}
                    </label>
                  );
                })}
              </div>
            </Field>
            <div className="space-y-6">
              <Field label="Maximum one-way time">
                <div className="relative">
                  <Input
                    type="number"
                    min={5}
                    max={180}
                    value={settings.commute.targetMinutes}
                    onChange={(event) => {
                      setSettings((current) => ({
                        ...current,
                        commute: {
                          ...current.commute,
                          targetMinutes: Number(event.target.value),
                        },
                      }));
                    }}
                    className="h-10 rounded-xl pr-16"
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
                    minutes
                  </span>
                </div>
              </Field>
              <Field label="Arrival times (averaged)">
                <div className="space-y-3">
                  {settings.commute.arrivalTimes.map((arrivalTime, index) => (
                    <div key={index} className="flex items-center gap-1">
                      <Input
                        type="time"
                        value={arrivalTime}
                        onChange={(event) =>
                          setArrivalTime(index, event.target.value)
                        }
                        aria-label={`Arrival time ${index + 1}`}
                        className="h-10 rounded-xl"
                      />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="rounded-full text-muted-foreground hover:text-destructive"
                        onClick={() => removeArrivalTime(index)}
                        disabled={settings.commute.arrivalTimes.length === 1}
                        aria-label={`Remove arrival time ${index + 1}`}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  ))}
                  <Button
                    variant="secondary"
                    size="sm"
                    className="rounded-full"
                    onClick={addArrivalTime}
                    disabled={settings.commute.arrivalTimes.length >= 4}
                  >
                    <Plus data-icon="inline-start" /> Add time
                  </Button>
                </div>
              </Field>
            </div>
          </div>
        </div>
      );
    }

    return null;
  }

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
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-4 sm:px-7">
          <Link
            href={`/${boardId}`}
            className="flex items-center gap-2.5 font-medium tracking-[-0.02em]"
          >
            <span className="grid size-8 place-items-center rounded-[10px] bg-foreground text-background">
              <HouseIcon className="size-4" aria-hidden="true" />
            </span>
            House ranker
          </Link>
          <div className="flex items-center gap-2">
            {syncStatus === 'error' && (
              <span className="hidden items-center gap-1.5 text-xs text-destructive sm:inline-flex">
                <Cloud className="size-3.5" aria-hidden="true" />
                Sync issue
              </span>
            )}
            <Button
              className="rounded-full"
              render={<Link href={`/${boardId}`} />}
            >
              <ArrowLeft data-icon="inline-start" /> Homes
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-7 sm:py-11">
        <div className="mb-8 max-w-2xl">
          <p className="text-xs font-medium uppercase tracking-[0.11em] text-primary">
            Setup
          </p>
          <h1 className="mt-2 text-3xl font-medium tracking-[-0.045em] sm:text-4xl">
            What matters to you?
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Set your priorities once. Must-haves carry the most weight and flag
            a house when its grade falls below 3. Every house is graded and
            ranked against the same choices.
          </p>
        </div>

        <div className="space-y-5">
          <section className="overflow-hidden rounded-[22px] border border-border/80 bg-card shadow-[0_16px_45px_rgb(0_0_0/0.04)]">
            <div className="overflow-x-auto">
              <div
                style={{ minWidth: Math.max(640, 440 + people.length * 160) }}
              >
                <div
                  className="grid items-center border-b px-5 py-3 text-xs font-medium text-muted-foreground"
                  style={{
                    gridTemplateColumns: `minmax(260px, 1fr) repeat(${people.length}, 160px) 140px`,
                  }}
                >
                  <span>Priority</span>
                  {people.map((person) => (
                    <span key={person.id} className="flex items-center gap-1">
                      <span className="truncate">{person.name}</span>
                      {people.length > 1 && (
                        <button
                          type="button"
                          className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                          onClick={() => removePerson(person.id)}
                          aria-label={`Remove ${person.name}`}
                        >
                          <X className="size-3" aria-hidden="true" />
                        </button>
                      )}
                    </span>
                  ))}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="justify-self-end rounded-full"
                    onClick={addPerson}
                    disabled={people.length >= 5}
                    aria-label={
                      people.length >= 5
                        ? 'Maximum of 5 people reached'
                        : 'Add person'
                    }
                    title={
                      people.length >= 5
                        ? 'Maximum of 5 people reached'
                        : 'Add person'
                    }
                  >
                    <Plus data-icon="inline-start" />
                    Add person
                  </Button>
                </div>
                {settings.criteria.map((criterion) => (
                  <div
                    key={criterion.id}
                    className="grid items-center border-b px-5 py-3"
                    style={{
                      gridTemplateColumns: `minmax(260px, 1fr) repeat(${people.length}, 160px) 140px`,
                    }}
                  >
                    <div className="min-w-0 pr-4">
                      <div className="text-sm font-medium">
                        {criterion.label}
                      </div>
                      {computedCriterionIds.has(criterion.id) ? (
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                          {criterion.autoNote}
                        </p>
                      ) : (
                        <button
                          type="button"
                          className="mt-1 flex max-w-full items-start gap-2 rounded-md text-left text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-expanded={expandedCriterionId === criterion.id}
                          onClick={() =>
                            setExpandedCriterionId((current) =>
                              current === criterion.id ? null : criterion.id,
                            )
                          }
                        >
                          <WandSparkles
                            className="mt-[3px] size-3.5 shrink-0"
                            aria-hidden="true"
                          />
                          <span className="line-clamp-2 min-w-0 leading-5">
                            {criterion.assessmentPrompt?.trim() ||
                              (criterion.guidanceMode === 'auto'
                                ? 'Generate guidance'
                                : 'Add guidance')}
                          </span>
                        </button>
                      )}
                    </div>
                    {people.map((person) => (
                      <PriorityScale
                        key={person.id}
                        value={criterionPriority(criterion, person.id)}
                        onChange={(value) =>
                          setPriority(criterion.id, person.id, value)
                        }
                      />
                    ))}
                    {computedCriterionIds.has(criterion.id) ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="justify-self-end rounded-full text-muted-foreground"
                        onClick={() =>
                          setExpandedCriterionId((current) =>
                            current === criterion.id ? null : criterion.id,
                          )
                        }
                        aria-expanded={expandedCriterionId === criterion.id}
                        aria-controls={`settings-${criterion.id}`}
                      >
                        Configure
                        <ChevronDown
                          className={`transition-transform ${expandedCriterionId === criterion.id ? 'rotate-180' : ''}`}
                          aria-hidden="true"
                        />
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="justify-self-end rounded-full text-muted-foreground hover:text-destructive"
                        onClick={() =>
                          removeCriterion(criterion.id, criterion.label)
                        }
                        aria-label={`Delete ${criterion.label}`}
                        title={`Delete ${criterion.label}`}
                      >
                        <Trash2 />
                      </Button>
                    )}
                    {computedCriterionIds.has(criterion.id) &&
                      expandedCriterionId === criterion.id && (
                        <div
                          id={`settings-${criterion.id}`}
                          className="mt-3 border-t pt-4 pb-1"
                          style={{ gridColumn: '1 / -1' }}
                        >
                          {renderComputedSettings(criterion.id)}
                        </div>
                      )}
                    {!computedCriterionIds.has(criterion.id) &&
                      expandedCriterionId === criterion.id && (
                        <div
                          className="mt-3 rounded-2xl bg-secondary/55 p-3.5"
                          style={{ gridColumn: '1 / -1' }}
                        >
                          <label
                            className="text-xs font-medium text-muted-foreground"
                            htmlFor={`assessment-${criterion.id}`}
                          >
                            What should the AI look for?
                          </label>
                          <Textarea
                            id={`assessment-${criterion.id}`}
                            className="mt-3 min-h-24 resize-y rounded-xl bg-background"
                            value={criterion.assessmentPrompt ?? ''}
                            onChange={(event) =>
                              setAssessmentPrompt(
                                criterion.id,
                                event.target.value,
                              )
                            }
                            placeholder={`Describe what earns a 5/5 for “${criterion.label},” what is acceptable, and any deal-breakers. Example: “Fits an 8-person sectional with clear walking paths and at least one uninterrupted TV wall.”`}
                          />
                        </div>
                      )}
                  </div>
                ))}
                <div className="px-5 py-4">
                  {addingCriterion ? (
                    <div className="rounded-2xl bg-secondary/55 p-4">
                      <Input
                        className="h-10 rounded-xl bg-background"
                        value={newCriterionName}
                        onChange={(event) =>
                          setNewCriterionName(event.target.value)
                        }
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            if (newCriterionGuidance.trim()) addCriterion();
                            else void generateNewCriterionGuidance();
                          }
                          if (event.key === 'Escape') cancelAddCriterion();
                        }}
                        placeholder="Priority name"
                        aria-label="New priority name"
                      />
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          className="rounded-full"
                          onClick={() => void generateNewCriterionGuidance()}
                          disabled={
                            generatingGuidance || !newCriterionName.trim()
                          }
                        >
                          <WandSparkles data-icon="inline-start" />
                          {generatingGuidance
                            ? 'Generating…'
                            : newCriterionGuidance.trim()
                              ? 'Regenerate guidance'
                              : 'Generate guidance'}
                        </Button>
                        {newCriterionGuidance.trim() && (
                          <span className="text-xs text-muted-foreground">
                            Review and edit before creating.
                          </span>
                        )}
                      </div>
                      {newCriterionGuidance.trim() && (
                        <Textarea
                          className="mt-3 min-h-24 resize-y rounded-xl bg-background"
                          value={newCriterionGuidance}
                          onChange={(event) =>
                            setNewCriterionGuidance(event.target.value)
                          }
                          placeholder="Describe what a 5/5 looks like, what is acceptable, and any deal-breakers."
                          aria-label="LLM guidance"
                        />
                      )}
                      {newCriterionError && (
                        <p
                          className="mt-3 text-xs text-destructive"
                          role="alert"
                        >
                          {newCriterionError}
                        </p>
                      )}
                      <div className="mt-4 flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="rounded-full"
                          onClick={cancelAddCriterion}
                          disabled={generatingGuidance}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          className="rounded-full"
                          onClick={addCriterion}
                          disabled={
                            generatingGuidance ||
                            !newCriterionName.trim() ||
                            !newCriterionGuidance.trim()
                          }
                        >
                          Create
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      variant="secondary"
                      className="rounded-full"
                      onClick={() => setAddingCriterion(true)}
                    >
                      <Plus data-icon="inline-start" /> Add priority
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

type AddressSuggestion = { placeId: string; description: string };

function AddressAutocomplete({
  value,
  onChange,
  placeholder,
  'aria-label': ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  'aria-label': string;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);

  useEffect(() => {
    const query = value.trim();
    if (!open || query.length < 3) return;

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError('');
      void fetch('/api/address-autocomplete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: query }),
        signal: controller.signal,
      })
        .then(async (result) => {
          const data = await readJsonResponse<{
            suggestions?: AddressSuggestion[];
            error?: string;
          }>(result);
          if (!result.ok) {
            throw new Error(data.error || 'Suggestions unavailable');
          }
          setSuggestions(data.suggestions ?? []);
          setActiveIndex(-1);
        })
        .catch((requestError: unknown) => {
          if (
            requestError instanceof DOMException &&
            requestError.name === 'AbortError'
          ) {
            return;
          }
          setSuggestions([]);
          setError(
            requestError instanceof Error
              ? requestError.message
              : 'Suggestions unavailable',
          );
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 300);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, value]);

  function selectSuggestion(suggestion: AddressSuggestion) {
    onChange(suggestion.description);
    setSuggestions([]);
    setActiveIndex(-1);
    setOpen(false);
  }

  return (
    <div className="relative min-w-0 flex-1">
      <Input
        value={value}
        onChange={(event) => {
          const nextValue = event.target.value;
          onChange(nextValue);
          setOpen(true);
          setError('');
          setActiveIndex(-1);
          if (nextValue.trim().length < 3) setSuggestions([]);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (!suggestions.length) return;
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
            setActiveIndex((current) =>
              current >= suggestions.length - 1 ? 0 : current + 1,
            );
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
            setActiveIndex((current) =>
              current <= 0 ? suggestions.length - 1 : current - 1,
            );
          } else if (event.key === 'Enter' && activeIndex >= 0) {
            event.preventDefault();
            selectSuggestion(suggestions[activeIndex]);
          } else if (event.key === 'Escape') {
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={open && suggestions.length > 0}
        aria-controls={listId}
        aria-activedescendant={
          activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined
        }
        autoComplete="off"
        className="h-10 rounded-xl"
      />

      {open && (loading || suggestions.length > 0 || error) && (
        <ul
          id={listId}
          className="absolute top-full right-0 left-0 z-40 mt-1 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg"
        >
          {loading && suggestions.length === 0 && (
            <li className="px-3 py-2.5 text-xs text-muted-foreground">
              Finding addresses…
            </li>
          )}
          {suggestions.map((suggestion, index) => (
            <li key={suggestion.placeId}>
              <button
                id={`${listId}-${index}`}
                type="button"
                className={`block w-full border-b border-border/60 px-3 py-2.5 text-left text-sm last:border-b-0 hover:bg-secondary focus-visible:bg-secondary focus-visible:outline-none ${activeIndex === index ? 'bg-secondary' : ''}`}
                onPointerDown={(event) => {
                  event.preventDefault();
                  selectSuggestion(suggestion);
                }}
              >
                {suggestion.description}
              </button>
            </li>
          ))}
          {error && (
            <li className="px-3 py-2.5 text-xs text-destructive">{error}</li>
          )}
          <li className="border-t border-border/60 px-3 py-1.5 text-right text-[10px] text-muted-foreground">
            Powered by Google
          </li>
        </ul>
      )}
    </div>
  );
}

function PriorityScale({
  value,
  onChange,
}: {
  value: Priority;
  onChange: (value: Priority) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLFieldSetElement>(null);
  const selectedOption =
    priorityOptions.find((option) => option.value === value) ??
    priorityOptions[2];
  const SelectedIcon = selectedOption.icon;

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  function selectedClass(priority: Priority) {
    return priority === 'must'
      ? 'bg-emerald-100 text-emerald-700 shadow-sm dark:bg-emerald-950 dark:text-emerald-300'
      : priority === 'nice'
        ? 'bg-amber-100 text-amber-700 shadow-sm dark:bg-amber-950 dark:text-amber-300'
        : 'bg-background text-foreground shadow-sm';
  }

  return (
    <fieldset
      ref={containerRef}
      className="relative h-10 w-[76px]"
      aria-label="Priority"
    >
      <button
        type="button"
        className={`flex h-10 w-[76px] flex-col items-center justify-center gap-0.5 rounded-xl text-[9px] leading-none font-medium whitespace-nowrap transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selectedClass(value)}`}
        aria-label={`${selectedOption.label}. Click to change.`}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <SelectedIcon className="size-3.5" aria-hidden="true" />
        {selectedOption.shortLabel}
      </button>
      {open && (
        <div className="absolute top-0 left-1/2 z-20 grid w-[230px] -translate-x-1/2 grid-cols-3 gap-1 rounded-xl bg-secondary p-1 shadow-lg ring-1 ring-foreground/10">
          {priorityOptions.map((option) => {
            const selected = value === option.value;
            const Icon = option.icon;
            return (
              <button
                key={option.value}
                type="button"
                className={`flex h-10 flex-col items-center justify-center gap-0.5 rounded-lg text-[9px] leading-none font-medium whitespace-nowrap transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? selectedClass(option.value) : 'text-muted-foreground hover:bg-background/65 hover:text-foreground'}`}
                aria-pressed={selected}
                aria-label={option.label}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <Icon className="size-3.5" aria-hidden="true" />
                {option.shortLabel}
              </button>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}

function CurrencyField({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-3 block px-1 text-xs font-medium text-muted-foreground">
        {label}
      </span>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
          $
        </span>
        <Input
          inputMode="numeric"
          placeholder={placeholder}
          value={value ? value.toLocaleString('en-US') : ''}
          onChange={(event) => {
            const digits = event.target.value.replace(/\D/g, '');
            onChange(digits ? Number(digits) : 0);
          }}
          className="h-10 rounded-xl pl-7 tabular-nums"
        />
      </div>
    </label>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="block space-y-3 text-xs font-medium text-muted-foreground">
      <span>{label}</span>
      {children}
    </div>
  );
}
