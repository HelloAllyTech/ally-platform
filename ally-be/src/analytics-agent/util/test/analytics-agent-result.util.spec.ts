import { AnalyticsAgentOutcome } from '../../dto/analytics-agent.dto';
import { resultFieldsFromRun } from '../analytics-agent-result.util';

const run = (sqlQueries: unknown[]) =>
  ({
    durationMs: 1234,
    config: { model: 'gpt-x' },
    sqlQueries,
  }) as Parameters<typeof resultFieldsFromRun>[0];

describe('resultFieldsFromRun', () => {
  it('shows the rows of the last query that ran, and the run timing and model', () => {
    const out = resultFieldsFromRun(
      run([
        {
          status: 'success',
          columns: [{ name: 'a' }],
          rows: [{ a: '1' }],
          rowsSampled: false,
        },
        {
          status: 'success',
          columns: [{ name: 'org' }, { name: 'n' }],
          rows: [{ org: 'x', n: '3' }],
          rowsSampled: true,
        },
        { status: 'error', columns: null, rows: null, rowsSampled: false },
      ]),
    );
    expect(out).toMatchObject({
      outcome: AnalyticsAgentOutcome.ANSWER,
      message: '',
      columns: ['org', 'n'],
      rows: [{ org: 'x', n: '3' }],
      rowCount: 1,
      truncated: true,
      durationMs: 1234,
      provenance: { plannerModel: 'gpt-x', answerModel: 'gpt-x' },
    });
  });

  it('is a plain answer with no table when the agent ran no SQL', () => {
    expect(resultFieldsFromRun(run([]))).toMatchObject({
      outcome: AnalyticsAgentOutcome.ANSWER,
      columns: [],
      rows: [],
      rowCount: 0,
      truncated: false,
    });
  });

  it('is failed when SQL ran and every query failed', () => {
    const out = resultFieldsFromRun(
      run([{ status: 'error', columns: null, rows: null, rowsSampled: false }]),
    );
    expect(out.outcome).toBe(AnalyticsAgentOutcome.FAILED);
    expect(out.message).not.toBe('');
    expect(out.rows).toEqual([]);
  });

  it('leaves rows out when they did not come back keyed by column', () => {
    const out = resultFieldsFromRun(
      run([
        {
          status: 'success',
          columns: [{ name: 'a' }],
          rows: [[1], 'x'],
          rowsSampled: false,
        },
      ]),
    );
    expect(out.rows).toEqual([]);
    expect(out.columns).toEqual([]);
  });
});
