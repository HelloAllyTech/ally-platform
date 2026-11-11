import axios from 'axios';
import {
  DebriefAiClient,
  DebriefStepError,
  SAFETY_READER_TIMEOUT_MS,
} from '../service/debrief-ai.client';

jest.mock('axios');

describe('DebriefAiClient', () => {
  const client = new DebriefAiClient({
    ai: { apiUrl: 'http://ai', outboundApiKey: 'k' },
  } as any);
  const post = axios.post as jest.Mock;

  beforeEach(() => post.mockReset().mockResolvedValue({ data: { ok: true } }));

  it('calls the Safety reader endpoint and cuts a stuck call at one minute', async () => {
    await client.safetyReader({});
    expect(post.mock.calls[0][0]).toBe(
      'http://ai/api/v1/debrief/safety-reader',
    );
    expect(post.mock.calls[0][2].timeout).toBe(60_000);
    expect(SAFETY_READER_TIMEOUT_MS).toBe(60_000);
  });

  it('turns a timeout into a step error', async () => {
    post.mockRejectedValue(
      Object.assign(new Error('timeout of 60000ms exceeded'), {
        code: 'ECONNABORTED',
      }),
    );
    await expect(client.safetyReader({})).rejects.toBeInstanceOf(
      DebriefStepError,
    );
  });
});
