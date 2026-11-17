import {
  AgentContentBlock,
  AgentMessage,
  AgentSystemBlock,
} from 'src/llm-agent/type/agent-llm.type';
import { PmCardCategory } from '../enum/pm-agent.enum';
import {
  PM_PIPELINE,
  PM_SUBMIT_TOOL,
} from '../constants/pm-agent-pipeline.constants';
import { PmLlmPort, PmLlmTarget } from '../pipeline/pm-agent-llm.service';
import {
  PmCandidate,
  PmEvidenceRef,
  PmToolbox,
} from '../pipeline/pm-pipeline.types';
import { PmRunLedger } from '../util/run-ledger';
import { checkCandidate, submitCandidatesTool } from './pm-candidate';
import { PmLaneDefinition } from './pm-lane-definitions';

type ToolUse = Extract<AgentContentBlock, { type: 'tool_use' }>;

export type PmLaneOutcome =
  | 'ok'
  | 'budget'
  | 'failed'
  | 'discarded'
  | 'timeout'
  | 'no_submit';

export interface PmLaneRunInput {
  runId: string;
  definition: PmLaneDefinition;
  target: PmLlmTarget;
  promptVersion: number | null;
  system: AgentSystemBlock[];
  userMessage: string;
  maxCandidates: number;
  ledger: PmRunLedger;
  /** Absolute wall-clock deadline (ms epoch) for this lane. */
  deadline: number;
  /** Every evidence item of the run so far; the runner adds what its tools fetch. */
  runEvidence: Map<string, PmEvidenceRef>;
  /** Revisions: the category is the original card's and the successor links back. */
  forced?: { category?: PmCardCategory; revisedFromCardId?: string | null };
  now?: () => number;
}

export interface PmLaneRunResult {
  outcome: PmLaneOutcome;
  candidates: PmCandidate[];
  /** Validation errors of candidates that were discarded (for the trace). */
  discarded: string[][];
  passes: number;
  toolCalls: number;
  repaired: boolean;
}

const REPAIR_NOTE =
  'Some candidates failed validation (errors below). Call submit_candidates once more with ' +
  'the corrected candidates — fix the listed fields, cite only evidence ids returned by tools ' +
  'in this run, or drop the candidate. Candidates that fail again are discarded.';

/**
 * One lane: a bounded tool loop that ends in exactly one structured submission.
 *
 * Bounds (all enforced here, none trusted to the model): `MAX_PASSES` passes, a per-pass tool
 * cap, the lane's wall-clock deadline, and the run ledger (each pass reserves before it calls;
 * a pass that cannot reserve ends the lane with `budget`). Tools outside the lane's allow-list
 * are refused without running; the only tools that exist are read-only.
 *
 * Output: `submit_candidates`, schema-validated per candidate. Invalid candidates get ONE repair
 * round (errors sent back as the tool result, submit-only pass); whatever is still invalid is
 * discarded and never persisted. A lane that ends in prose is nudged once, then given a
 * submit-only pass (forced `tool_choice` is rejected by current Claude models, so "forced"
 * means it is the only tool left).
 */
export class PmLaneRunner {
  constructor(
    private readonly llm: PmLlmPort,
    private readonly toolbox: PmToolbox,
  ) {}

