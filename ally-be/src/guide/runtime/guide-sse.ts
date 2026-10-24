import { Request, Response } from 'express';
import { GuideEvent } from '../contract/generated/guide-contract';
import {
  atmosphereFor,
  GUIDE_SSE_PING_INTERVAL_MS,
} from '../constants/guide.constants';
import { GuideThread } from '../entity/guide-thread.entity';
import { GuideCardService } from './guide-card.service';
import {
  GuideEventBusService,
  GuideReplayGate,
} from './guide-event-bus.service';

/**
 * Serve a thread's event stream as SSE (plan §7.10, §9.2): `hello`, then a
 * replay of durable events after `afterSeq`, then live events, with a ping
 * every 15 s. The same stream for a learner and an anonymous visitor; only
 * a learner's open stream counts as presence, which lets a completion start
 * a turn right away.
 */
export async function pipeThreadEvents(input: {
  bus: GuideEventBusService;
  cards: GuideCardService;
  thread: GuideThread;
  afterSeq: number;
  req: Request;
  res: Response;
  presence: boolean;
}): Promise<void> {
  const { bus, cards, thread, afterSeq, req, res } = input;
  const threadId = thread.id;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  let closed = false;
  const gate = new GuideReplayGate(afterSeq);
  const write = (event: GuideEvent): void => {
    if (closed || res.writableEnded || !gate.accept(event)) return;
    const id = event.durable ? `id: ${event.seq}\n` : '';
    res.write(`event: ${event.type}\n${id}data: ${JSON.stringify(event)}\n\n`);
  };

  // Subscribe BEFORE replaying, buffering live events, so nothing published
  // between the replay query and going live is lost (plan §9.2).
  const buffered: GuideEvent[] = [];
  let live = false;
  const unsubscribe = bus.subscribe(threadId, (event) =>
    live ? write(event) : buffered.push(event),
  );
  if (input.presence) void cards.markPresent(threadId);
  const heartbeat = setInterval(() => {
    if (input.presence) void cards.markPresent(threadId);
    void bus
      .emitEphemeral(threadId, 'ping', {}, gate.lastSeq)
      .catch(() => undefined);
  }, GUIDE_SSE_PING_INTERVAL_MS);
  req.on('close', () => {
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
    if (input.presence) void cards.markAbsent(threadId);
  });

  try {
    await bus.ensureSubscribed();
    write({
      v: 1,
      seq: afterSeq,
      threadId,
      at: new Date().toISOString(),
      durable: false,
      type: 'hello',
      data: {
        lastSeq: thread.lastEventSeq,
        mode: thread.mode,
        atmosphere: atmosphereFor(thread.mode),
      },
    });
    for (const event of await bus.replay(threadId, afterSeq)) write(event);
    live = true;
    for (const event of buffered.splice(0)) write(event);
  } catch {
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  }
}

/** The resume point: `Last-Event-ID` wins over `?afterSeq`. */
export const resumeSeq = (
  lastEventId: string | undefined,
  afterSeqQuery: string | undefined,
): number => Math.max(0, Number(lastEventId ?? afterSeqQuery ?? 0) || 0);
