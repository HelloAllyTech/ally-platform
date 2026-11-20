import { Injectable } from '@nestjs/common';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import {
  TRACK_MAX_BRANCHING_CHOICE_TEXT,
  TRACK_MAX_BRANCHING_CHOICES,
  TRACK_MAX_BRANCHING_NODE_TEXT,
  TRACK_MAX_BRANCHING_TAKEAWAY,
  TRACK_MAX_BRANCHING_TITLE,
} from 'src/track/constants/track.constant';
import {
  BranchingChoice,
  BranchingNode,
  BranchingOutcomeTone,
  BranchingScenarioContent,
  branchingEndingScore,
  isBranchingEnding,
} from 'src/track/type/branching.type';
import { TrackItemType } from 'src/track/type/track.type';
import {
  COURSE_COPILOT_AI_TASKS,
  COURSE_COPILOT_LIMITS,
  COURSE_COPILOT_PROMPTS,
} from '../../constants/course-copilot.constants';
import { SpecialistLlmService } from './specialist-llm.service';
import {
  ItemSpecialist,
  SpecialistContext,
  SpecialistOutput,
} from './specialist.types';
import {
  asArray,
  asNumber,
  asText,
  assertNoProblems,
  assertTrackItemContent,
  behavioursForPrompt,
  briefForPrompt,
  clampInt,
  collectContentIds,
  courseCharactersForPrompt,
  courseOutlineForPrompt,
  foldText,
  IdMinter,
  isRecord,
  itemForPrompt,
  objectivesForPrompt,
  plural,
  SPECIALIST_MAX_TOKENS,
} from './specialist.util';

const DEFAULT_SCENES = 8;
const MIN_SCENES = 4;
const INTRO_MAX_CHARS = 600;

/** Scores an ending carries when the model names a tone but no number. */
const OUTCOME_SCORES: Record<BranchingOutcomeTone, number> = {
  [BranchingOutcomeTone.POSITIVE]: 100,
  [BranchingOutcomeTone.MIXED]: 50,
  [BranchingOutcomeTone.NEGATIVE]: 0,
};

const OUTCOME_ALIASES: Record<string, BranchingOutcomeTone> = {
  positive: BranchingOutcomeTone.POSITIVE,
  good: BranchingOutcomeTone.POSITIVE,
  success: BranchingOutcomeTone.POSITIVE,
  mixed: BranchingOutcomeTone.MIXED,
  partial: BranchingOutcomeTone.MIXED,
  neutral: BranchingOutcomeTone.MIXED,
  negative: BranchingOutcomeTone.NEGATIVE,
  bad: BranchingOutcomeTone.NEGATIVE,
  poor: BranchingOutcomeTone.NEGATIVE,
};

interface ScenarioQuizNormaliseOptions {
  title: string;
  /** 0 = explore (ungated); above 0 gates the item on reaching a good ending. */
  passScore: number;
  keepIds: ReadonlySet<string>;
  /**
   * Repair pass: fix what has one right answer instead of reporting it — drop
   * a choice that leads nowhere and cap a scene's choices — so a second
   * slightly-off answer still lands.
   */
  lenient?: boolean;
}

/**
 * Writes one BRANCHING_SCENARIO item — a "scenario quiz" in the Studio — as a
 * scene list: each scene one moment in a conversation, with the person's words
 * in their own voice, and 2-6 things the learner could say next. Each choice
 * leads to another scene or to an ending; endings carry an outcome and a score.
 *
 * The design manual's rules the prompt carries, and the code checks where it
 * can:
 * - A poor choice should lead somewhere recoverable, not only to an ending —
 *   repair is part of the skill. Checked as "at least two decision points",
 *   which is the least a recovery needs.
 * - A good and a not-good ending both exist, so the choices have consequences.
 * - Wrong choices come from the brief's unhelpful behaviours.
 *
 * The track's choice has no feedback field: the feedback on a choice is the
 * scene it leads to — what the person says back — and an ending's takeaway.
 *
 * Pass mark: the blueprint's `completionCriteria.passScore`, 0 (explore) when
 * it has none. It is written to `settings.passScore`, which the track mirrors
 * into the item's completion rule on save.
 */
@Injectable()
export class ScenarioQuizSpecialist implements ItemSpecialist {
  constructor(private readonly llm: SpecialistLlmService) {}

