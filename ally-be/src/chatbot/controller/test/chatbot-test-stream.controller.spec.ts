import { EventEmitter } from 'events';
import { ForbiddenException } from '@nestjs/common';
import type { LiveReply } from '../../engine/chatbot-engine.types';
import { ChatbotController } from '../chatbot.controller';

/** An Express response that records what was written. */
class FakeResponse extends EventEmitter {
  headers: Record<string, string> = {};
  chunks: string[] = [];
  headersSent = false;
  writableEnded = false;
  setHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  flushHeaders() {
    this.headersSent = true;
  }
  write(chunk: string) {
    this.chunks.push(chunk);
    return true;
  }
  end() {
    this.writableEnded = true;
  }
  /** The (event, data) pairs written, pings left out. */
  events() {
    return this.chunks
      .filter((c) => c.startsWith('event: '))
      .map((c) => {
        const [event, data] = c.trimEnd().split('\n');
        return [event.slice(7), JSON.parse(data.slice(6))];
      });
  }
}

const RESULT = {
  reply: 'Ally trains counsellors.',
  handledBy: 'rag',
  runtime: 'v2',
  runId: 'run-1',
  trace: [{ node: 'agent', ms: 10, summary: 'agent: question' }],
};

describe('POST /v1/chatbots/:id/test/stream', () => {
  let test: jest.Mock;
  let controller: ChatbotController;

  beforeEach(() => {
    test = jest.fn(async (_id: string, _dto: unknown, live?: LiveReply) => {
      live?.onEvent({ event: 'run_started', data: { run_id: 'run-1' } });
      live?.onEvent({
        event: 'status',
        data: { code: 'checking', label: 'Checking the answer…' },
      });
      live?.onEvent({ event: 'token', data: { text: 'Ally trains' } });
      return RESULT;
    });
    controller = new ChatbotController(
      { test } as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  it('sends the live events, then /test’s own result as final', async () => {
    const res = new FakeResponse();

    await controller.testStream(
      'bot-1',
      { message: 'q' } as never,
      res as never,
    );

    expect(res.headers['Content-Type']).toBe('text/event-stream');
    expect(res.headers['X-Accel-Buffering']).toBe('no');
    expect(res.events()).toEqual([
      ['run_started', { run_id: 'run-1' }],
      ['status', { code: 'checking', label: 'Checking the answer…' }],
      ['token', { text: 'Ally trains' }],
      ['final', RESULT],
    ]);
    expect(res.writableEnded).toBe(true);
  });

  it('sends final equal to what /test returns for the same message', async () => {
    const res = new FakeResponse();
    const plain = await controller.test('bot-1', { message: 'q' } as never);

    await controller.testStream(
      'bot-1',
      { message: 'q' } as never,
      res as never,
    );

    const events = res.events();
    expect(events[events.length - 1]).toEqual(['final', plain]);
  });

  it('sends final alone when nothing streams (v1, a quick reply)', async () => {
    test.mockResolvedValue(RESULT);
    const res = new FakeResponse();

    await controller.testStream(
      'bot-1',
      { message: 'hi' } as never,
      res as never,
    );

    expect(res.events()).toEqual([['final', RESULT]]);
  });

  it('leaves a refusal before the run as a plain HTTP error', async () => {
    test.mockRejectedValue(new ForbiddenException());
    const res = new FakeResponse();

    await expect(
      controller.testStream('bot-1', { message: 'q' } as never, res as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(res.headersSent).toBe(false);
  });

  it('stops the run when the connection closes', async () => {
    let signal: AbortSignal | undefined;
    const res = new FakeResponse();
    test.mockImplementation(async (_id, _dto, live: LiveReply) => {
      signal = live.signal;
      live.onEvent({ event: 'run_started', data: { run_id: 'run-1' } });
      res.emit('close');
      live.onEvent({ event: 'token', data: { text: 'late' } });
      return RESULT;
    });

    await controller.testStream(
      'bot-1',
      { message: 'q' } as never,
      res as never,
    );

    expect(signal?.aborted).toBe(true);
    expect(res.events()).toEqual([['run_started', { run_id: 'run-1' }]]);
  });
});
