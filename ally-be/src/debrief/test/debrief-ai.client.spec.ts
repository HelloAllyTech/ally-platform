import axios from 'axios';
import {
  DebriefAiClient,
  DebriefStepError,
  STEP_TIMEOUT_MS,
} from '../service/debrief-ai.client';

jest.mock('axios');

describe('DebriefAiClient', () => {
  const client = new DebriefAiClient({
    ai: { apiUrl: 'http://ai', outboundApiKey: 'k' },
  } as any);
  const post = axios.post as jest.Mock;

  beforeEach(() => post.mockReset().mockResolvedValue({ data: { ok: true } }));

  it('cuts a stuck Safety reader call at one minute, not two', async () => {
    await client.step('safety-reader', {});
    expect(post.mock.calls[0][2].timeout).toBe(60_000);
    expect(STEP_TIMEOUT_MS['safety-reader']).toBeLessThan(120_000);
  });

  it('gives anything else the run-length default', async () => {
    await client.step('pm-agent/analyse', {});
    expect(post.mock.calls[0][2].timeout).toBe(120_000);
  });

  it('turns a timeout into a step error the runner retries', async () => {
    post.mockRejectedValue(
      Object.assign(new Error('timeout of 60000ms exceeded'), {
        code: 'ECONNABORTED',
      }),
    );
    await expect(client.step('safety-reader', {})).rejects.toBeInstanceOf(
      DebriefStepError,
    );
  });
});
