import { handleAddressAutocompleteRequest } from '@/api/address-autocomplete';

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON request' }, { status: 400 });
  }
  const result = await handleAddressAutocompleteRequest(body);
  return Response.json(result.body, { status: result.status });
}
