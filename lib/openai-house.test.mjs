import assert from 'node:assert/strict';
import test from 'node:test';

process.env.OPENAI_API_KEY = 'test-key';

test('grades characteristics in parallel low-effort batches', async (context) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    const criteria = JSON.parse(body.input[1].content).criteria;
    return new Response(
      JSON.stringify({
        output_text: JSON.stringify({
          ratings: criteria.map((criterion) => ({
            criterionId: criterion.id,
            score: 4,
            rationale: 'Good evidence',
            evidence: ['Listing evidence'],
            confidence: 'medium',
            sources: [],
          })),
        }),
      }),
      { status: 200 },
    );
  };
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  const { rateHouseCharacteristics } = await import('./openai-house.ts');
  const criteria = Array.from({ length: 12 }, (_, index) => ({
    id: `criterion-${index}`,
    label: `Criterion ${index}`,
    requirements: 'Check the listing.',
    suggestedEvidence: 'Listing photos',
  }));
  const ratings = await rateHouseCharacteristics(
    { address: '123 Main Street' },
    criteria,
  );

  assert.equal(requests.length, 3);
  assert.equal(ratings.length, 12);
  assert.ok(requests.every((request) => request.reasoning.effort === 'low'));
  assert.ok(requests.every((request) => request.text.verbosity === 'low'));
  assert.ok(
    requests.every(
      (request) => request.prompt_cache_options.mode === 'explicit',
    ),
  );
  assert.ok(
    requests.every((request) => request.tools[0].search_context_size === 'low'),
  );
  assert.ok(
    requests.every((request) => {
      const instructions = request.input[0].content[0].text;
      return (
        instructions.includes('Score the most likely underlying quality') &&
        instructions.includes('Missing proof is not negative evidence') &&
        instructions.includes('never say the score was reduced because you were unsure')
      );
    }),
  );
});
