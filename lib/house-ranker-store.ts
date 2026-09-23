import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';

import { db } from '@/lib/firebase';
import type { House, HouseRankerSettings } from '@/lib/house-ranker';

const COLLECTION_NAME = 'house-rankers';
const LEGACY_COLLECTION_NAME = 'games';
const BOARD_ID_PATTERN = /^[a-zA-Z0-9_-]{6,64}$/;

export type HouseRankerBoard = {
  houses: House[];
  settings: HouseRankerSettings;
  hiddenHouseIds?: string[];
  regrade?: {
    settingsKey: string;
    status: 'running' | 'complete' | 'partial' | 'failed';
    pendingHouseIds: string[];
    failedHouseIds?: string[];
    startedAt: number;
    completedAt?: number;
  };
};

function getBoardDocument(boardId: string) {
  if (!BOARD_ID_PATTERN.test(boardId)) {
    throw new Error('Invalid board ID');
  }
  return doc(collection(db, COLLECTION_NAME), boardId);
}

function getLegacyBoardDocument(boardId: string) {
  return doc(collection(db, LEGACY_COLLECTION_NAME), `house-ranker-${boardId}`);
}

function withoutUndefined<T>(data: T): T {
  return JSON.parse(JSON.stringify(data)) as T;
}

export function setBoardState(boardId: string, data: HouseRankerBoard) {
  return setDoc(
    getBoardDocument(boardId),
    {
      ...withoutUndefined(data),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export function mergeBoardState(
  boardId: string,
  data: Partial<HouseRankerBoard>,
) {
  return setDoc(
    getBoardDocument(boardId),
    { ...withoutUndefined(data), updatedAt: serverTimestamp() },
    { merge: true },
  );
}

export async function getBoardState(boardId: string) {
  const snapshot = await getDoc(getBoardDocument(boardId));
  return snapshot.exists() ? (snapshot.data() as HouseRankerBoard) : undefined;
}

export function subscribeToBoardState(
  boardId: string,
  onData: (data: HouseRankerBoard | undefined, exists: boolean) => void,
  onError?: (error: Error) => void,
) {
  return onSnapshot(
    getBoardDocument(boardId),
    async (snapshot) => {
      if (snapshot.exists()) {
        onData(snapshot.data() as HouseRankerBoard, true);
        return;
      }

      try {
        const legacySnapshot = await getDoc(getLegacyBoardDocument(boardId));
        if (!legacySnapshot.exists()) {
          onData(undefined, false);
          return;
        }

        await setDoc(getBoardDocument(boardId), {
          ...withoutUndefined(legacySnapshot.data() as HouseRankerBoard),
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        onError?.(
          error instanceof Error ? error : new Error('Failed to load board'),
        );
      }
    },
    onError,
  );
}