  async generate(context: SpecialistContext): Promise<SpecialistOutput> {
    const { brief, blueprint, item, previous } = context;
    const spec = item.spec ?? {};
    const sceneCount = clampInt(
      spec.sceneCount,
      MIN_SCENES,
      COURSE_COPILOT_LIMITS.scenarioQuizScenes,
      DEFAULT_SCENES,
    );
    const passScore = clampInt(item.completionCriteria?.passScore, 0, 100, 0);

    const { data } = await this.llm.runJson({
      specialist: 'scenario_quiz',
      promptCode: COURSE_COPILOT_PROMPTS.SCENARIO_QUIZ_WRITER,
      taskId: COURSE_COPILOT_AI_TASKS.SCENARIO_QUIZ,
      task: LlmTask.COURSE_COPILOT_SCENARIO_QUIZ,
      maxTokens: SPECIALIST_MAX_TOKENS.SCENARIO_QUIZ,
      usageMetadata: context.usageMetadata,
      repairErrors: context.repairErrors,
      referenceMaterial: context.referenceMaterial,
      previous,
      variables: {
        brief_json: briefForPrompt(brief),
        course_outline: courseOutlineForPrompt(blueprint, item.id),
        item_json: itemForPrompt(item),
        objectives: objectivesForPrompt(brief, item),
        helpful_behaviours: behavioursForPrompt(brief?.behaviours?.helpful),
        unhelpful_behaviours: behavioursForPrompt(brief?.behaviours?.unhelpful),
        course_characters: courseCharactersForPrompt(blueprint),
        scene_count: String(sceneCount),
        max_scenes: String(COURSE_COPILOT_LIMITS.scenarioQuizScenes),
        pass_instruction: passScore
          ? `This scenario gates progress: a learner passes by reaching an ending that scores ${passScore} or more, so at least one ending must score that.`
          : 'This scenario is for exploring: it never blocks progress, so every ending is a fair place to finish.',
      },
    });

    return normaliseScenarioQuizOutput(data, {
      title: item.title,
      passScore,
      keepIds: previous ? collectContentIds(previous.content) : new Set(),
      lenient: Boolean(context.repairErrors?.length),
    });
  }
}

interface DraftScene {
  rawId: string;
  node: BranchingNode;
  rawChoices: { text: string; next: string; id: unknown }[];
}

/** Pure: raw model JSON → validated BRANCHING_SCENARIO content. Exported for tests. */
export function normaliseScenarioQuizOutput(
  raw: Record<string, any>,
  opts: ScenarioQuizNormaliseOptions,
): SpecialistOutput {
  const root = isRecord(raw.scenario)
    ? raw.scenario
    : isRecord(raw.scenarioQuiz)
      ? raw.scenarioQuiz
      : raw;
  const ids = new IdMinter(opts.keepIds);
  const problems: string[] = [];

  // Pass 1: every scene gets its id, so a choice can point forward to one.
  const drafts: DraftScene[] = [];
  asArray(root.scenes ?? root.nodes)
    .filter(isRecord)
    .forEach((rawScene, index) => {
      const label = `Scene ${index + 1}`;
      const text = asText(
        rawScene.text ?? rawScene.body ?? rawScene.scene,
        TRACK_MAX_BRANCHING_NODE_TEXT,
      );
      if (!text) {
        problems.push(`${label} has no text.`);
        return;
      }
      const node: BranchingNode = { id: ids.mint(rawScene.id), text };
      const title = asText(rawScene.title, TRACK_MAX_BRANCHING_TITLE);
      if (title) node.title = title;
      const rawChoices = asArray(rawScene.choices ?? rawScene.options)
        .filter(isRecord)
        .map((choice) => ({
          text: asText(
            choice.text ?? choice.label,
            TRACK_MAX_BRANCHING_CHOICE_TEXT,
          ),
          next: asText(
            choice.next ??
              choice.nextSceneId ??
              choice.nextNodeId ??
              choice.leadsTo ??
              choice.goto,
          ),
          id: choice.id,
        }))
        .filter((choice) => choice.text);
      drafts.push({
        rawId: asText(rawScene.id) || String(index + 1),
        node,
        rawChoices,
      });
      if (rawChoices.length === 0) applyEnding(node, rawScene, label, problems);
    });

  if (drafts.length === 0) {
    assertNoProblems(
      problems.length ? problems : ['The scenario quiz has no scenes.'],
    );
  }
  if (drafts.length > COURSE_COPILOT_LIMITS.scenarioQuizScenes) {
    problems.push(
      `The scenario has ${drafts.length} scenes; write at most ${COURSE_COPILOT_LIMITS.scenarioQuizScenes}.`,
    );
  }

  // Pass 2: choices, resolved to the scene they lead to.
  const byRawId = new Map<string, BranchingNode>();
  const byTitle = new Map<string, BranchingNode>();
  drafts.forEach(({ rawId, node }) => {
    if (!byRawId.has(rawId.toLowerCase())) {
      byRawId.set(rawId.toLowerCase(), node);
    }
    if (node.title && !byTitle.has(foldText(node.title))) {
      byTitle.set(foldText(node.title), node);
    }
  });
  const resolve = (key: string): BranchingNode | undefined => {
    if (!key) return undefined;
    return (
      byRawId.get(key.toLowerCase()) ??
      byTitle.get(foldText(key)) ??
      drafts.find((draft) => draft.node.id === key)?.node
    );
  };

  drafts.forEach(({ node, rawChoices }, index) => {
    if (rawChoices.length === 0) return;
    const label = `Scene ${index + 1}${node.title ? ` ("${node.title}")` : ''}`;
    let choices = rawChoices;
    if (choices.length > TRACK_MAX_BRANCHING_CHOICES) {
      if (opts.lenient) choices = choices.slice(0, TRACK_MAX_BRANCHING_CHOICES);
      else {
        problems.push(
          `${label} has ${choices.length} choices; give it 2 to ${TRACK_MAX_BRANCHING_CHOICES}.`,
        );
      }
    }
    const resolved: BranchingChoice[] = [];
    for (const choice of choices) {
      const target = resolve(choice.next);
      if (!target) {
        if (!opts.lenient) {
          problems.push(
            `${label}: the choice "${choice.text}" leads to "${choice.next || '(nothing)'}", which is not a scene.`,
          );
        }
        continue;
      }
      resolved.push({
        id: ids.mint(choice.id),
        text: choice.text,
        nextNodeId: target.id,
      });
    }
    if (resolved.length) node.choices = resolved;
    else if (opts.lenient) {
      problems.push(`${label} has no choice that leads to another scene.`);
    }
  });

  assertNoProblems(problems);

  const startKey = asText(
    root.startSceneId ?? root.startNodeId ?? root.start ?? root.firstSceneId,
  );
  const start = resolve(startKey) ?? drafts[0].node;

  // A scene nothing leads to can never be seen; dropping it loses nothing.
  const nodes = reachableFrom(
    start,
    drafts.map((draft) => draft.node),
  );
  problems.push(...structureProblems(nodes, opts.passScore));
  assertNoProblems(problems);

  const intro = asText(root.intro ?? root.instructions, INTRO_MAX_CHARS);
  const content: BranchingScenarioContent = {
    ...(intro ? { intro } : {}),
    settings: { passScore: opts.passScore, maxAttempts: null },
    startNodeId: start.id,
    nodes,
  };
  assertTrackItemContent(TrackItemType.BRANCHING_SCENARIO, content, opts.title);
  return {
    content: content as unknown as Record<string, any>,
    summary: summariseScenarioQuiz(nodes),
  };
}

