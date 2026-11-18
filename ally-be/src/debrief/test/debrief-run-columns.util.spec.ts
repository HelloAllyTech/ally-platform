import {
  judgeModelSql,
  judgeOverallSql,
  judgePromptVersionSql,
  languageSourceSql,
  retriesSql,
} from '../util/debrief-run-columns.util';

describe('facts a run keeps as a column and, still, in workspace', () => {
  it('reads the column first and falls back to the workspace copy, with or without an alias', () => {
    expect(judgeOverallSql('r')).toBe(
      `COALESCE(r."judgeOverall"::float, (r.workspace->'judge'->>'overall')::float)`,
    );
    expect(judgeOverallSql()).toBe(
      `COALESCE("judgeOverall"::float, (workspace->'judge'->>'overall')::float)`,
    );
    expect(judgeModelSql('r')).toBe(
      `COALESCE(r."judgeModel", r.workspace->'judge'->>'model')`,
    );
    expect(judgePromptVersionSql()).toBe(
      `COALESCE("judgePromptVersion", workspace->'judge'->>'promptVersion')`,
    );
    expect(languageSourceSql('r')).toBe(
      `COALESCE(r."languageSource", r.workspace->>'languageSource')`,
    );
  });

  it('counts retries as the larger of the two, so an older instance’s increment still counts', () => {
    expect(retriesSql()).toBe(
      `GREATEST(COALESCE("retries", 0), COALESCE((workspace->>'retries')::int, 0))`,
    );
  });
});
