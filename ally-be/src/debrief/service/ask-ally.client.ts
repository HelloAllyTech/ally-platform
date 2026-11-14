import { Injectable } from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import { Readable } from 'stream';
import { AppConfigService } from '../../config/config.service';
import { DebriefReplyConfig } from '../constants/debrief-release.constants';

/** No answer from ally-ai at all within this: the reply fails. */
const CONNECT_TIMEOUT_MS = 15_000;
/** The whole reply, all passes: well past 4 passes and their tools. */
const REPLY_TIMEOUT_MS = 90_000;

/** `POST /api/v1/ask-ally/replies` (docs/debrief-harness/CONTRACT.md §5). */
export interface AskAllyRequest {
  run_id: string;
  scenario_session_id: string;
  chat_id: string;
  tenant_id: string | null;
  reply: DebriefReplyConfig;
  prices: Record<string, { input_per_m: number; output_per_m: number }>;
  system: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  message: string;
  run_token: string;
  gateway_url: string;
  /** The session's language: the Safety reader reads the message in it. */
  language: string;
  /** The live `debrief_safety_reader_system` text; null uses ally-ai's default. */
  safety_system: string | null;
}

/** How a reply was reached, as the run keeps it for the Console. Never the learner's message. */
export interface ReplyTrace {
  at: string;
  model: string;
  turns: number;
  costUsd: number;
  tools: Array<{
    name: string;
    /** search_guidance only: the topic the model searched. */
    topic?: string;
    ok: boolean;
    ms: number;
    /** What came back, in one line. */
    found: string;
  }>;
  /** Why the loop stopped calling tools, when it was not the model's choice. */
  stoppedBy?: 'max_turns' | 'budget';
}

export interface AskAllyResult {
  text: string;
  /** Everything a tool returned, so the quote check can accept quotes from it. */
  toolTexts: string[];
  trace: ReplyTrace | null;
  /**
   * The Safety reader, run alongside the reply in ally-ai, found the
   * learner's own distress in the message. False when it found none or the
   * reading failed.
   */
  distress: boolean;
}

export class AskAllyError extends Error {
  constructor(
    message: string,
    /** What the learner already saw before it stopped. */
    readonly streamed: string,
    readonly trace: ReplyTrace | null,
    /** The Safety reader's verdict, when the stream reached its last event. */
    readonly distress = false,
  ) {
    super(message);
  }
}

/**
 * Ask Ally's agent in ally-ai: one reply, its words relayed as they arrive,
 * and the Safety reader's distress verdict on the last event. Same base URL
 * and service key as every other ally-ai call.
 */
@Injectable()
export class AskAllyClient {
  constructor(private readonly config: AppConfigService) {}

  async reply(
    body: AskAllyRequest,
    onText: (text: string) => void,
  ): Promise<AskAllyResult> {
    const { apiUrl, outboundApiKey } = this.config.ai;
    let streamed = '';
    let stream: Readable;
    try {
      const res = await axios.post<Readable>(
        `${apiUrl}/api/v1/ask-ally/replies`,
        body,
        {
          headers: { 'x-api-key': outboundApiKey },
          responseType: 'stream',
          timeout: CONNECT_TIMEOUT_MS,
          signal: AbortSignal.timeout(REPLY_TIMEOUT_MS),
        },
      );
      stream = res.data;
    } catch (e) {
      const err = e as AxiosError;
      throw new AskAllyError(
        `ask-ally ${err.response?.status ?? 'network'}: ${err.message}`,
        '',
        null,
      );
    }
    let buffer = '';
    // Decodes across chunk edges: a Devanagari character may arrive split.
    stream.setEncoding('utf8');
    try {
      for await (const piece of stream) {
        buffer += piece as string;
        let nl: number;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line) as Record<string, any>;
          if (ev.type === 'token' && typeof ev.text === 'string') {
            streamed += ev.text;
            onText(ev.text);
          } else if (ev.type === 'done') {
            return {
              text: typeof ev.text === 'string' ? ev.text : streamed,
              toolTexts: Array.isArray(ev.tool_texts) ? ev.tool_texts : [],
              trace: ev.trace ?? null,
              distress: ev.distress === true,
            };
          } else if (ev.type === 'error') {
            throw new AskAllyError(
              String(ev.error ?? 'ask-ally failed'),
              streamed,
              ev.trace ?? null,
              ev.distress === true,
            );
          }
        }
      }
    } catch (e) {
      if (e instanceof AskAllyError) throw e;
      throw new AskAllyError(
        `ask-ally stream: ${(e as Error).message}`,
        streamed,
        null,
      );
    }
    throw new AskAllyError('ask-ally stream ended early', streamed, null);
  }
}