  async run(input: PmLaneRunInput): Promise<PmLaneRunResult> {
    const now = input.now ?? Date.now;
    const { definition } = input;
    const submitTool = submitCandidatesTool(input.maxCandidates);
    const research = await this.toolbox.definitions(definition.tools);
    const allowed = new Set<string>(definition.tools);
    const messages: AgentMessage[] = [
      { role: 'user', content: input.userMessage },
    ];
    const result: PmLaneRunResult = {
      outcome: 'no_submit',
      candidates: [],
      discarded: [],
      passes: 0,
      toolCalls: 0,
      repaired: false,
    };

    let forceSubmit = false;
    let nudged = false;
    let kept: PmCandidate[] = [];

    for (let pass = 1; pass <= PM_PIPELINE.MAX_PASSES; pass += 1) {
      if (now() >= input.deadline) {
        result.outcome = 'timeout';
        break;
      }
      const finalPass = forceSubmit || pass >= PM_PIPELINE.MAX_PASSES;
      const step = await this.llm.step({
        runId: input.runId,
        lane: definition.lane,
        kind: 'lane',
        taskId: definition.taskId,
        promptCode: definition.promptCode,
        promptVersion: input.promptVersion,
        target: input.target,
        system: input.system,
        messages,
        tools: finalPass ? [submitTool] : [...research, submitTool],
        maxTokens: PM_PIPELINE.LANE_MAX_TOKENS,
        timeoutMs: Math.max(
          5_000,
          Math.min(PM_PIPELINE.CALL_TIMEOUT_MS, input.deadline - now()),
        ),
        ledger: input.ledger,
      });
      result.passes = pass;
      if (step.status === 'budget') {
        result.outcome = 'budget';
        break;
      }
      if (step.status === 'failed') {
        result.outcome = 'failed';
        break;
      }
      const turn = step.turn;
      if (turn.stopReason === 'invalid_tool_call' && !nudged) {
        nudged = true;
        continue;
      }
      // A pass cut off at max_tokens may hold a half-written call: nothing in it is trusted.
      const uses: ToolUse[] =
        turn.stopReason === 'max_tokens'
          ? []
          : (turn.content.filter((b) => b.type === 'tool_use') as ToolUse[]);
      const submit = uses.find((use) => use.name === PM_SUBMIT_TOOL);

      if (submit) {
        const raw = Array.isArray(submit.input?.candidates)
          ? submit.input.candidates.slice(0, input.maxCandidates)
          : null;
        const errors: string[] = [];
        const valid: PmCandidate[] = [];
        if (!raw) {
          errors.push('candidates: must be an array');
        } else {
          raw.forEach((item: unknown, index: number) => {
            const check = checkCandidate(
              item,
              definition.lane,
              new Set(input.runEvidence.keys()),
              input.forced,
            );
            if (check.candidate) valid.push(check.candidate);
            else {
              errors.push(
                ...check.errors.map((e) => `candidate ${index}: ${e}`),
              );
              result.discarded.push(check.errors);
            }
          });
        }
        if (!errors.length || result.repaired) {
          kept = [...kept, ...valid];
          result.outcome = kept.length || !errors.length ? 'ok' : 'discarded';
          break;
        }
        // One repair round: the valid ones are kept, the model resubmits only the rest.
        result.repaired = true;
        kept = valid;
        result.discarded = [];
        messages.push({ role: 'assistant', content: turn.content });
        messages.push({
          role: 'user',
          content: uses.map((use) => ({
            type: 'tool_result' as const,
            tool_use_id: use.id,
            is_error: use.id === submit.id,
            content:
              use.id === submit.id
                ? `${REPAIR_NOTE}\n${errors.slice(0, 30).join('\n')}${
                    valid.length
                      ? `\n${valid.length} valid candidate(s) were kept; do not resubmit them.`
                      : ''
                  }`
                : 'Not run: submit_candidates was called in the same turn.',
          })),
        });
        forceSubmit = true;
        continue;
      }

      if (!uses.length) {
        if (forceSubmit) break;
        messages.push({
          role: 'user',
          content:
            'Call submit_candidates now. Nothing written outside it is used.',
        });
        forceSubmit = true;
        nudged = true;
        continue;
      }

      // Research: run together, answered together in ONE user message.
      const outcomes = await Promise.all(
        uses.map(async (use, index) => {
          if (index >= PM_PIPELINE.MAX_TOOL_CALLS_PER_PASS) {
            return {
              ok: false,
              modelResult: `Not run: at most ${PM_PIPELINE.MAX_TOOL_CALLS_PER_PASS} tool calls per pass.`,
              evidence: [] as PmEvidenceRef[],
            };
          }
          if (!allowed.has(use.name)) {
            return {
              ok: false,
              modelResult: `Not run: "${use.name}" is not available in this lane. Tools are read-only.`,
              evidence: [] as PmEvidenceRef[],
            };
          }
          result.toolCalls += 1;
          return this.toolbox.execute(use.name, use.input ?? {}, {
            runId: input.runId,
            lane: definition.lane,
          });
        }),
      );
      for (const outcome of outcomes) {
        for (const item of outcome.evidence) {
          input.runEvidence.set(item.id, item);
        }
      }
      messages.push({ role: 'assistant', content: turn.content });
      messages.push({
        role: 'user',
        content: uses.map((use, index) => ({
          type: 'tool_result' as const,
          tool_use_id: use.id,
          content: outcomes[index].modelResult,
          ...(outcomes[index].ok ? {} : { is_error: true }),
        })),
      });
    }

    result.candidates = kept;
    if (result.outcome === 'no_submit' && kept.length) result.outcome = 'ok';
    return result;
  }
}
