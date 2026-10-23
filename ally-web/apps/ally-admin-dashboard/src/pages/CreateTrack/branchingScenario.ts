import {
  MAX_BRANCHING_CHOICE_TEXT,
  MAX_BRANCHING_CHOICES,
  MAX_BRANCHING_NODE_TEXT,
  MAX_BRANCHING_NODES,
  MAX_BRANCHING_TAKEAWAY,
  MAX_BRANCHING_TITLE,
  MAX_QUESTION_MEDIA_ALT_LENGTH,
  MIN_BRANCHING_CHOICES,
} from "@constants";
import { BranchingNode, BranchingOutcomeTone, BranchingScenarioContent } from "@types";

/*
 * Pure helpers for the Branching scenario editor. The graph rules mirror
 * ally-be's `validateBranchingContent`; the server stays authoritative, these
 * just let a trainer see a problem before they hit save.
 */

const newId = () => crypto.randomUUID();

export const OUTCOME_DEFAULT_SCORE: Record<BranchingOutcomeTone, number> = {
  POSITIVE: 100,
  MIXED: 50,
  NEGATIVE: 0,
};

export const isEnding = (node: BranchingNode): boolean =>
  !node.choices || node.choices.length === 0;

/** The score a run earns on this ending: its own, else its outcome's default, else full marks. */
export const endingScore = (node: BranchingNode): number => {
  if (typeof node.score === "number") return node.score;
  if (node.outcome) return OUTCOME_DEFAULT_SCORE[node.outcome];
  return 100;
};

export const createEnding = (outcome?: BranchingOutcomeTone): BranchingNode => ({
  id: newId(),
  title: "",
  text: "",
  ...(outcome ? { outcome, score: OUTCOME_DEFAULT_SCORE[outcome] } : {}),
  takeaway: "",
});

/** A one-decision scenario: a start scene whose 3 choices lead to a Positive, Mixed and Negative ending. */
export const createBranchingTemplate = (): BranchingScenarioContent => {
  const good = createEnding("POSITIVE");
  const mixed = createEnding("MIXED");
  const bad = createEnding("NEGATIVE");
  const start: BranchingNode = {
    id: newId(),
    title: "",
    text: "",
    choices: [good, mixed, bad].map(ending => ({ id: newId(), text: "", nextNodeId: ending.id })),
  };
  return {
    intro: "",
    settings: { passScore: 70, maxAttempts: null },
    startNodeId: start.id,
    nodes: [start, good, mixed, bad],
  };
};

/** Scenes reachable from the start by following choices. */
export const reachableNodeIds = (content: BranchingScenarioContent): Set<string> => {
  const byId = new Map(content.nodes.map(node => [node.id, node]));
  const seen = new Set<string>();
  const stack = [content.startNodeId];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id) || !byId.has(id)) continue;
    seen.add(id);
    for (const choice of byId.get(id)!.choices ?? []) stack.push(choice.nextNodeId);
  }
  return seen;
};

/** Scenes from which at least one ending can be reached. */
export const canFinishNodeIds = (content: BranchingScenarioContent): Set<string> => {
  const done = new Set(content.nodes.filter(isEnding).map(node => node.id));
  let grew = true;
  while (grew) {
    grew = false;
    for (const node of content.nodes) {
      if (done.has(node.id)) continue;
      if ((node.choices ?? []).some(choice => done.has(choice.nextNodeId))) {
        done.add(node.id);
        grew = true;
      }
    }
  }
  return done;
};

export interface BranchingProblem {
  /** The scene the problem belongs to, or null for a whole-scenario problem. */
  nodeId: string | null;
  message: string;
}

const sceneName = (node: BranchingNode, index: number) =>
  node.title?.trim() ? `"${node.title.trim()}"` : `Scene ${index + 1}`;

