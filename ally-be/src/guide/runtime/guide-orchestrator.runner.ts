import {
  AgentContentBlock,
  AgentMessage,
  AgentStopReason,
  AgentStreamEvent,
  AgentStreamRequest,
  AgentSystemBlock,
  AgentToolDefinition,
  AgentUsage,
} from 'src/llm-agent/type/agent-llm.type';

/**
 * Holds the reply's text until the Sentinel clears it (plans/ally-guide/
 * plan.md §7.8 step 2). Text arrives from the model as it is generated;
 * nothing reaches the learner before `release()`. A crisis verdict calls
 * `discard()`: whatever was buffered is dropped and nothing more goes out.
 */
export class ReleaseGate {
  private buffer: string[] = [];
  private open = false;
  private discarded = false;
  private released = '';

  constructor(private readonly emit: (text: string) => Promise<void>) {}

  async push(text: string): Promise<void> {
    if (this.discarded || !text) return;
    if (!this.open) {
      this.buffer.push(text);
      return;
    }
    this.released += text;
    await this.emit(text);
  }

  async release(): Promise<void> {
    if (this.open || this.discarded) return;
    this.open = true;
    const pending = this.buffer.join('');
    this.buffer = [];
    if (pending) {
      this.released += pending;
      await this.emit(pending);
    }
  }

  discard(): void {
    this.discarded = true;
    this.buffer = [];
  }

  get isOpen(): boolean {
    return this.open;
  }

  get isDiscarded(): boolean {
    return this.discarded;
  }

  /** Text the learner has actually seen. */
  get releasedText(): string {
    return this.released;
  }
}

export interface OrchestratorToolOutcome {
  content: string;
  isError: boolean;
}

export interface OrchestratorRunInput {
  system: AgentSystemBlock[];
  /** History, the learner's message and the situation report, in order. */
  messages: AgentMessage[];
  tools: AgentToolDefinition[];
  maxTokens: number;
  /** Tool-calling passes before a closing pass with tool_choice none. */
  maxPasses: number;
  signal: AbortSignal;
  stream: (
    request: Omit<AgentStreamRequest, 'model' | 'effort'>,
  ) => AsyncGenerator<AgentStreamEvent>;
  executeTool: (
    name: string,
    input: Record<string, any>,
  ) => Promise<OrchestratorToolOutcome>;
  gate: ReleaseGate;
  onToolStart?: (name: string) => void;
  /** Called the first time text arrives from the model (time to first token). */
  onFirstText?: () => void;
}

export interface OrchestratorToolCall {
  id: string;
  name: string;
  input: Record<string, any>;
  result: string;
  isError: boolean;
}

export interface OrchestratorRunOutput {
  /** Exactly what the model produced and was given back, for replay. */
  appended: AgentMessage[];
  /** The reply as the learner reads it (every pass's text). */
  text: string;
  stopReason: AgentStopReason;
  refusal: { category: string | null } | null;
  aborted: boolean;
  passes: number;
  toolCalls: OrchestratorToolCall[];
  usage: AgentUsage[];
}

type FinalMessage = Extract<AgentStreamEvent, { type: 'final' }>['message'];

/** Characters of a later pass held back to judge whether it repeats. */
export const REPEAT_PROBE_CHARS = 60;

const words = (text: string): string[] =>
  text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

/**
 * Whether the opening of a later pass restates text the learner has already
 * been shown this turn: at least four of its words, and 80% of them, appear
 * in the earlier text.
 */
export function repeatsEarlierText(opening: string, earlier: string): boolean {
  const probe = words(opening).slice(0, 12);
  if (probe.length < 4) return false;
  const seen = new Set(words(earlier));
  const shared = probe.filter((word) => seen.has(word)).length;
  return shared / probe.length >= 0.8;
}

const textOf = (content: AgentContentBlock[]): string =>
  content
    .filter((block) => block.type === 'text')
    .map((block) => (block as { text: string }).text)
    .join('');

/**
 * The orchestrator's tool loop (plan §7.8 step 3). Streams each pass through
 * the release gate, runs the tools the model asks for (in order — every v1
 * tool is cheap, and order keeps card events in the sequence the model
 * meant), and appends exactly what was exchanged so the next turn can replay
 * it. After `maxPasses` tool rounds, one closing pass runs with tool_choice
 * none — the tools stay in the request, because removing them would change
 * the prefix earlier thinking blocks are bound to.
 *
 * An aborted pass is dropped whole: half a model turn can never be replayed.
 */
