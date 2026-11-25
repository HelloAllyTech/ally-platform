import {
  AgentContentBlock,
  AgentSystemBlock,
  AgentToolDefinition,
} from 'src/llm-agent/type/agent-llm.type';
import { PmCardKind, PmQuestionScope } from '../enum/pm-agent.enum';
import {
  PM_CRITIC_SUBMIT_TOOL,
  PM_PIPELINE,
  PM_PROMPT_CODES,
  PM_TASK_IDS,
} from '../constants/pm-agent-pipeline.constants';
import { ROADMAP_READINESS_CRITERIA } from 'src/product-roadmap/constants/product-roadmap.constants';
import { PmLlmPort, PmLlmTarget } from '../pipeline/pm-agent-llm.service';
import { PmCandidate, PmEvidenceRef } from '../pipeline/pm-pipeline.types';
import { checkCandidate } from '../lane/pm-candidate';
import { fence } from '../util/fence.util';
import { PmRunLedger } from '../util/run-ledger';

/** The rubric (plan §6 layer 3). The prompt explains each; code only needs the ids. */
export const PM_CRITIC_RUBRIC = [
  'grounded',
  'scoped',
  'no_open_decisions',
  'sensible_defaults',
  'consistent_with_memory_and_strategy',
  'buildable',
  'honest_risk',
] as const;

/** The roadmap's readiness checklist ids, graded per recommendation (fail-closed). */
export const PM_ROADMAP_READINESS_IDS: string[] =
  ROADMAP_READINESS_CRITERIA.map((criterion) => criterion.id);

export interface PmCriticVerdict {
  index: number;
  pass: boolean;
  reasons: string[];
  /**
   * Recommendations, when readiness is graded: the checklist ids the critic did not mark met
   * (a missing answer counts as not met). Any entry fails the verdict.
   */
  readinessFailed?: string[];
}

export interface PmCriticResult {
  /** ok = the critic ran; budget/failed = it did not, so NOTHING passes. */
  outcome: 'ok' | 'budget' | 'failed' | 'no_submit';
  verdicts: PmCriticVerdict[];
  /** Questions the critic proposed for candidates blocked on missing knowledge. */
  questions: PmCandidate[];
}

const verdictTool: AgentToolDefinition = {
  name: PM_CRITIC_SUBMIT_TOOL,
  description:
    'Submit one verdict per candidate, by index. A candidate with no verdict fails. Call once.',
  input_schema: {
    type: 'object',
    properties: {
      verdicts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            index: { type: 'integer' },
            pass: { type: 'boolean' },
            failed: {
              type: 'array',
              items: { type: 'string', enum: [...PM_CRITIC_RUBRIC] },
            },
            reasons: { type: 'array', items: { type: 'string' } },
            roadmapReadiness: {
              type: 'object',
              description:
                'Recommendations only: for each id of the roadmap filing checklist, true when the ' +
                "candidate's opportunity.description meets it. Anything not true fails the candidate.",
              properties: Object.fromEntries(
                PM_ROADMAP_READINESS_IDS.map((id) => [id, { type: 'boolean' }]),
              ),
            },
            missingKnowledge: {
              type: 'object',
              description:
                'Only when the candidate fails because a decision needs knowledge no tool, ' +
                'memory or document could supply: the question to ask the admin.',
              properties: {
                title: { type: 'string' },
                askedBecause: { type: 'string' },
                usedFor: { type: 'string' },
                options: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      label: { type: 'string' },
                      consequence: { type: 'string' },
                      suggested: { type: 'boolean' },
                    },
                    required: ['label', 'consequence'],
                  },
                },
                questionKey: { type: 'string' },
              },
              required: ['title', 'askedBecause', 'usedFor', 'options'],
            },
          },
          required: ['index', 'pass', 'reasons'],
        },
      },
    },
    required: ['verdicts'],
  },
};

/**
 * Gate layer 3: an independent critic with a written rubric (its own prompt, and a model that
 * can be set apart from the lanes' in the Skills Store). One bounded call over the whole batch.
 *
 * Fail-closed: if the critic cannot run (budget, provider down, no submission), no candidate
 * passes — failures never reach the feed. A verdict naming missing knowledge may carry a
 * question, which is validated like any lane candidate and goes through layers 1–2 again.
 */
export class PmCritic {
  constructor(private readonly llm: PmLlmPort) {}