/** Plain-language problems, in the order a trainer would fix them. Empty = ready to save. */
export const validateBranching = (
  content: BranchingScenarioContent | undefined,
): BranchingProblem[] => {
  const problems: BranchingProblem[] = [];
  if (!content || content.nodes.length === 0) {
    return [{ nodeId: null, message: "Add at least one scene." }];
  }
  const add = (nodeId: string | null, message: string) => problems.push({ nodeId, message });

  if (content.nodes.length > MAX_BRANCHING_NODES) {
    add(null, `A scenario can have at most ${MAX_BRANCHING_NODES} scenes.`);
  }
  const ids = new Set(content.nodes.map(node => node.id));
  if (!ids.has(content.startNodeId)) add(null, "Pick which scene the learner starts on.");

  const choiceIds = new Set<string>();
  let endings = 0;
  content.nodes.forEach((node, index) => {
    const name = sceneName(node, index);
    if (!node.text?.trim()) add(node.id, `${name} needs some text.`);
    if ((node.text ?? "").length > MAX_BRANCHING_NODE_TEXT) {
      add(node.id, `${name}: text must be ${MAX_BRANCHING_NODE_TEXT} characters or fewer.`);
    }
    if ((node.title ?? "").length > MAX_BRANCHING_TITLE) {
      add(node.id, `${name}: title must be ${MAX_BRANCHING_TITLE} characters or fewer.`);
    }
    if (node.image) {
      if (!node.image.url.startsWith("https://")) {
        add(node.id, `${name}: the image must be an uploaded file.`);
      }
      if ((node.image.alt ?? "").length > MAX_QUESTION_MEDIA_ALT_LENGTH) {
        add(
          node.id,
          `${name}: image description must be ${MAX_QUESTION_MEDIA_ALT_LENGTH} characters or fewer.`,
        );
      }
    }

    if (isEnding(node)) {
      endings += 1;
      if (
        node.score != null &&
        (!Number.isInteger(node.score) || node.score < 0 || node.score > 100)
      ) {
        add(node.id, `${name}: score must be a whole number from 0 to 100.`);
      }
      if ((node.takeaway ?? "").length > MAX_BRANCHING_TAKEAWAY) {
        add(node.id, `${name}: takeaway must be ${MAX_BRANCHING_TAKEAWAY} characters or fewer.`);
      }
      return;
    }

    const choices = node.choices ?? [];
    if (choices.length < MIN_BRANCHING_CHOICES || choices.length > MAX_BRANCHING_CHOICES) {
      add(
        node.id,
        `${name} needs ${MIN_BRANCHING_CHOICES} to ${MAX_BRANCHING_CHOICES} choices, or none to be an ending.`,
      );
    }
    choices.forEach((choice, choiceIndex) => {
      const which = `${name}, choice ${choiceIndex + 1}`;
      if (choiceIds.has(choice.id)) add(node.id, `${which}: duplicate choice.`);
      choiceIds.add(choice.id);
      if (!choice.text?.trim()) add(node.id, `${which} needs some text.`);
      if ((choice.text ?? "").length > MAX_BRANCHING_CHOICE_TEXT) {
        add(node.id, `${which}: text must be ${MAX_BRANCHING_CHOICE_TEXT} characters or fewer.`);
      }
      if (!ids.has(choice.nextNodeId)) add(node.id, `${which}: pick where it leads.`);
    });
  });
  if (endings === 0) add(null, "Add at least one ending, a scene with no choices.");

  const passScore = content.settings?.passScore;
  if (passScore != null && (!Number.isInteger(passScore) || passScore < 0 || passScore > 100)) {
    add(null, "The pass mark must be a whole number from 0 to 100.");
  }
  const attempts = content.settings?.maxAttempts;
  if (attempts != null && (!Number.isInteger(attempts) || attempts < 1)) {
    add(null, "Attempts must be a whole number of 1 or more.");
  }
  if (passScore && endings > 0) {
    const best = Math.max(...content.nodes.filter(isEnding).map(endingScore));
    if (best < passScore) {
      add(
        null,
        `No ending scores ${passScore} or more, so nobody could pass. Raise an ending's score or lower the pass mark.`,
      );
    }
  }

  if (ids.has(content.startNodeId)) {
    const reachable = reachableNodeIds(content);
    content.nodes.forEach((node, index) => {
      if (!reachable.has(node.id)) {
        add(node.id, `${sceneName(node, index)} can't be reached from the first scene.`);
      }
    });
    const canFinish = canFinishNodeIds(content);
    content.nodes.forEach((node, index) => {
      if (!canFinish.has(node.id)) {
        add(node.id, `${sceneName(node, index)} has no way to reach an ending.`);
      }
    });
  }
  return problems;
};

