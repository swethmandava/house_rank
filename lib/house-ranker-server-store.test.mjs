import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decodeFirestoreValue,
  encodeFirestoreValue,
  getServerBoardState,
} from './house-ranker-server-store.ts';

function firestoreDocument(value) {
  return {
    fields: Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        encodeFirestoreValue(item),
      ]),
    ),
  };
}

test('round trips board data through Firestore REST values', () => {
  const board = {
    houses: [
      {
        id: 'house-1',
        name: '123 Main Street',
        ratings: { view: { auto: 3.5, override: 4 } },
      },
    ],
    regrade: {
      settingsKey: 'settings',
      status: 'running',
      pendingHouseIds: ['house-1'],
      startedAt: 123,
    },
    hiddenHouseIds: [],
  };

  assert.deepEqual(decodeFirestoreValue(encodeFirestoreValue(board)), board);
});

test('loads houses from their board subcollection in position order', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    requests.push({ url, method: init?.method ?? 'GET' });
    if (url.includes('/houses?')) {
      return Response.json({
        documents: [
          firestoreDocument({
            id: 'second',
            name: 'Second',
            ratings: {},
            position: 1,
          }),
          firestoreDocument({
            id: 'first',
            name: 'First',
            ratings: {},
            position: 0,
          }),
        ],
      });
    }
    return Response.json(
      firestoreDocument({
        settings: {},
        storageVersion: 2,
      }),
    );
  };

  try {
    const board = await getServerBoardState('board-123');
    assert.deepEqual(
      board.houses.map((house) => house.id),
      ['first', 'second'],
    );
    assert.equal(
      requests.some((request) => request.method !== 'GET'),
      false,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('does not read houses from the board document', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const method = init?.method ?? 'GET';
    requests.push({ url, method, body: init?.body });
    if (url.includes('/houses?')) return Response.json({});
    return Response.json(
      firestoreDocument({
        houses: [{ id: 'legacy-house', name: 'Legacy house', ratings: {} }],
        settings: {},
      }),
    );
  };

  try {
    const board = await getServerBoardState('board-123');
    assert.deepEqual(board.houses, []);
    assert.equal(
      requests.some((request) => request.method !== 'GET'),
      false,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
