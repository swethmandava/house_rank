type ApiResult = { status: number; body: unknown };

type GoogleAutocompleteResponse = {
  suggestions?: Array<{
    placePrediction?: {
      placeId?: string;
      text?: { text?: string };
    };
  }>;
  error?: { message?: string };
};

export async function handleAddressAutocompleteRequest(
  body: unknown,
): Promise<ApiResult> {
  const input =
    typeof (body as { input?: unknown } | undefined)?.input === 'string'
      ? (body as { input: string }).input.trim()
      : '';
  if (input.length < 3 || input.length > 200) {
    return {
      status: 400,
      body: { error: 'Enter at least 3 characters of an address' },
    };
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return {
      status: 503,
      body: { error: 'Address suggestions are not configured' },
    };
  }

  try {
    const result = await fetch(
      'https://places.googleapis.com/v1/places:autocomplete',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask':
            'suggestions.placePrediction.placeId,suggestions.placePrediction.text.text',
        },
        body: JSON.stringify({ input }),
      },
    );
    const data = (await result.json()) as GoogleAutocompleteResponse;
    if (!result.ok) {
      throw new Error(data.error?.message || 'Google Places request failed');
    }

    const suggestions = (data.suggestions ?? [])
      .flatMap((suggestion) => {
        const placeId = suggestion.placePrediction?.placeId?.trim();
        const description = suggestion.placePrediction?.text?.text?.trim();
        return placeId && description ? [{ placeId, description }] : [];
      })
      .slice(0, 5);

    return { status: 200, body: { suggestions } };
  } catch (error) {
    return {
      status: 502,
      body: {
        error:
          error instanceof Error
            ? error.message
            : 'Address suggestions are unavailable',
      },
    };
  }
}
