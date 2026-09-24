import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';

import { db } from '@/lib/firebase';
import type { House, HouseRankerSettings } from '@/lib/house-ranker';

const COLLECTION_NAME = 'house-rankers';
const HOUSES_COLLECTION_NAME = 'houses';
const BOARD_ID_PATTERN = /^[a-zA-Z0-9_-]{6,64}$/;
const STORAGE_VERSION = 2;

export type HouseRankerBoard = {
  houses: House[];
  settings: HouseRankerSettings;
  hiddenHouseIds?: string[];
  storageVersion?: number;
  regrade?: {
    settingsKey: string;
    criterionIds?: string[];
    removedCriterionIds?: string[];
    status: 'running' | 'complete' | 'partial' | 'failed';
    pendingHouseIds: string[];
    failedHouseIds?: string[];
    startedAt: number;
    completedAt?: number;
  };
};

type StoredHouse = House & { position: number };

const houseSnapshots = new Map<string, Map<string, string>>();
const boardWriteQueues = new Map<string, Promise<void>>();

function assertBoardId(boardId: string) {
  if (!BOARD_ID_PATTERN.test(boardId)) throw new Error('Invalid board ID');
}

function getBoardDocument(boardId: string) {
  assertBoardId(boardId);
  return doc(collection(db, COLLECTION_NAME), boardId);
}

function getHousesCollection(boardId: string) {
  return collection(getBoardDocument(boardId), HOUSES_COLLECTION_NAME);
}

function getHouseDocument(boardId: string, houseId: string) {
  return doc(getHousesCollection(boardId), houseId);
}

function withoutUndefined<T>(data: T): T {
  return JSON.parse(JSON.stringify(data)) as T;
}

function storedHouse(house: House, position: number): StoredHouse {
  return { ...withoutUndefined(house), position };
}

function readStoredHouse(data: StoredHouse): House {
  const { position: _position, ...house } = data;
  return house;
}

function queueBoardWrite(boardId: string, operation: () => Promise<void>) {
  const previous = boardWriteQueues.get(boardId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  boardWriteQueues.set(boardId, next);
  return next.finally(() => {
    if (boardWriteQueues.get(boardId) === next)
      boardWriteQueues.delete(boardId);
  });
}

async function syncHouseDocuments(boardId: string, houses: House[]) {
  const previous = houseSnapshots.get(boardId) ?? new Map<string, string>();
  const next = new Map<string, string>();
  const writes: Promise<void>[] = [];

  houses.forEach((house, position) => {
    const value = storedHouse(house, position);
    const serialized = JSON.stringify(value);
    next.set(house.id, serialized);
    if (previous.get(house.id) !== serialized) {
      writes.push(setDoc(getHouseDocument(boardId, house.id), value));
    }
  });
  for (const houseId of previous.keys()) {
    if (!next.has(houseId)) {
      writes.push(deleteDoc(getHouseDocument(boardId, houseId)));
    }
  }

  await Promise.all(writes);
  houseSnapshots.set(boardId, next);
}

async function writeBoardMetadata(
  boardId: string,
  data: Omit<HouseRankerBoard, 'houses'>,
) {
  await setDoc(
    getBoardDocument(boardId),
    {
      ...withoutUndefined(data),
      storageVersion: STORAGE_VERSION,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export function setBoardState(boardId: string, data: HouseRankerBoard) {
  return queueBoardWrite(boardId, async () => {
    const { houses, ...metadata } = data;
    await syncHouseDocuments(boardId, houses);
    await writeBoardMetadata(boardId, metadata);
  });
}

export function mergeBoardState(
  boardId: string,
  data: Partial<HouseRankerBoard>,
) {
  return queueBoardWrite(boardId, async () => {
    const { houses, ...metadata } = data;
    if (houses) await syncHouseDocuments(boardId, houses);
    await setDoc(
      getBoardDocument(boardId),
      {
        ...withoutUndefined(metadata),
        storageVersion: STORAGE_VERSION,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  });
}

export async function getBoardState(boardId: string) {
  const [snapshot, houseSnapshot] = await Promise.all([
    getDoc(getBoardDocument(boardId)),
    getDocs(query(getHousesCollection(boardId), orderBy('position'))),
  ]);
  if (!snapshot.exists()) return undefined;

  const data = snapshot.data() as Omit<HouseRankerBoard, 'houses'>;
  const houses = houseSnapshot.docs.map((item) =>
    readStoredHouse(item.data() as StoredHouse),
  );
  houseSnapshots.set(
    boardId,
    new Map(
      houses.map((house, position) => [
        house.id,
        JSON.stringify(storedHouse(house, position)),
      ]),
    ),
  );
  return { ...data, houses, storageVersion: STORAGE_VERSION };
}

export function subscribeToBoardState(
  boardId: string,
  onData: (data: HouseRankerBoard | undefined, exists: boolean) => void,
  onError?: (error: Error) => void,
) {
  let boardReady = false;
  let housesReady = false;
  let boardExists = false;
  let boardData: Omit<HouseRankerBoard, 'houses'> | undefined;
  let houses: House[] = [];

  const emit = () => {
    if (!boardReady || !housesReady) return;
    if (!boardExists && !houses.length) {
      onData(undefined, false);
      return;
    }
    onData(
      boardData
        ? {
            ...boardData,
            houses,
            storageVersion: STORAGE_VERSION,
          }
        : undefined,
      boardExists,
    );
  };

  const unsubscribeBoard = onSnapshot(
    getBoardDocument(boardId),
    (snapshot) => {
      boardExists = snapshot.exists();
      boardData = snapshot.exists()
        ? (snapshot.data() as Omit<HouseRankerBoard, 'houses'>)
        : undefined;
      boardReady = true;
      emit();
    },
    onError,
  );

  const unsubscribeHouses = onSnapshot(
    query(getHousesCollection(boardId), orderBy('position')),
    (snapshot) => {
      houses = snapshot.docs.map((item) =>
        readStoredHouse(item.data() as StoredHouse),
      );
      houseSnapshots.set(
        boardId,
        new Map(
          houses.map((house, position) => [
            house.id,
            JSON.stringify(storedHouse(house, position)),
          ]),
        ),
      );
      housesReady = true;
      emit();
    },
    onError,
  );

  return () => {
    unsubscribeBoard();
    unsubscribeHouses();
  };
}