export async function runOrchestrator(
  input: OrchestratorRunInput,
): Promise<OrchestratorRunOutput> {
  const messages = [...input.messages];
  const appended: AgentMessage[] = [];
  const toolCalls: OrchestratorToolCall[] = [];
  const usage: AgentUsage[] = [];
  const texts: string[] = [];
  let stopReason: AgentStopReason = 'other';
  let refusal: OrchestratorRunOutput['refusal'] = null;
  let passes = 0;
  let sawText = false;

  try {
    for (let pass = 0; pass <= input.maxPasses; pass++) {
      const closing = pass === input.maxPasses;
      passes++;
      let separatorSent = texts.join('').length === 0;
      // A later pass that restates the reply so far (a model re-framing the
      // card it just presented) is muted on screen; its blocks are kept for
      // replay. Its opening is held back until it can be judged.
      const earlier = texts.join(' ');
      let probing = earlier.length > 0;
      let held = '';
      let muted = false;
      const release = async (text: string) => {
        if (!sawText) {
          sawText = true;
          input.onFirstText?.();
        }
        if (!separatorSent) {
          separatorSent = true;
          await input.gate.push('\n\n');
        }
        await input.gate.push(text);
      };
      let final: FinalMessage | null = null;
      for await (const event of input.stream({
        system: input.system,
        // A snapshot: the loop appends to its own list after the pass.
        messages: [...messages],
        tools: input.tools,
        ...(closing ? { toolChoice: 'none' as const } : {}),
        maxTokens: input.maxTokens,
        cacheConversation: true,
        signal: input.signal,
        onToolUseStart: input.onToolStart
          ? (call) => input.onToolStart!(call.name)
          : undefined,
      })) {
        if (event.type === 'text_delta') {
          if (muted) continue;
          if (probing) {
            held += event.text;
            if (held.length < REPEAT_PROBE_CHARS) continue;
            probing = false;
            if (repeatsEarlierText(held, earlier)) {
              muted = true;
              continue;
            }
            await release(held);
            continue;
          }
          await release(event.text);
        } else {
          final = event.message;
        }
      }
      if (probing && held) {
        if (repeatsEarlierText(held, earlier)) muted = true;
        else await release(held);
      }
      if (!final) break;
      usage.push(final.usage);
      stopReason = final.stopReason;

      if (final.stopReason === 'refusal') {
        refusal = { category: final.stopDetails?.category ?? null };
        break;
      }

      const content = final.content;
      if (content.length) {
        const assistant: AgentMessage = { role: 'assistant', content };
        messages.push(assistant);
        appended.push(assistant);
        const passText = textOf(content);
        if (passText && !muted) texts.push(passText);
      }

      const uses = content.filter(
        (block): block is Extract<AgentContentBlock, { type: 'tool_use' }> =>
          block.type === 'tool_use',
      );
      if (final.stopReason !== 'tool_use' || uses.length === 0) break;

      const results: AgentContentBlock[] = [];
      for (const use of uses) {
        const outcome = await input.executeTool(use.name, use.input ?? {});
        toolCalls.push({
          id: use.id,
          name: use.name,
          input: use.input ?? {},
          result: outcome.content,
          isError: outcome.isError,
        });
        results.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: outcome.content,
          ...(outcome.isError ? { is_error: true } : {}),
        });
      }
      const toolMessage: AgentMessage = { role: 'user', content: results };
      messages.push(toolMessage);
      appended.push(toolMessage);
    }
  } catch (error) {
    if (input.signal.aborted) {
      return {
        appended: trimToCompleteExchange(appended),
        text: texts.join('\n\n'),
        stopReason,
        refusal,
        aborted: true,
        passes,
        toolCalls,
        usage,
      };
    }
    throw error;
  }

  return {
    appended: trimToCompleteExchange(appended),
    text: texts.join('\n\n'),
    stopReason,
    refusal,
    aborted: false,
    passes,
    toolCalls,
    usage,
  };
}

/**
 * A replayable exchange ends with an assistant message. If the loop stopped
 * right after tool results (an abort, a failed final pass), the trailing
 * tool-result message is dropped together with the tool call that asked for
 * it, so the stored exchange never leaves a tool_use unanswered.
 */
export function trimToCompleteExchange(
  appended: AgentMessage[],
): AgentMessage[] {
  const out = [...appended];
  while (out.length && out[out.length - 1].role !== 'assistant') out.pop();
  const last = out[out.length - 1];
  if (
    last &&
    Array.isArray(last.content) &&
    last.content.some((block) => block.type === 'tool_use')
  ) {
    out.pop();
    return trimToCompleteExchange(out);
  }
  return out;
}
