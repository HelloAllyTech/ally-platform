import {
  ROADMAP_QUALITY_DIMENSIONS,
  ROADMAP_QUALITY_PASS_SCORE,
  ROADMAP_QUALITY_SCALE_MAX,
  ROADMAP_SINGLE_IDEA_EFFORTS,
  ROADMAP_SLICES,
} from '../constants/product-roadmap.constants';

/** One graded dimension, as stored on a draft and shown to the author. */
export interface RoadmapQualityDimension {
  id: string;
  label: string;
  /** 0 absent · 1 vague · 2 adequate · 3 specific · 4 specific and evidenced. */
  score: number;
  weight: number;
  floor: number;
  note: string;
}

export interface RoadmapQuality {
  /** 0–100, computed here from the dimension scores. The model never supplies it. */
  score: number;
  passScore: number;
  scaleMax: number;
  /** Score at or over the pass mark AND no floored dimension under its floor. */
  passed: boolean;
  dimensions: RoadmapQualityDimension[];
  /** The dimension to work on next: the biggest weighted shortfall, floors first. Null when full marks. */
  weakest: string | null;
}

const clampScore = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(ROADMAP_QUALITY_SCALE_MAX, Math.max(0, Math.round(n)));
};

/**
 * Turn the model's per-dimension grades into the quality verdict.
 *
 * Fails CLOSED, like the gates: a missing dimension, a non-number or an unknown shape is a 0,
 * never a pass. Extra dimension ids are ignored. The total and `passed` are computed here so a
 * model that says "looks great, 100" cannot move the bar.
 */
export function gradeQuality(submitted: unknown): RoadmapQuality {
  const list = Array.isArray(submitted) ? submitted : [];
  const byId = new Map<string, { score?: unknown; note?: unknown }>();
  for (const entry of list) {
    if (entry && typeof entry.id === 'string') byId.set(entry.id, entry);
  }

  const dimensions: RoadmapQualityDimension[] = ROADMAP_QUALITY_DIMENSIONS.map(
    (d) => {
      const answer = byId.get(d.id);
      return {
        id: d.id,
        label: d.label,
        score: clampScore(answer?.score),
        weight: d.weight,
        floor: d.floor,
        note:
          (typeof answer?.note === 'string' &&
            answer.note.trim().slice(0, 240)) ||
          'Not assessed yet.',
      };
    },
  );

  const raw = dimensions.reduce(
    (sum, d) => sum + (d.weight * d.score) / ROADMAP_QUALITY_SCALE_MAX,
    0,
  );
  // One decimal: 67.5 must stay 67.5 rather than rounding up across a pass mark of 68.
  const score = Math.round(raw * 10) / 10;
  const belowFloor = dimensions.filter((d) => d.score < d.floor);

  const shortfall = (d: RoadmapQualityDimension) =>
    (d.weight * (ROADMAP_QUALITY_SCALE_MAX - d.score)) /
    ROADMAP_QUALITY_SCALE_MAX;
  const pool = belowFloor.length ? belowFloor : dimensions;
  const worst = [...pool].sort((a, b) => shortfall(b) - shortfall(a))[0];

  return {
    score,
    passScore: ROADMAP_QUALITY_PASS_SCORE,
    scaleMax: ROADMAP_QUALITY_SCALE_MAX,
    passed: score >= ROADMAP_QUALITY_PASS_SCORE && belowFloor.length === 0,
    dimensions,
    weakest: worst && shortfall(worst) > 0 ? worst.id : null,
  };
}

/** True for a size one idea may be filed at through the interview (S, M or L). */
export const isSingleIdeaEffort = (effort: unknown): boolean =>
  typeof effort === 'string' &&
  (ROADMAP_SINGLE_IDEA_EFFORTS as readonly string[]).includes(effort);

/** A slice of a too-big idea: independently shippable, each filed as its own idea. */
export interface RoadmapSlice {
  title: string | null;
  description: string;
  effort: string;
  productGoal: string | null;
}

/**
 * Clean the model's proposed split. All or nothing: a split is only useful if EVERY slice is
 * fileable, so one slice that is blank or still too big voids the lot and the interview keeps
 * asking, rather than handing the author a split they cannot use.
 */
export function normaliseSlices(
  submitted: unknown,
  productGoalNames: string[],
  limits: { descriptionMax: number; titleMax: number },
): RoadmapSlice[] {
  if (!Array.isArray(submitted)) return [];
  const slices: RoadmapSlice[] = [];
  for (const raw of submitted) {
    const description =
      typeof raw?.description === 'string'
        ? raw.description.trim().slice(0, limits.descriptionMax)
        : '';
    const effort =
      typeof raw?.effort === 'string' ? raw.effort.trim().toLowerCase() : '';
    if (!description || !isSingleIdeaEffort(effort)) return [];
    const title =
      typeof raw?.title === 'string'
        ? raw.title.replace(/\s+/g, ' ').trim().slice(0, limits.titleMax)
        : '';
    slices.push({
      title: title || null,
      description,
      effort,
      productGoal: productGoalNames.includes(raw?.productGoal)
        ? raw.productGoal
        : null,
    });
  }
  return slices.length >= ROADMAP_SLICES.MIN &&
    slices.length <= ROADMAP_SLICES.MAX
    ? slices
    : [];
}
