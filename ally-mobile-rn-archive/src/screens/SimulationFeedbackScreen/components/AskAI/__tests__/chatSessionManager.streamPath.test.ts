import {destroySession, retry, sendMessage} from '../chatSessionManager';

/**
 * Ask Ally (the Debrief agent) answers the same thread as today's debrief
 * chat at its own stream path; the manager must post there when told to and
 * keep today's path otherwise.
 */

jest.mock('@/config/env', () => ({env: {API_BASE_URL: 'https://api.test'}}));
jest.mock('@/utils/asyncStorage', () => ({
  getItem: jest.fn(() => Promise.resolve('token')),
  setItem: jest.fn(),
}));
jest.mock('@/utils/logger', () => ({logger: {error: jest.fn()}}));

const opened: Array<{method: string; url: string; body?: string}> = [];

class MockXHR {
  responseText = '';
  status = 200;
  onprogress: (() => void) | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  private request: {method: string; url: string; body?: string} = {
    method: '',
    url: '',
  };
  open(method: string, url: string) {
    this.request = {method, url};
  }
  setRequestHeader() {}
  send(body: string) {
    opened.push({...this.request, body});
    this.responseText =
      'data: {"type":"start"}\n\n' +
      'data: {"type":"done","content":"Ally replied.","citations":[]}\n\n';
    this.onprogress?.();
  }
  abort() {}
}

const flush = () => new Promise(resolve => setImmediate(resolve));

describe('chatSessionManager — stream path', () => {
  const originalXHR = global.XMLHttpRequest;

  beforeAll(() => {
    (global as unknown as {XMLHttpRequest: unknown}).XMLHttpRequest = MockXHR;
  });

  afterAll(() => {
    global.XMLHttpRequest = originalXHR;
  });

  beforeEach(() => {
    opened.length = 0;
    destroySession('s-1');
  });

  it('posts to today’s chat stream by default', async () => {
    sendMessage('s-1', 'Hello');
    await flush();
    expect(opened).toEqual([
      {
        method: 'POST',
        url: 'https://api.test/api/v1/learn/scenario-sessions/s-1/chat/stream',
        body: JSON.stringify({message: 'Hello'}),
      },
    ]);
  });

  it('posts to the given path, and retries there too', async () => {
    const path = '/debriefs/sessions/s-1/reply/stream';
    sendMessage('s-1', 'Why was that hard?', path);
    await flush();
    retry('s-1', path);
    await flush();
    expect(opened.map(r => r.url)).toEqual([
      `https://api.test/api/v1${path}`,
      `https://api.test/api/v1${path}`,
    ]);
    expect(opened[0].body).toBe(
      JSON.stringify({message: 'Why was that hard?'}),
    );
  });
});