/** The payload content: blanks dropped, and outcome/score/takeaway only on endings. */
export const serializeBranching = (content: BranchingScenarioContent): BranchingScenarioContent => {
  const trimmed = (value?: string) => (value && value.trim() ? value : undefined);
  const passScore = content.settings?.passScore;
  return {
    ...(trimmed(content.intro) ? { intro: content.intro } : {}),
    settings: {
      passScore: passScore ?? 0,
      maxAttempts: content.settings?.maxAttempts ?? null,
    },
    startNodeId: content.startNodeId,
    nodes: content.nodes.map(node => {
      const ending = isEnding(node);
      return {
        id: node.id,
        ...(trimmed(node.title) ? { title: node.title } : {}),
        text: node.text,
        ...(node.image
          ? {
              image: {
                url: node.image.url,
                ...(trimmed(node.image.alt) ? { alt: node.image.alt } : {}),
              },
            }
          : {}),
        ...(ending
          ? {
              ...(node.outcome ? { outcome: node.outcome } : {}),
              ...(node.score != null ? { score: node.score } : {}),
              ...(trimmed(node.takeaway) ? { takeaway: node.takeaway } : {}),
            }
          : {
              choices: (node.choices ?? []).map(choice => ({
                id: choice.id,
                text: choice.text,
                nextNodeId: choice.nextNodeId,
              })),
            }),
      };
    }),
  };
};

export interface BranchingRunResult {
  node: BranchingNode;
  score: number;
  /** null when the scenario is ungated. */
  passed: boolean | null;
}

/** Result of finishing on `node` under the scenario's pass mark (used by the in-editor preview). */
export const runResult = (
  content: BranchingScenarioContent,
  node: BranchingNode,
): BranchingRunResult => {
  const score = endingScore(node);
  const passScore = content.settings?.passScore ?? 0;
  return { node, score, passed: passScore > 0 ? score >= passScore : null };
};

/* ---- Flow-chart model: pure edits and the automatic layout ---- */

export interface BranchingPoint {
  x: number;
  y: number;
}

/** Spacing the canvas lays scenes out on (node cards are narrower than a column). */
export const BRANCHING_COLUMN_WIDTH = 480;
export const BRANCHING_ROW_HEIGHT = 130;
const UNREACHABLE_PER_ROW = 5;

/**
 * Left-to-right layout. A scene's column is its shortest distance from the start,
 * so branches fan out and re-joins/loops simply sit where they are first reached.
 * Within a column scenes sit near the average height of the scenes leading to them
 * and are pushed apart so none overlap. Scenes the start can't reach go in a grid below.
 */
export const layoutBranching = (content: BranchingScenarioContent): Map<string, BranchingPoint> => {
  const byId = new Map(content.nodes.map(node => [node.id, node]));
  const layerOf = new Map<string, number>();
  const layers: string[][] = [];
  if (byId.has(content.startNodeId)) {
    layerOf.set(content.startNodeId, 0);
    const queue = [content.startNodeId];
    for (let head = 0; head < queue.length; head += 1) {
      const id = queue[head];
      const layer = layerOf.get(id)!;
      (layers[layer] ??= []).push(id);
      for (const choice of byId.get(id)!.choices ?? []) {
        if (byId.has(choice.nextNodeId) && !layerOf.has(choice.nextNodeId)) {
          layerOf.set(choice.nextNodeId, layer + 1);
          queue.push(choice.nextNodeId);
        }
      }
    }
  }

  const parents = new Map<string, string[]>();
  for (const id of layerOf.keys()) {
    for (const choice of byId.get(id)!.choices ?? []) {
      if ((layerOf.get(choice.nextNodeId) ?? -1) > layerOf.get(id)!) {
        parents.set(choice.nextNodeId, [...(parents.get(choice.nextNodeId) ?? []), id]);
      }
    }
  }

  const rowY = new Map<string, number>();
  const result = new Map<string, BranchingPoint>();
  layers.forEach((ids, layer) => {
    const desired = ids.map((id, order) => {
      const above = (parents.get(id) ?? []).map(parent => rowY.get(parent) ?? 0);
      return {
        id,
        order,
        y: above.length ? above.reduce((sum, y) => sum + y, 0) / above.length : 0,
      };
    });
    desired.sort((a, b) => a.y - b.y || a.order - b.order);
    const placed: number[] = [];
    desired.forEach((entry, i) => {
      placed.push(i === 0 ? entry.y : Math.max(entry.y, placed[i - 1] + BRANCHING_ROW_HEIGHT));
    });
    const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;
    const shift = mean(desired.map(entry => entry.y)) - mean(placed);
    desired.forEach((entry, i) => {
      const y = placed[i] + shift;
      rowY.set(entry.id, y);
      result.set(entry.id, { x: layer * BRANCHING_COLUMN_WIDTH, y });
    });
  });

  const minY = Math.min(0, ...[...result.values()].map(point => point.y));
  const maxY = Math.max(0, ...[...result.values()].map(point => point.y - minY));
  for (const point of result.values()) point.y -= minY;

  const orphans = content.nodes.filter(node => !layerOf.has(node.id));
  const baseY = layers.length ? maxY + BRANCHING_ROW_HEIGHT * 1.5 : 0;
  orphans.forEach((node, i) => {
    result.set(node.id, {
      x: (i % UNREACHABLE_PER_ROW) * BRANCHING_COLUMN_WIDTH,
      y: baseY + Math.floor(i / UNREACHABLE_PER_ROW) * BRANCHING_ROW_HEIGHT,
    });
  });
  return result;
};