  async review(input: {
    runId: string;
    target: PmLlmTarget;
    promptText: string;
    promptVersion: number | null;
    sharedContext: AgentSystemBlock;
    memoryBlock: string;
    candidates: PmCandidate[];
    runEvidence: ReadonlyMap<string, PmEvidenceRef>;
    ledger: PmRunLedger;
    /**
     * Grade recommendations against the roadmap's filing checklist (default true). The lessons
     * eval replays the critic over cards decided before roadmap filing existed, which have no
     * `opportunity` to grade, so it turns this off to keep comparing like with like.
     */
    gradeReadiness?: boolean;
  }): Promise<PmCriticResult> {
    const gradeReadiness = input.gradeReadiness !== false;
    if (!input.candidates.length) {
      return { outcome: 'ok', verdicts: [], questions: [] };
    }
    const body = input.candidates
      .map((candidate, index) => {
        const ids: string[] = Array.isArray(candidate.payload?.evidenceIds)
          ? candidate.payload.evidenceIds
          : [];
        const evidence = ids
          .map((id) => input.runEvidence.get(id))
          .filter((ref): ref is PmEvidenceRef => Boolean(ref))
          .map((ref) =>
            fence(
              'tool_data',
              { evidence_id: ref.id, source: ref.source, label: ref.label },
              ref.excerpt,
              PM_PIPELINE.CRITIC_EVIDENCE_MAX_CHARS,
            ),
          )
          .join('\n');
        return [
          `## Candidate ${index} — ${candidate.kind} · ${candidate.category} · lane ${candidate.lane}`,
          '```json',
          JSON.stringify(candidate.payload, null, 1).slice(0, 6000),
          '```',
          evidence ? `Cited evidence:\n${evidence}` : 'Cited evidence: none',
        ].join('\n');
      })
      .join('\n\n');

    const step = await this.llm.step({
      runId: input.runId,
      lane: 'critic',
      kind: 'critic',
      taskId: PM_TASK_IDS.CRITIC,
      promptCode: PM_PROMPT_CODES.CRITIC,
      promptVersion: input.promptVersion,
      target: input.target,
      system: [
        { text: input.promptText },
        input.sharedContext,
        { text: input.memoryBlock },
      ],
      messages: [
        {
          role: 'user',
          content:
            `Review these ${input.candidates.length} candidates and call ${PM_CRITIC_SUBMIT_TOOL}.` +
            (gradeReadiness
              ? ` For every recommendation, also grade opportunity.description against the roadmap ` +
                `filing checklist (${PM_ROADMAP_READINESS_IDS.join(', ')}) in roadmapReadiness: an ` +
                `accepted card is filed to the roadmap exactly as written, so be as strict as the ` +
                `roadmap's own gate.`
              : '') +
            `\n\n${body}`,
        },
      ],
      tools: [verdictTool],
      maxTokens: PM_PIPELINE.CRITIC_MAX_TOKENS,
      timeoutMs: PM_PIPELINE.CALL_TIMEOUT_MS,
      ledger: input.ledger,
    });
    if (step.status !== 'ok') {
      return { outcome: step.status, verdicts: [], questions: [] };
    }
    const use = step.turn.content.find(
      (block): block is Extract<AgentContentBlock, { type: 'tool_use' }> =>
        block.type === 'tool_use' && block.name === PM_CRITIC_SUBMIT_TOOL,
    );
    if (!use || step.turn.stopReason === 'max_tokens') {
      return { outcome: 'no_submit', verdicts: [], questions: [] };
    }
    const raw: any[] = Array.isArray(use.input?.verdicts)
      ? use.input.verdicts
      : [];
    const verdicts: PmCriticVerdict[] = [];
    const questions: PmCandidate[] = [];
    const seen = new Set<number>();
    for (const item of raw) {
      const index = Number(item?.index);
      if (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= input.candidates.length ||
        seen.has(index)
      ) {
        continue;
      }
      seen.add(index);
      const source = input.candidates[index];
      const readinessFailed =
        gradeReadiness && source.kind === PmCardKind.RECOMMENDATION
          ? PM_ROADMAP_READINESS_IDS.filter(
              (id) => item?.roadmapReadiness?.[id] !== true,
            )
          : undefined;
      const reasons = [
        ...(Array.isArray(item?.failed) ? item.failed.map(String) : []),
        ...(readinessFailed?.length
          ? [`roadmap_not_ready: ${readinessFailed.join(', ')}`]
          : []),
        ...(Array.isArray(item?.reasons) ? item.reasons.map(String) : []),
      ].map((reason) => reason.slice(0, 300));
      verdicts.push({
        index,
        pass: item?.pass === true && !readinessFailed?.length,
        reasons,
        ...(readinessFailed ? { readinessFailed } : {}),
      });
      if (
        !verdicts[verdicts.length - 1].pass &&
        item?.missingKnowledge &&
        source.kind === PmCardKind.RECOMMENDATION
      ) {
        const check = checkCandidate(
          {
            kind: PmCardKind.QUESTION,
            category: source.category,
            question: {
              scope: PmQuestionScope.FEATURE,
              ...item.missingKnowledge,
            },
          },
          source.lane,
          new Set(),
        );
        if (check.candidate) {
          questions.push({ ...check.candidate, unblocks: true });
        }
      }
    }
    return { outcome: 'ok', verdicts, questions };
  }
}
