import { handleAutoGradeRequest } from '@/api/auto-grade';
import {
  applyAutoGradeResult,
  type AutoGradeResponse,
} from '@/lib/auto-grade-result';
import {
  buildSubjectiveAssessmentCriteria,
  gradingSettingsKey,
  invalidateAutoGrades,
  normalizeSettings,
  removeHouseCriteria,
} from '@/lib/house-ranker';
import {
  getServerBoardState,
  mergeServerBoardState,
} from '@/lib/house-ranker-server-store';

const RUNNING_JOB_TIMEOUT_MS = 15 * 60 * 1000;

export async function POST(request: Request) {
  let body: {
    boardId?: unknown;
    settingsKey?: unknown;
    timezoneOffset?: unknown;
    criterionIds?: unknown;
    removedCriterionIds?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: 'Invalid JSON request' }, { status: 400 });
  }
  if (
    typeof body.boardId !== 'string' ||
    typeof body.settingsKey !== 'string'
  ) {
    return Response.json(
      { error: 'A board ID and settings key are required' },
      { status: 400 },
    );
  }

  try {
    const board = await getServerBoardState(body.boardId);
    if (!board) {
      return Response.json({ error: 'Board not found' }, { status: 404 });
    }
    const settings = normalizeSettings(board.settings);
    const settingsKey = gradingSettingsKey(settings);
    if (settingsKey !== body.settingsKey) {
      return Response.json({ status: 'superseded' }, { status: 409 });
    }
    const currentCriterionIds = new Set(
      settings.criteria.map((criterion) => criterion.id),
    );
    const requestedCriterionIds = Array.isArray(body.criterionIds)
      ? body.criterionIds.filter(
          (criterionId): criterionId is string =>
            typeof criterionId === 'string' &&
            criterionId !== 'budget' &&
            currentCriterionIds.has(criterionId),
        )
      : [];
    const removedCriterionIds = Array.isArray(body.removedCriterionIds)
      ? body.removedCriterionIds.filter(
          (criterionId): criterionId is string =>
            typeof criterionId === 'string' &&
            !currentCriterionIds.has(criterionId),
        )
      : [];
    const interruptedCriterionIds =
      board.regrade?.status === 'running'
        ? (board.regrade.criterionIds ?? [])
        : [];
    const criterionIds = [
      ...new Set([...interruptedCriterionIds, ...requestedCriterionIds]),
    ].filter((criterionId) => currentCriterionIds.has(criterionId));

    if (
      board.regrade?.status === 'running' &&
      board.regrade.settingsKey === settingsKey &&
      criterionIds.every((criterionId) =>
        board.regrade?.criterionIds?.includes(criterionId),
      ) &&
      Date.now() - board.regrade.startedAt < RUNNING_JOB_TIMEOUT_MS
    ) {
      return Response.json({ status: 'already-running' }, { status: 202 });
    }

    const houses = board.houses;
    const invalidatedHouses = houses.map((house) =>
      removeHouseCriteria(
        invalidateAutoGrades(house, criterionIds),
        removedCriterionIds,
      ),
    );
    const startedAt = Date.now();
    await mergeServerBoardState(body.boardId, {
      houses: invalidatedHouses,
      regrade: {
        settingsKey,
        criterionIds,
        removedCriterionIds,
        status: 'running',
        pendingHouseIds: criterionIds.length
          ? houses.map((house) => house.id)
          : [],
        startedAt,
      },
    });

    const targetCriterionIds = new Set(criterionIds);
    const subjectiveCriteria = buildSubjectiveAssessmentCriteria(
      settings.criteria,
    ).filter((criterion) => targetCriterionIds.has(criterion.id));
    const timezoneOffset =
      typeof body.timezoneOffset === 'number' ? body.timezoneOffset : 0;
    let persistQueue = Promise.resolve();

    const persistHouseResult = (
      houseId: string,
      grade: AutoGradeResponse | undefined,
    ) => {
      const operation = persistQueue.then(async () => {
        const latestBoard = await getServerBoardState(body.boardId as string);
        if (
          !latestBoard ||
          gradingSettingsKey(normalizeSettings(latestBoard.settings)) !==
            settingsKey ||
          latestBoard.regrade?.settingsKey !== settingsKey ||
          latestBoard.regrade.startedAt !== startedAt
        ) {
          return;
        }

        const pendingHouseIds = latestBoard.regrade.pendingHouseIds.filter(
          (pendingHouseId) => pendingHouseId !== houseId,
        );
        const previousFailures = latestBoard.regrade.failedHouseIds ?? [];
        const failedHouseIds = grade
          ? previousFailures.filter(
              (failedHouseId) => failedHouseId !== houseId,
            )
          : [...new Set([...previousFailures, houseId])];
        const status = pendingHouseIds.length
          ? ('running' as const)
          : failedHouseIds.length
            ? ('partial' as const)
            : ('complete' as const);

        await mergeServerBoardState(body.boardId as string, {
          houses: grade
            ? latestBoard.houses.map((house) =>
                house.id === houseId
                  ? applyAutoGradeResult(house, grade, settings, criterionIds)
                  : house,
              )
            : latestBoard.houses,
          regrade: {
            settingsKey,
            criterionIds,
            removedCriterionIds,
            status,
            pendingHouseIds,
            failedHouseIds,
            startedAt,
            ...(status === 'running' ? {} : { completedAt: Date.now() }),
          },
        });
      });
      persistQueue = operation.catch(() => undefined);
      return operation;
    };

    if (!houses.length || !criterionIds.length) {
      await mergeServerBoardState(body.boardId, {
        regrade: {
          settingsKey,
          criterionIds,
          removedCriterionIds,
          status: 'complete',
          pendingHouseIds: [],
          failedHouseIds: [],
          startedAt,
          completedAt: Date.now(),
        },
      });
      return Response.json({ status: 'complete' });
    }

    const results = await Promise.allSettled(
      houses.map(async (house) => {
        let grade: AutoGradeResponse | undefined;
        try {
          const result = await handleAutoGradeRequest({
            houseAddress: house.name,
            listingUrl: house.listingUrl,
            notes: house.notes,
            commute: settings.commute,
            walkability: settings.walkability,
            schools: settings.schools,
            subjectiveCriteria,
            requestedCriterionIds: criterionIds,
            timeZoneOffsetMinutes: timezoneOffset,
          });
          grade = result.body as AutoGradeResponse;
          if (result.status !== 200 || grade.error) {
            throw new Error(grade.error || 'Automatic grading failed');
          }
        } catch {
          grade = undefined;
        }
        await persistHouseResult(house.id, grade);
      }),
    );
    const writeFailure = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (writeFailure) throw writeFailure.reason;

    const latestBoard = await getServerBoardState(body.boardId);
    if (
      !latestBoard ||
      latestBoard.regrade?.settingsKey !== settingsKey ||
      latestBoard.regrade.startedAt !== startedAt
    ) {
      return Response.json({ status: 'superseded' }, { status: 202 });
    }
    return Response.json({ status: latestBoard.regrade.status });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Could not regrade this board';
    try {
      const board = await getServerBoardState(body.boardId);
      if (
        board?.regrade?.status === 'running' &&
        board.regrade.settingsKey === body.settingsKey
      ) {
        await mergeServerBoardState(body.boardId, {
          regrade: {
            ...board.regrade,
            status: 'failed',
            pendingHouseIds: [],
            failedHouseIds: board.regrade.pendingHouseIds,
            completedAt: Date.now(),
          },
        });
      }
    } catch {}
    return Response.json({ error: message }, { status: 500 });
  }
}
