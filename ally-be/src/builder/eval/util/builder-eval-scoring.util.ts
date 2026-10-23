import { BuilderMessage } from '../../entity/builder-message.entity';
import { BuilderMessageRole } from '../../enum/builder.enum';
import {
  BuilderPrdDocument,
  BuilderPrdReadiness,
} from '../../type/builder-prd.type';
import { BUILDER_EVIDENCE_TOOLS } from '../../service/builder-evidence-log.service';
import {
  BuilderEvalExpectedOutcome,
  BuilderEvalGates,
  BuilderEvalInterviewOutcome,
} from '../type/builder-eval.type';
import {
  claimsPrdEdit,
  claimsPrdReady,
} from '../../util/builder-turn-claims.util';
import {
  BUILDER_PRD_EDIT_TOOLS,
  BUILDER_TERMINAL_TOOLS,
} from '../../util/builder-turn-receipt.util';

/** One model pass: the content blocks it returned, in order. */
export interface ScoredPass {
  content: any[];
}

interface ToolOutcome {
  name: string;
  ok: boolean;
  /**
   * False for a turn-ending call the validated loop sent back: that reply was
   * never shown, so what its batch got wrong was not hidden from anyone.
   */
  delivered: boolean;
}

/** Tool results across the transcript, by the tool_use id they answer. */
function outcomesById(messages: BuilderMessage[]): Map<string, ToolOutcome> {
  const outcomes = new Map<string, ToolOutcome>();
  for (const message of messages) {
    for (const result of message.toolResults ?? []) {
      if (!result?.toolUseId) continue;
      outcomes.set(String(result.toolUseId), {
        name: String(result.name ?? ''),
        ok: result.result?.ok !== false,
        delivered: result.result?.delivered !== false,
      });
    }
  }
  return outcomes;
}

/**
 * The deterministic gates for one replay.
 *
 * Batch-level gates read the passes the sandbox captured — the only record of
 * which calls went out together, since the transcript stores a turn's calls
 * flat. Turn-level gates read the stored messages. Consistency and evidence
 * read the final readiness, which already computes both.
 */
export function computeEvalGates(
  passes: ScoredPass[],
  messages: BuilderMessage[],
  finalReadiness: BuilderPrdReadiness,
  /** Readiness each turn settled on, by the id of its reply. */
  readyAfter: ReadonlyMap<string, boolean> = new Map(),
): BuilderEvalGates {
  const outcomes = outcomesById(messages);

  let unseenFailures = 0;
  let askedBeforeReading = 0;
  for (const pass of passes) {
    const uses = (pass.content ?? []).filter(
      (block: any) => block?.type === 'tool_use',
    );
    // Only a batch whose reply reached the admin: a reply the validated loop
    // sent back was rewritten after the results were read.
    const delivered = uses.some(
      (block: any) =>
        BUILDER_TERMINAL_TOOLS.has(String(block.name)) &&
        outcomes.get(String(block.id))?.delivered !== false,
    );
    if (!delivered) continue;
    const others = uses.filter(
      (block: any) => !BUILDER_TERMINAL_TOOLS.has(String(block.name)),
    );
    unseenFailures += others.filter(
      (block: any) => outcomes.get(String(block.id))?.ok === false,
    ).length;
    if (
      others.some((block: any) =>
        BUILDER_EVIDENCE_TOOLS.has(String(block.name)),
      )
    ) {
      askedBeforeReading += 1;
    }
  }

  let unrepairedEditFailures = 0;
  let falseUpdateClaims = 0;
  let falseReadyClaims = 0;
  for (const message of messages) {
    if (message.role !== BuilderMessageRole.ASSISTANT) continue;
    // What the admin read: the reply and any question card under it. A reply
    // the server already corrected told them what is left, so misled no one.
    const shown = [
      message.content,
      ...(message.metadata?.questions ?? []).map((q: any) => q?.prompt),
    ]
      .filter(Boolean)
      .join('\n');
    if (
      readyAfter.get(message.id) === false &&
      !message.metadata?.readyClaimCorrected &&
      claimsPrdReady(shown)
    ) {
      falseReadyClaims += 1;
    }
    const edits = (message.toolResults ?? []).filter((result) =>
      BUILDER_PRD_EDIT_TOOLS.has(String(result?.name)),
    );
    let pendingFailures = 0;
    let anySuccess = false;
    for (const edit of edits) {
      if (edit?.result?.ok === false) {
        pendingFailures += 1;
      } else {
        // A later success is taken as the repair. It may have patched a
        // different section; the readiness and the judge catch what it missed.
        pendingFailures = 0;
        anySuccess = true;
      }
    }
    unrepairedEditFailures += pendingFailures;
    if (!anySuccess && claimsPrdEdit(message.content)) {
      falseUpdateClaims += 1;
    }
  }

  const row = (key: string) =>
    finalReadiness.sections.find((section) => section.key === key);
  const consistent = ['testPlanRepos', 'requirementHomes', 'mobileTwins'].every(
    (key) => row(key)?.ok !== false,
  );

  return {
    unseenFailures,
    askedBeforeReading,
    unrepairedEditFailures,
    falseUpdateClaims,
    falseReadyClaims,
    consistent,
    // Absent means the replay never read anything to cite — not a pass.
    evidenceCited: row('existingGrounded')?.ok === true,
  };
}

/** Count of gate failures in a run: every non-zero count, every false flag. */
export function gateViolations(
  gates: BuilderEvalGates | null | undefined,
): number {
  if (!gates) return 0;
  return (
    gates.unseenFailures +
    gates.askedBeforeReading +
    gates.unrepairedEditFailures +
    gates.falseUpdateClaims +
    (gates.falseReadyClaims ?? 0) +
    (gates.consistent ? 0 : 1) +
    (gates.evidenceCited ? 0 : 1)
  );
}

/** What a fixture expects, read leniently: anything but `nothing_to_build` is a PRD. */
export function expectedOutcomeOf(payload: {
  expectedOutcome?: unknown;
}): BuilderEvalExpectedOutcome {
  return payload?.expectedOutcome === 'nothing_to_build'
    ? 'nothing_to_build'
    : 'prd_ready';
}

/**
 * How an interview replay ended.
 *
 * Nothing to build is read from what Builder left, not from its prose: the
 * PRD says what already exists and plans no requirement — so there is nothing
 * a build could start from — and the last reply asked the admin nothing, so
 * the interview ended on that conclusion rather than running out of turns
 * mid-question. Suite 5d24dd95's three runs that concluded so all ended this
 * way; one that said "no work is needed" but left four requirements in the
 * PRD did not, and a build pressed from it would have built them.
 *
 * Whether "what already exists" rests on files the replay read is the
 * `evidenceCited` gate's call, not this one's.
 */
export function interviewOutcome(input: {
  readyReached: boolean;
  draft: BuilderPrdDocument | null | undefined;
  /** The last reply reached the admin and asked nothing: no question, no brief. */
  endedWithoutAsking: boolean;
}): BuilderEvalInterviewOutcome {
  if (input.readyReached) return 'prd_ready';
  const draft = input.draft;
  const saysWhatExists = String(draft?.existingBehaviour ?? '').trim() !== '';
  const plansNothing = (draft?.requirements ?? []).length === 0;
  return draft && saysWhatExists && plansNothing && input.endedWithoutAsking
    ? 'nothing_to_build'
    : 'neither';
}
