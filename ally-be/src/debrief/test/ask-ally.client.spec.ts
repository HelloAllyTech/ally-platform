import axios from 'axios';
import { Readable } from 'stream';
import { AskAllyClient, AskAllyError } from '../service/ask-ally.client';

jest.mock('axios');

/** ally-ai's NDJSON stream, split at awkward bytes as a socket would (mid-character too). */
const ndjson = (events: unknown[], cut = 7) => {
  const bytes = Buffer.from(
    events.map((e) => JSON.stringify(e) + '\n').join(''),
  );
  const pieces: Buffer[] = [];
  for (let i = 0; i < bytes.length; i += cut) {
    pieces.push(bytes.subarray(i, i + cut));
  }
  return Readable.from(pieces, { objectMode: false });
};

describe('AskAllyClient', () => {
  const client = new AskAllyClient({
    ai: { apiUrl: 'http://ai', outboundApiKey: 'k' },
  } as any);
  const post = axios.post as jest.Mock;
  beforeEach(() => post.mockReset());

  it('relays each piece of text and returns the finished reply', async () => {
    post.mockResolvedValue({
      data: ndjson([
        { type: 'token', text: 'Ask it ' },
        { type: 'token', text: 'plainly — शांति से.' },
        {
          type: 'done',
          text: 'Ask it plainly — शांति से.',
          tool_texts: ['Risk guide: Ask plainly.'],
          trace: { turns: 2, tools: [] },
        },
      ]),
    });
    const seen: string[] = [];
    const res = await client.reply({ run_id: 'r1' } as any, (t) =>
      seen.push(t),
    );
    expect(seen).toEqual(['Ask it ', 'plainly — शांति से.']);
    expect(res).toEqual({
      text: 'Ask it plainly — शांति से.',
      toolTexts: ['Risk guide: Ask plainly.'],
      trace: { turns: 2, tools: [] },
    });
    const [url, body, config] = post.mock.calls[0];
    expect(url).toBe('http://ai/api/v1/ask-ally/replies');
    expect(body).toEqual({ run_id: 'r1' });
    expect(config.headers).toEqual({ 'x-api-key': 'k' });
    expect(config.responseType).toBe('stream');
  });

  it('throws what the learner already saw when the stream ends in an error', async () => {
    post.mockResolvedValue({
      data: ndjson([
        { type: 'token', text: 'Let me check.' },
        { type: 'error', error: 'down', text: 'Let me check.', trace: null },
      ]),
    });
    const err = await client.reply({} as any, () => undefined).catch((e) => e);
    expect(err).toBeInstanceOf(AskAllyError);
    expect(err.streamed).toBe('Let me check.');
  });

  it('throws when ally-ai cannot be reached, or the stream stops early', async () => {
    post.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    await expect(client.reply({} as any, () => undefined)).rejects.toThrow(
      'ask-ally network: connect ECONNREFUSED',
    );
    post.mockResolvedValueOnce({
      data: ndjson([{ type: 'token', text: 'Half' }]),
    });
    const err = await client.reply({} as any, () => undefined).catch((e) => e);
    expect(err.message).toBe('ask-ally stream ended early');
    expect(err.streamed).toBe('Half');
  });
});
