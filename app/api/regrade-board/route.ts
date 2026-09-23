import { handleAutoGradeRequest } from '@/api/auto-grade';
import {
  applyAutoGradeResult,
  gradingSettingsKey,
  type AutoGradeResponse,
} from '@/lib/auto-grade-result';
import {
  buildSubjectiveAssessmentCriteria,
  invalidateAutoGrades,
  normalizeSettings,
} from '@/lib/house-ranker';
import { getBoardState, mergeBoardState } from '@/lib/house-ranker-store';

const RUNNING_JOB_TIMEOUT_MS = 15 * 60 * 1000;

export async function POST(request: Request) {
  let body: {
    boardId?: unknown;
    settingsKey?: unknown;
    timezoneOffset?: unknown;
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
    const board = await getBoardState(body.boardId);
    if (!board) {
      return Response.json({ error: 'Board not found' }, { status: 404 });
    }
    const settings = normalizeSettings(board.settings);
    const settingsKey = gradingSettingsKey(settings);
    if (settingsKey !== body.settingsKey) {
      return Response.json({ status: 'superseded' }, { status: 409 });
    }
    if (
      board.regrade?.status === 'running' &&
      board.regrade.settingsKey === settingsKey &&
      Date.now() - board.regrade.startedAt < RUNNING_JOB_TIMEOUT_MS
    ) {
      return Response.json({ status: 'already-running' }, { status: 202 });
    }

    const houses = board.houses;
    const invalidatedHouses = houses.map(invalidateAutoGrades);
    const startedAt = Date.now();
    await mergeBoardState(body.boardId, {
      houses: invalidatedHouses,
      regrade: {
        settingsKey,
        status: 'running',
        pendingHouseIds: houses.map((house) => house.id),
        startedAt,
      },
    });

    const subjectiveCriteria = buildSubjectiveAssessmentCriteria(
      settings.criteria,
    );
    const timezoneOffset =
      typeof body.timezoneOffset === 'number' ? body.timezoneOffset : 0;
    let persistQueue = Promise.resolve();

    const persistHouseResult = (
      houseId: string,
      grade: AutoGradeResponse | undefined,
    ) => {
      const operation = persistQueue.then(async () => {
        const latestBoard = await getBoardState(body.boardId as string);
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

        await mergeBoardState(body.boardId as string, {
          houses: grade
            ? latestBoard.houses.map((house) =>
                house.id === houseId
                  ? applyAutoGradeResult(house, grade, settings)
                  : house,
              )
            : latestBoard.houses,
          regrade: {
            settingsKey,
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

    if (!houses.length) {
      await mergeBoardState(body.boardId, {
        regrade: {
          settingsKey,
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

    const latestBoard = await getBoardState(body.boardId);
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
      const board = await getBoardState(body.boardId);
      if (
        board?.regrade?.status === 'running' &&
        board.regrade.settingsKey === body.settingsKey
      ) {
        await mergeBoardState(body.boardId, {
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
