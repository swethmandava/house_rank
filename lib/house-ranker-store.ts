import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';

import { db } from '@/lib/firebase';
import type { House, HouseRankerSettings } from '@/lib/house-ranker';

const COLLECTION_NAME = 'games';
const BOARD_ID_PATTERN = /^[a-zA-Z0-9_-]{6,64}$/;

export type HouseRankerBoard = {
  houses: House[];
  settings: HouseRankerSettings;
  hiddenHouseIds?: string[];
};

function getBoardDocument(boardId: string) {
  if (!BOARD_ID_PATTERN.test(boardId)) {
    throw new Error('Invalid board ID');
  }
  return doc(collection(db, COLLECTION_NAME), `house-ranker-${boardId}`);
}

function withoutUndefined<T>(data: T): T {
  return JSON.parse(JSON.stringify(data)) as T;
}

export function setBoardState(boardId: string, data: HouseRankerBoard) {
  return setDoc(getBoardDocument(boardId), {
    ...withoutUndefined(data),
    updatedAt: serverTimestamp(),
  });
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

export function subscribeToBoardState(
  boardId: string,
  onData: (data: HouseRankerBoard | undefined, exists: boolean) => void,
  onError?: (error: Error) => void,
) {
  return onSnapshot(
    getBoardDocument(boardId),
    (snapshot) => {
      onData(
        snapshot.data() as HouseRankerBoard | undefined,
        snapshot.exists(),
      );
    },
    onError,
  );
}