/** Turn a choiceless scene into an ending: an outcome, a score, a takeaway. */
function applyEnding(
  node: BranchingNode,
  raw: Record<string, any>,
  label: string,
  problems: string[],
): void {
  const given = asNumber(raw.score);
  const score =
    given === undefined
      ? undefined
      : Math.min(100, Math.max(0, Math.round(given)));
  const outcome =
    OUTCOME_ALIASES[asText(raw.outcome ?? raw.tone).toLowerCase()] ??
    (score === undefined
      ? undefined
      : score >= 75
        ? BranchingOutcomeTone.POSITIVE
        : score >= 35
          ? BranchingOutcomeTone.MIXED
          : BranchingOutcomeTone.NEGATIVE);
  if (!outcome) {
    problems.push(
      `${label} is an ending but has no outcome (positive, mixed or negative).`,
    );
    return;
  }
  node.outcome = outcome;
  node.score = score ?? OUTCOME_SCORES[outcome];
  const takeaway = asText(
    raw.takeaway ?? raw.reflection,
    TRACK_MAX_BRANCHING_TAKEAWAY,
  );
  if (takeaway) node.takeaway = takeaway;
}

function reachableFrom(
  start: BranchingNode,
  all: BranchingNode[],
): BranchingNode[] {
  const byId = new Map(all.map((node) => [node.id, node]));
  const seen = new Set<string>();
  const queue = [start.id];
  while (queue.length) {
    const id = queue.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const choice of byId.get(id)?.choices ?? []) {
      queue.push(choice.nextNodeId);
    }
  }
  return all.filter((node) => seen.has(node.id));
}

/** What makes a scenario worth playing, beyond what the track validator checks. */
function structureProblems(
  nodes: BranchingNode[],
  passScore: number,
): string[] {
  const problems: string[] = [];
  const endings = nodes.filter(isBranchingEnding);
  const decisions = nodes.filter((node) => (node.choices?.length ?? 0) >= 2);
  if (endings.length === 0) {
    return ['The scenario has no ending — a scene with no choices.'];
  }
  if (!endings.some((node) => node.outcome === BranchingOutcomeTone.POSITIVE)) {
    problems.push('The scenario needs at least one positive ending.');
  }
  if (endings.every((node) => node.outcome === BranchingOutcomeTone.POSITIVE)) {
    problems.push(
      'Every ending is positive, so no choice has a consequence. Add a mixed or negative ending.',
    );
  }
  if (decisions.length < 2) {
    problems.push(
      'The scenario has fewer than two decision points. A poor first choice should lead to a scene where the learner can still recover, not straight to an ending.',
    );
  }
  if (
    passScore > 0 &&
    Math.max(...endings.map(branchingEndingScore)) < passScore
  ) {
    problems.push(
      `No ending scores ${passScore} or more, so nobody could pass. Give the best ending a score of at least ${passScore}.`,
    );
  }
  return problems;
}

export function summariseScenarioQuiz(nodes: BranchingNode[]): string {
  const endings = nodes.filter(isBranchingEnding).length;
  return `${plural(nodes.length, 'scene')} (${plural(endings, 'ending')})`;
}
