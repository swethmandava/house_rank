import type { House } from '@/lib/house-ranker';
import type { HouseRankerBoard } from '@/lib/house-ranker-store';

const FIREBASE_PROJECT_ID = 'dhama-3905d';
const COLLECTION_NAME = 'house-rankers';
const HOUSES_COLLECTION_NAME = 'houses';
const STORAGE_VERSION = 2;
const BOARD_ID_PATTERN = /^[a-zA-Z0-9_-]{6,64}$/;
const firestoreBaseUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

type FirestoreValue = {
  nullValue?: null;
  booleanValue?: boolean;
  integerValue?: string;
  doubleValue?: number;
  timestampValue?: string;
  stringValue?: string;
  arrayValue?: { values?: FirestoreValue[] };
  mapValue?: { fields?: Record<string, FirestoreValue> };
};

type FirestoreDocument = {
  name?: string;
  fields?: Record<string, FirestoreValue>;
};

type StoredHouse = House & { position: number };

function assertBoardId(boardId: string) {
  if (!BOARD_ID_PATTERN.test(boardId)) throw new Error('Invalid board ID');
}

function boardDocumentUrl(boardId: string) {
  assertBoardId(boardId);
  return `${firestoreBaseUrl}/${COLLECTION_NAME}/${encodeURIComponent(boardId)}`;
}

function housesCollectionUrl(boardId: string) {
  return `${boardDocumentUrl(boardId)}/${HOUSES_COLLECTION_NAME}`;
}

function houseDocumentUrl(boardId: string, houseId: string) {
  return `${housesCollectionUrl(boardId)}/${encodeURIComponent(houseId)}`;
}

function decodeDocument(document: FirestoreDocument) {
  return Object.fromEntries(
    Object.entries(document.fields ?? {}).map(([key, value]) => [
      key,
      decodeFirestoreValue(value),
    ]),
  );
}

function readStoredHouse(document: FirestoreDocument): StoredHouse {
  return decodeDocument(document) as StoredHouse;
}

export function encodeFirestoreValue(value: unknown): FirestoreValue {
  if (value === null) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (typeof value === 'string') return { stringValue: value };
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(encodeFirestoreValue) } };
  }
  if (typeof value === 'object' && value !== undefined) {
    const fields = Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, encodeFirestoreValue(item)]),
    );
    return { mapValue: { fields } };
  }
  throw new Error(`Unsupported Firestore value: ${typeof value}`);
}

export function decodeFirestoreValue(value: FirestoreValue): unknown {
  if ('nullValue' in value) return null;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('stringValue' in value) return value.stringValue;
  if ('arrayValue' in value) {
    return (value.arrayValue?.values ?? []).map(decodeFirestoreValue);
  }
  if ('mapValue' in value) {
    return Object.fromEntries(
      Object.entries(value.mapValue?.fields ?? {}).map(([key, item]) => [
        key,
        decodeFirestoreValue(item),
      ]),
    );
  }
  return undefined;
}

async function listServerHouses(boardId: string) {
  const houses: StoredHouse[] = [];
  let pageToken = '';

  do {
    const url = new URL(housesCollectionUrl(boardId));
    url.searchParams.set('pageSize', '1000');
    url.searchParams.set('orderBy', 'position');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await fetch(url);
    if (!response.ok) throw new Error('Could not load board houses');
    const page = (await response.json()) as {
      documents?: FirestoreDocument[];
      nextPageToken?: string;
    };
    houses.push(...(page.documents ?? []).map(readStoredHouse));
    pageToken = page.nextPageToken ?? '';
  } while (pageToken);

  return houses.sort((first, second) => first.position - second.position);
}

async function migrateServerHouses(boardId: string, houses: House[]) {
  await Promise.all(
    houses.map((house, position) =>
      setServerHouseState(boardId, house, position),
    ),
  );

  const fields = {
    storageVersion: encodeFirestoreValue(STORAGE_VERSION),
    updatedAt: { timestampValue: new Date().toISOString() },
  } satisfies Record<string, FirestoreValue>;
  const url = new URL(boardDocumentUrl(boardId));
  for (const fieldPath of ['storageVersion', 'updatedAt', 'houses']) {
    url.searchParams.append('updateMask.fieldPaths', fieldPath);
  }
  url.searchParams.set('currentDocument.exists', 'true');
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!response.ok) throw new Error('Could not finish board migration');
}

export async function getServerBoardState(boardId: string) {
  const [boardResponse, storedHouses] = await Promise.all([
    fetch(boardDocumentUrl(boardId)),
    listServerHouses(boardId),
  ]);
  if (boardResponse.status === 404) return undefined;
  if (!boardResponse.ok) throw new Error('Could not load the board');
  const document = (await boardResponse.json()) as FirestoreDocument;
  const data = decodeDocument(document) as HouseRankerBoard;
  const legacyHouses = Array.isArray(data.houses) ? data.houses : [];
  const houses = storedHouses.length
    ? storedHouses.map(({ position: _position, ...house }) => house)
    : legacyHouses;

  if (data.storageVersion !== STORAGE_VERSION && Array.isArray(data.houses)) {
    await migrateServerHouses(boardId, legacyHouses);
  }
  return { ...data, houses, storageVersion: STORAGE_VERSION };
}

export async function setServerHouseState(
  boardId: string,
  house: House,
  position: number,
) {
  const fields = Object.fromEntries(
    Object.entries({ ...house, position })
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, encodeFirestoreValue(value)]),
  );
  const response = await fetch(houseDocumentUrl(boardId, house.id), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!response.ok) throw new Error('Could not update the house');
}

export async function mergeServerBoardState(
  boardId: string,
  data: Partial<Omit<HouseRankerBoard, 'houses'>>,
) {
  const fields = Object.fromEntries(
    Object.entries({ ...data, storageVersion: STORAGE_VERSION })
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, encodeFirestoreValue(value)]),
  );
  fields.updatedAt = { timestampValue: new Date().toISOString() };

  const url = new URL(boardDocumentUrl(boardId));
  for (const fieldPath of Object.keys(fields)) {
    url.searchParams.append('updateMask.fieldPaths', fieldPath);
  }
  url.searchParams.set('currentDocument.exists', 'true');

  const response = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!response.ok) throw new Error('Could not update the board');
}
