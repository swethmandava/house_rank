import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decodeFirestoreValue,
  encodeFirestoreValue,
} from './house-ranker-server-store.ts';

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
