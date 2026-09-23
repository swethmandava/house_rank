import {
  generateCharacteristicGuidance,
  rateHouseCharacteristics,
  researchListing,
  type HouseRatingCriterion,
  type HouseResearchInput,
} from '../lib/openai-house';

type ApiResult = { status: number; body: unknown };

type GenerateGuidanceRequest = {
  action: 'generate_guidance';
  characteristic: string;
};

type RateCharacteristicRequest = {
  action: 'rate_characteristic';
  house: HouseResearchInput;
  criterion: HouseRatingCriterion;
};

type ResearchListingRequest = {
  action: 'research_listing';
  listingUrl: string;
};

export async function handleOpenAIRequest(body: unknown): Promise<ApiResult> {
  try {
    const input = body as
      | GenerateGuidanceRequest
      | RateCharacteristicRequest
      | ResearchListingRequest
      | undefined;
    if (input?.action === 'research_listing') {
      const listingUrl = input.listingUrl?.trim();
      if (!listingUrl || listingUrl.length > 1_000) {
        return {
          status: 400,
          body: { error: 'A valid listing link is required' },
        };
      }
      try {
        const url = new URL(listingUrl);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
      } catch {
        return {
          status: 400,
          body: { error: 'Enter a complete http or https listing link' },
        };
      }
      const research = await researchListing(listingUrl);
      return { status: 200, body: { research } };
    }

    if (input?.action === 'generate_guidance') {
      const characteristic = input.characteristic?.trim();
      if (!characteristic) {
        return {
          status: 400,
          body: { error: 'A characteristic name is required' },
        };
      }
      if (characteristic.length > 160) {
        return {
          status: 400,
          body: {
            error: 'Characteristic names must be 160 characters or less',
          },
        };
      }
      const guidance = await generateCharacteristicGuidance(characteristic);
      return { status: 200, body: { guidance } };
    }

    if (input?.action === 'rate_characteristic') {
      if (
        typeof input.house?.address !== 'string' ||
        !input.house.address.trim() ||
        typeof input.criterion?.id !== 'string' ||
        typeof input.criterion.label !== 'string' ||
        typeof input.criterion.requirements !== 'string' ||
        typeof input.criterion.suggestedEvidence !== 'string'
      ) {
        return {
          status: 400,
          body: { error: 'A house and criterion are required' },
        };
      }
      if (
        input.house.address.length > 300 ||
        input.criterion.requirements?.length > 2_000
      ) {
        return { status: 400, body: { error: 'Request is too large' } };
      }
      const ratings = await rateHouseCharacteristics(input.house, [
        input.criterion,
      ]);
      const rating = ratings[0];
      if (!rating) {
        return {
          status: 502,
          body: { error: 'OpenAI could not grade this characteristic' },
        };
      }
      return { status: 200, body: { rating } };
    }

    return { status: 400, body: { error: 'Unknown action' } };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'AI request failed';
    const status = message.includes('OPENAI_API_KEY') ? 503 : 502;
    return { status, body: { error: message } };
  }
}
