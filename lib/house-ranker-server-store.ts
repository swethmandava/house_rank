import type { HouseRankerBoard } from '@/lib/house-ranker-store';

const FIREBASE_PROJECT_ID = 'dhama-3905d';
const COLLECTION_NAME = 'house-rankers';
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
  fields?: Record<string, FirestoreValue>;
};

function boardDocumentUrl(boardId: string) {
  if (!BOARD_ID_PATTERN.test(boardId)) throw new Error('Invalid board ID');
  return `${firestoreBaseUrl}/${COLLECTION_NAME}/${encodeURIComponent(boardId)}`;
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

export async function getServerBoardState(boardId: string) {
  const response = await fetch(boardDocumentUrl(boardId));
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error('Could not load the board');
  const document = (await response.json()) as FirestoreDocument;
  return Object.fromEntries(
    Object.entries(document.fields ?? {}).map(([key, value]) => [
      key,
      decodeFirestoreValue(value),
    ]),
  ) as HouseRankerBoard;
}

export async function mergeServerBoardState(
  boardId: string,
  data: Partial<HouseRankerBoard>,
) {
  const fields = Object.fromEntries(
    Object.entries(data)
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
