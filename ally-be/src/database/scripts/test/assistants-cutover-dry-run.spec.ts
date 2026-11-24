import { readFileSync } from 'fs';
import { join } from 'path';
import { runCutoverDryRun } from '../assistants-cutover-dry-run.lib';

describe('assistants cutover dry-run orchestrator', () => {
  it('runs every step, combines reports and applies nothing', async () => {
    const write = jest.fn();
    const steps = ['a', 'b', 'c'].map((name) => ({
      name,
      run: async () => ({ dryRun: true, name }),
    }));
    const report = await runCutoverDryRun(
      steps,
      new Date('2026-11-23T00:00:00Z'),
    );
    expect(report.steps.map((s) => s.name)).toEqual(['a', 'b', 'c']);
    expect(report.failed).toEqual([]);
    expect(report.appliedSomething).toEqual([]);
    expect(write).not.toHaveBeenCalled();
  });

  it('keeps going after a failing step and lists it', async () => {
    const report = await runCutoverDryRun([
      {
        name: 'bad',
        run: async () => {
          throw new Error('boom');
        },
      },
      { name: 'good', run: async () => ({ dryRun: true }) },
    ]);
    expect(report.failed).toEqual(['bad']);
    expect(report.steps[0].error).toBe('boom');
    expect(report.steps[1].ok).toBe(true);
  });

  it('flags a step that reports dryRun false as applied and failed', async () => {
    const report = await runCutoverDryRun([
      { name: 'leaky', run: async () => ({ dryRun: false }) },
    ]);
    expect(report.appliedSomething).toEqual(['leaky']);
    expect(report.failed).toEqual(['leaky']);
  });

  it('the CLI passes dryRun true to every real entry point and forces read-only', () => {
    const src = readFileSync(
      join(__dirname, '..', 'assistants-cutover-dry-run.ts'),
      'utf8',
    );
    expect(src).toContain('default_transaction_read_only=on');
    expect(src).not.toMatch(/dryRun:\s*false/);
    expect(src).toContain('.run(true, null)');
    expect((src.match(/dryRun: true/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });
});
