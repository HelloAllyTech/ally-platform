import {expect} from '@jest/globals';

/**
 * RTK Query's fetchBaseQuery calls `fetch(request: Request)` with one argument.
 * Tests that mock `global.fetch` should read URL, method, and body from it.
 */
export async function getFirstFetchFromMock(fetchMock: jest.Mock): Promise<{
  url: string;
  method: string;
  body: string | undefined;
}> {
  expect(fetchMock).toHaveBeenCalled();
  const [input] = fetchMock.mock.calls[0];
  expect(input).toBeInstanceOf(Request);
  const req = input as Request;
  let body: string | undefined;
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    const text = await req.clone().text();
    body = text.length > 0 ? text : undefined;
  }
  return {url: req.url, method: req.method, body};
}
