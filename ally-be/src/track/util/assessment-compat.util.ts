import { DataSource } from 'typeorm';

export interface ScenarioComparability {
  comparable: boolean;
  /** Behaviour names the pre scenario scores and the post doesn't. */
  onlyInPre: string[];
  /** Behaviour names the post scenario scores and the pre doesn't. */
  onlyInPost: string[];
}

/**
 * Whether two roleplays score the same behaviours, so a pre→post gain
 * compares like with like. Behaviours come from each scenario's live
 * behaviour instructions. A mismatched pair is still allowed — the builder
 * warns and the trainer report carries the caveat — it is never a block.
 */
export async function compareScenarioBehaviours(
  dataSource: DataSource,
  preScenarioId: number | null | undefined,
  postScenarioId: number | null | undefined,
): Promise<ScenarioComparability> {
  if (!preScenarioId || !postScenarioId) {
    return { comparable: false, onlyInPre: [], onlyInPost: [] };
  }
  if (preScenarioId === postScenarioId) {
    return { comparable: true, onlyInPre: [], onlyInPost: [] };
  }
  const rows: Array<{ scenarioId: number; name: string }> =
    await dataSource.query(
      `SELECT DISTINCT sbi."scenarioId" AS "scenarioId", b.name AS "name"
         FROM scenario_behavior_instructions sbi
         JOIN scenario_behavior_instruction_behaviors sbib
           ON sbib."scenarioBehaviorInstructionId" = sbi.id
         JOIN behaviors b ON b.id = sbib."behaviorId"
        WHERE sbi."scenarioId" = ANY($1::int[])
          AND sbi."deletedAt" IS NULL`,
      [[preScenarioId, postScenarioId]],
    );
  const names = (scenarioId: number) =>
    new Set(
      rows
        .filter((row) => Number(row.scenarioId) === scenarioId)
        .map((row) => row.name),
    );
  const pre = names(preScenarioId);
  const post = names(postScenarioId);
  const onlyInPre = [...pre].filter((name) => !post.has(name)).sort();
  const onlyInPost = [...post].filter((name) => !pre.has(name)).sort();
  return {
    comparable: onlyInPre.length === 0 && onlyInPost.length === 0,
    onlyInPre,
    onlyInPost,
  };
}