const NEW_CHOICE_TEXT = "New choice";

const newChoice = (nextNodeId: string) => ({
  id: newId(),
  text: NEW_CHOICE_TEXT,
  nextNodeId,
});

/** Why the canvas '+' on this scene can't add a step, or null when it can. */
export const addStepBlockedReason = (
  content: BranchingScenarioContent,
  nodeId: string,
): string | null => {
  const node = content.nodes.find(candidate => candidate.id === nodeId);
  if (!node) return "That scene no longer exists.";
  const ending = isEnding(node);
  const needed = ending ? MIN_BRANCHING_CHOICES : 1;
  if (content.nodes.length + needed > MAX_BRANCHING_NODES) {
    return `A scenario can have at most ${MAX_BRANCHING_NODES} scenes.`;
  }
  if (!ending && (node.choices ?? []).length >= MAX_BRANCHING_CHOICES) {
    return `A scene can have at most ${MAX_BRANCHING_CHOICES} choices.`;
  }
  return null;
};

/**
 * Adds a choice plus the new scene it leads to. On an ending this turns it into a
 * decision with two new scenes (its outcome, score and takeaway are cleared, as
 * when switching it to a decision in the form). Returns the first new scene's id.
 */
export const addStep = (
  content: BranchingScenarioContent,
  nodeId: string,
): { content: BranchingScenarioContent; newNodeId: string } | null => {
  if (addStepBlockedReason(content, nodeId)) return null;
  const node = content.nodes.find(candidate => candidate.id === nodeId)!;
  const scenes = Array.from({ length: isEnding(node) ? MIN_BRANCHING_CHOICES : 1 }, () =>
    createEnding(),
  );
  const added = scenes.map(scene => newChoice(scene.id));
  const edited: BranchingNode = isEnding(node)
    ? { ...node, choices: added, outcome: undefined, score: undefined, takeaway: undefined }
    : { ...node, choices: [...(node.choices ?? []), ...added] };
  return {
    content: {
      ...content,
      nodes: [...content.nodes.map(n => (n.id === nodeId ? edited : n)), ...scenes],
    },
    newNodeId: scenes[0].id,
  };
};

/**
 * Points a choice of `sourceId` at `targetId` (how branches re-join). A choice still
 * without a destination is filled in first; otherwise a "New choice" is added.
 * Null when the connection isn't possible (an ending, itself, a duplicate, or full).
 */
export const connectChoice = (
  content: BranchingScenarioContent,
  sourceId: string,
  targetId: string,
): BranchingScenarioContent | null => {
  const ids = new Set(content.nodes.map(node => node.id));
  const source = content.nodes.find(node => node.id === sourceId);
  if (!source || isEnding(source) || !ids.has(targetId) || sourceId === targetId) return null;
  const choices = source.choices ?? [];
  if (choices.some(choice => choice.nextNodeId === targetId)) return null;
  const open = choices.find(choice => !ids.has(choice.nextNodeId));
  let next;
  if (open) {
    next = choices.map(choice => (choice === open ? { ...choice, nextNodeId: targetId } : choice));
  } else if (choices.length < MAX_BRANCHING_CHOICES) {
    next = [...choices, newChoice(targetId)];
  } else {
    return null;
  }
  return {
    ...content,
    nodes: content.nodes.map(node => (node.id === sourceId ? { ...node, choices: next } : node)),
  };
};

/** Drops one choice. Null when it is the scene's last (that would silently make it an ending). */
export const removeChoiceFromNode = (
  content: BranchingScenarioContent,
  nodeId: string,
  choiceId: string,
): BranchingScenarioContent | null => {
  const node = content.nodes.find(candidate => candidate.id === nodeId);
  if (!node || (node.choices ?? []).length <= 1) return null;
  return {
    ...content,
    nodes: content.nodes.map(n =>
      n.id === nodeId ? { ...n, choices: (n.choices ?? []).filter(c => c.id !== choiceId) } : n,
    ),
  };
};
