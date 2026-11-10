import axios from 'axios';
import {
  DebriefGraphClient,
  DebriefGraphError,
  GRAPH_MARGIN_MS,
} from '../service/debrief-graph.client';

jest.mock('axios');

describe('DebriefGraphClient', () => {
  const client = new DebriefGraphClient({
    ai: { apiUrl: 'http://ai', outboundApiKey: 'k' },
  } as any);
  const post = axios.post as jest.Mock;

  beforeEach(() =>
    post.mockReset().mockResolvedValue({ data: { status: 'published' } }),
  );

  it('posts the run to ally-ai with the service key, waiting past the deadline', async () => {
    const res = await client.run({ run_id: 'r1' } as any, 180_000);
    expect(res).toEqual({ status: 'published' });
    const [url, body, config] = post.mock.calls[0];
    expect(url).toBe('http://ai/api/v1/debrief/runs');
    expect(body).toEqual({ run_id: 'r1' });
    expect(config.headers).toEqual({ 'x-api-key': 'k' });
    expect(config.timeout).toBe(180_000 + GRAPH_MARGIN_MS);
  });

  it('turns a 5xx or a network failure into a graph error', async () => {
    post.mockRejectedValueOnce(
      Object.assign(new Error('Request failed'), {
        response: { status: 503, data: { detail: 'checkpointer down' } },
      }),
    );
    await expect(client.run({} as any, 1)).rejects.toThrow(
      new DebriefGraphError(503, 'debrief graph 503: checkpointer down'),
    );
    post.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    await expect(client.run({} as any, 1)).rejects.toThrow(
      'debrief graph network: connect ECONNREFUSED',
    );
  });
});
