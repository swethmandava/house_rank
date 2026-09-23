import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeSettings,
  scoreTravelTime,
  sortCriteriaByImportance,
} from './house-ranker.ts';

const people = [
  { id: 'person-1', name: 'One' },
  { id: 'person-2', name: 'Two' },
];

function criterion(id, priorities) {
  return {
    id,
    label: id,
    group: 'Nice-to-haves',
    priorities,
    autoNote: '',
  };
}

test('orders priorities by must-have count and keeps ties stable', () => {
  const criteria = [
    criterion('one-must-first', { 'person-1': 'must', 'person-2': 'nice' }),
    criterion('two-musts', { 'person-1': 'must', 'person-2': 'must' }),
    criterion('one-must-second', { 'person-1': 'nice', 'person-2': 'must' }),
    criterion('two-nice', { 'person-1': 'nice', 'person-2': 'nice' }),
  ];

  assert.deepEqual(
    sortCriteriaByImportance(criteria, people).map((item) => item.id),
    ['two-musts', 'one-must-first', 'one-must-second', 'two-nice'],
  );
  assert.deepEqual(
    criteria.map((item) => item.id),
    ['one-must-first', 'two-musts', 'one-must-second', 'two-nice'],
  );
});

test('normalizing saved settings preserves the saved priority order', () => {
  const saved = normalizeSettings();
  saved.criteria = [...saved.criteria].reverse();

  assert.deepEqual(
    normalizeSettings(saved).criteria.map((item) => item.id),
    saved.criteria.map((item) => item.id),
  );
});

test('scores travel time relative to the configured limit', () => {
  assert.equal(scoreTravelTime(0, 20), 5);
  assert.equal(scoreTravelTime(10, 20), 4);
  assert.equal(scoreTravelTime(20, 20), 3);
  assert.equal(scoreTravelTime(30, 20), 2);
  assert.equal(scoreTravelTime(50, 20), 0);
});
