export async function readJsonResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return (await response.json()) as T;
  }

  const message = response.ok
    ? 'The server returned an unexpected response'
    : `Request failed (${response.status})`;
  throw new Error(message);
}
