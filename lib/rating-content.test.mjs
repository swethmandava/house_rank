import assert from 'node:assert/strict';
import test from 'node:test';
import { ratingContent } from './rating-content.ts';

test('renders markdown citations as plain rationale text and safe sources', () => {
  const content = ratingContent(
    'Quiet streets ([Neighborhood guide](https://example.com/guide?utm_source=openai)).',
    [
      {
        title: 'Official neighborhood guide',
        url: 'https://example.com/guide?utm_source=openai',
      },
    ],
  );

  assert.equal(content.text, 'Quiet streets (Neighborhood guide).');
  assert.deepEqual(content.sources, [
    {
      title: 'Official neighborhood guide',
      url: 'https://example.com/guide',
    },
  ]);
});

test('drops non-http source links', () => {
  const content = ratingContent('No citation', [
    { title: 'Unsafe', url: 'javascript:alert(1)' },
  ]);

  assert.deepEqual(content, { text: 'No citation', sources: [] });
});
