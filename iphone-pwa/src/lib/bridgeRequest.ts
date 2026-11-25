import type { DevDeckState } from '@/hooks/useDevDeckSocket';

export async function bridgeRequest<T>(
  deck: Pick<DevDeckState, 'bridgeBaseUrl' | 'pairing'>,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  if (!deck.bridgeBaseUrl || !deck.pairing?.token) throw Error('Pair your computer first');
  const res = await fetch(deck.bridgeBaseUrl + '/api/devsuite/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: 'Bearer ' + deck.pairing.token, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
    signal,
  });
  const data = await res.json();
  if (!res.ok || data.ok === false) throw Error(data.error || 'Bridge request failed');
  return data;
}
