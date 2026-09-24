import assert from 'node:assert/strict';
import test from 'node:test';
import {
  gradeImpact,
  gradingSettingsKey,
  normalizeSettings,
} from './house-ranker.ts';

test('priority-only changes do not trigger regrading', () => {
  const previous = normalizeSettings();
  const next = structuredClone(previous);
  next.criteria[1].priorities['person-1'] = 'must';

  assert.deepEqual(gradeImpact(previous, next), {
    criterionIds: [],
    removedCriterionIds: [],
  });
  assert.equal(gradingSettingsKey(previous), gradingSettingsKey(next));
});

test('visual criterion reordering does not trigger regrading', () => {
  const previous = normalizeSettings();
  const next = structuredClone(previous);
  next.criteria.reverse();

  assert.deepEqual(gradeImpact(previous, next), {
    criterionIds: [],
    removedCriterionIds: [],
  });
  assert.equal(gradingSettingsKey(previous), gradingSettingsKey(next));
});

test('a guidance edit regrades only that custom criterion', () => {
  const previous = normalizeSettings();
  const next = structuredClone(previous);
  const criterion = next.criteria.find((item) => item.id === 'neighborhood');
  criterion.assessmentPrompt = 'Use the updated safety guidance.';

  assert.deepEqual(gradeImpact(previous, next), {
    criterionIds: ['neighborhood'],
    removedCriterionIds: [],
  });
});

test('computed control changes only affect their matching grade', () => {
  const previous = normalizeSettings();
  const next = structuredClone(previous);
  next.walkability.targetMinutes = 10;

  assert.deepEqual(gradeImpact(previous, next), {
    criterionIds: ['walkable'],
    removedCriterionIds: [],
  });
});

test('adding and removing criteria produce focused changes', () => {
  const previous = normalizeSettings();
  const withAdded = structuredClone(previous);
  withAdded.criteria.push({
    id: 'view',
    label: 'View',
    group: 'Nice-to-haves',
    priorities: { 'person-1': 'nice' },
    autoNote: 'Listing photos',
    guidanceMode: 'manual',
    assessmentPrompt: 'Score the quality of the view.',
  });

  assert.deepEqual(gradeImpact(previous, withAdded), {
    criterionIds: ['view'],
    removedCriterionIds: [],
  });
  assert.deepEqual(gradeImpact(withAdded, previous), {
    criterionIds: [],
    removedCriterionIds: ['view'],
  });
});
