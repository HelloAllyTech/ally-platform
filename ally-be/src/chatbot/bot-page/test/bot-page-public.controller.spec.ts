import { HttpException, HttpStatus } from '@nestjs/common';
import type { AgentStreamEvent } from '../../../ai/dto/knowledge.dto';
import {
  BotPagePublicController,
  publicEvent,
} from '../bot-page-public.controller';

/** Everything ally-ai streams, the private parts included. */
const RUN: AgentStreamEvent[] = [
  { event: 'run_started', data: { run_id: 'run-1' } },
  {
    event: 'status',
    data: {
      code: 'searching',
      label: 'Searching',
      detail: 'fees for couples',
      documents: ['Internal pricing'],
    },
  },
  {
    event: 'step',
    data: { node: 'agent', ms: 12, summary: 'agent: tool search_knowledge' },
  },
  { event: 'status', data: { code: 'writing', label: 'Writing' } },
  { event: 'token', data: { text: 'Sessions' } },
  { event: 'token', data: { text: ' cost 1500.' } },
];

function fakeRes() {
  const listeners: Record<string, () => void> = {};
  const res = {
    headersSent: false,
    writableEnded: false,
    written: '',
    setHeader: jest.fn(),
    flushHeaders: jest.fn(function (this: { headersSent: boolean }) {
      this.headersSent = true;
    }),
    write: jest.fn(function (this: { written: string }, chunk: string) {
      this.written += chunk;
    }),
    end: jest.fn(function (this: { writableEnded: boolean }) {
      this.writableEnded = true;
    }),
    on: (name: string, fn: () => void) => {
      listeners[name] = fn;
    },
    close: () => listeners.close?.(),
  };
  for (const key of ['flushHeaders', 'write', 'end'] as const) {
    res[key] = res[key].bind(res) as never;
  }
  return res;
}

function frames(written: string) {
  return written
    .split('\n\n')
    .filter((f) => f.startsWith('event:'))
    .map((f) => {
      const [eventLine, dataLine] = f.split('\n');
      return { event: eventLine.slice(7), data: JSON.parse(dataLine.slice(6)) };
    });
}

describe('BotPagePublicController stream', () => {
  const FINAL = {
    reply: 'Sessions cost 1500.',
    citations: [],
    messageId: 'm2',
    conversationId: 'c1',
  };

  it('sends status codes and checked text, never the run id, steps, queries or document titles', async () => {
    const service = {
      admit: jest.fn().mockResolvedValue({ admitted: true }),
      respond: jest.fn(async (_a, live) => {
        for (const event of RUN) live.onEvent(event);
        return FINAL;
      }),
    };
    const res = fakeRes();
    await new BotPagePublicController(service as never).stream(
      'sunrise',
      { message: 'how much?' },
      {} as never,
      res as never,
    );

    expect(frames(res.written)).toEqual([
      { event: 'status', data: { code: 'searching' } },
      { event: 'status', data: { code: 'writing' } },
      { event: 'token', data: { text: 'Sessions' } },
      { event: 'token', data: { text: ' cost 1500.' } },
      { event: 'final', data: FINAL },
    ]);
    expect(res.written).not.toMatch(
      /run-1|search_knowledge|fees for couples|Internal pricing/,
    );
    expect(res.writableEnded).toBe(true);
  });

  it('a refusal before the reply is a plain HTTP error, with no stream started', async () => {
    const refusal = new HttpException(
      { errorCode: 'BOT_PAGE_THROTTLED' },
      HttpStatus.TOO_MANY_REQUESTS,
    );
    const service = {
      admit: jest.fn().mockRejectedValue(refusal),
      respond: jest.fn(),
    };
    const res = fakeRes();
    await expect(
      new BotPagePublicController(service as never).stream(
        'sunrise',
        { message: 'hi' },
        {} as never,
        res as never,
      ),
    ).rejects.toBe(refusal);
    expect(res.headersSent).toBe(false);
    expect(service.respond).not.toHaveBeenCalled();
  });

  it('a failure after the stream began ends it with error {internal}', async () => {
    const service = {
      admit: jest.fn().mockResolvedValue({}),
      respond: jest.fn(async (_a, live) => {
        live.onEvent(RUN[1]);
        throw new Error('database gone');
      }),
    };
    const res = fakeRes();
    await new BotPagePublicController(service as never).stream(
      'sunrise',
      { message: 'hi' },
      {} as never,
      res as never,
    );
    expect(frames(res.written).slice(-1)[0]).toEqual({
      event: 'error',
      data: { code: 'internal' },
    });
    expect(res.written).not.toContain('database gone');
  });

  it('closing the page aborts the run', async () => {
    let signal: AbortSignal | undefined;
    const res = fakeRes();
    const service = {
      admit: jest.fn().mockResolvedValue({}),
      respond: jest.fn(async (_a, live) => {
        signal = live.signal;
        res.close();
        return FINAL;
      }),
    };
    await new BotPagePublicController(service as never).stream(
      'sunrise',
      { message: 'hi' },
      {} as never,
      res as never,
    );
    expect(signal?.aborted).toBe(true);
    expect(res.written).toBe('');
  });

  it('publicEvent passes only status codes and tokens', () => {
    expect(RUN.map(publicEvent)).toEqual([
      null,
      { event: 'status', data: { code: 'searching' } },
      null,
      { event: 'status', data: { code: 'writing' } },
      { event: 'token', data: { text: 'Sessions' } },
      { event: 'token', data: { text: ' cost 1500.' } },
    ]);
  });
});
