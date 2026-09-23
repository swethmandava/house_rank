import { handleAutoGradeRequest } from '@/api/auto-grade';

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON request' }, { status: 400 });
  }
  const result = await handleAutoGradeRequest(body);
  return Response.json(result.body, { status: result.status });
}
