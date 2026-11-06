import { Injectable } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import type { NotificationErrorType } from '../../notification/type/notification.error.type';
import {
  AGENT_FALLBACK_EVENT,
  type AgentFallbackEvent,
} from '../type/agent-runtime.event';
import type { Chatbot } from '../entity/chatbot.entity';

export const AGENT_RUNTIME_DEGRADED_TYPE = 'Chatbot Agent Runtime Degraded';

/** At most one "agent runtime degraded" alert per bot and reason in this window. */
export const AGENT_RUNTIME_ALERT_WINDOW_MS = 10 * 60_000;

/**
 * Rate-limits the alert a v2 bot raises when `/agent/run` fails and v1 answers instead.
 *
 * Unthrottled, a runtime that is down — or switched off on purpose in ally-ai while a bot is still
 * set to v2 — pages once per message, and an alert channel that fires on every message stops being
 * read. So one alert per bot and failure reason per window, carrying how many messages fell back
 * since the last one, so the count is not lost with the alerts it replaces.
 *
 * In memory and per instance: N instances can each send one per window. Good enough for a signal
 * whose job is "someone look at this"; nothing here is a record.
 */
@Injectable()
export class AgentRuntimeAlertThrottle {
  private readonly windows = new Map<
    string,
    { lastAlertAt: number; fellBackSince: number }
  >();

  constructor(private readonly eventEmitter: EventEmitter2) {}

  /** A channel's fallback announcement: raise the alert unless this bot and reason just did. */
  @OnEvent(AGENT_FALLBACK_EVENT)
  onFallback(event: AgentFallbackEvent): void {
    const alert = this.take(event.chatbot, event.reason);
    if (alert) this.eventEmitter.emit('exception', alert);
  }

  /** Count one fallback; returns the alert to raise, or null while inside the window. */
  take(
    chatbot: Pick<Chatbot, 'id' | 'name'>,
    reason: string,
    now = Date.now(),
  ): NotificationErrorType | null {
    const key = `${chatbot.id}:${reason}`;
    const entry = this.windows.get(key) ?? {
      lastAlertAt: Number.NEGATIVE_INFINITY,
      fellBackSince: 0,
    };
    entry.fellBackSince += 1;
    this.windows.set(key, entry);
    if (now - entry.lastAlertAt <= AGENT_RUNTIME_ALERT_WINDOW_MS) return null;

    const count = entry.fellBackSince;
    entry.lastAlertAt = now;
    entry.fellBackSince = 0;
    return {
      statusCode: 500,
      timestamp: new Date(now).toISOString(),
      path: 'chatbot/agent-runtime-degraded',
      message:
        `The Agents v2 engine failed for chatbot "${chatbot.name}" (reason: ${reason}), so v1 ` +
        `answered instead. ${count === 1 ? '1 message' : `${count} messages`} fell back to v1 ` +
        `since the last alert for this bot and reason (at most one alert every ` +
        `${AGENT_RUNTIME_ALERT_WINDOW_MS / 60_000} minutes). Check ally-ai's /agent/run ` +
        `(AGENT_RUNTIME__ENABLED and its logs), or move the bot back to v1 — or turn off ` +
        `"Allow the new engine" in Defaults for every bot.`,
      type: AGENT_RUNTIME_DEGRADED_TYPE,
    } as NotificationErrorType;
  }
}
