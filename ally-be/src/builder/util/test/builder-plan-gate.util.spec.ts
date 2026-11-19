import {
  planGateExtras,
  renderPlanGateBlock,
  withPlanGate,
} from '../builder-plan-gate.util';
import { claimsPrdReady } from '../builder-turn-claims.util';

const readiness = (ready: boolean, hints: string[] = []) => ({
  score: ready ? 100 : 60,
  ready,
  sections: hints.map((hint, i) => ({
    key: `s${i}`,
    label: `S${i}`,
    ok: false,
    hint,
  })),
  blockers: hints,
});

const gate = (texts: string[]) => ({
  ready: texts.length === 0,
  prdEmpty: false,
  blockers: texts.map((text) => ({ kind: 'design' as const, text })),
});

describe('the plan gate in the interview', () => {
  it('adds only what Builder’s rubric does not already list', () => {
    expect(
      planGateExtras(
        readiness(false, ['Write the problem.']),
        gate([
          'Write the problem.',
          'Finish the PRD.',
          'Approve the technical design.',
        ]),
      ),
    ).toEqual(['Approve the technical design.']);
  });

  it('makes a PRD-ready session not ready while the design is open, so a "complete" claim is sent back', () => {
    const merged = withPlanGate(
      readiness(true),
      gate([
        'No technical design yet: draft one from the Design tab, then approve it.',
      ]),
    );
    expect(merged.ready).toBe(false);
    expect(merged.sections.filter((s) => !s.ok).map((s) => s.hint)).toEqual([
      'No technical design yet: draft one from the Design tab, then approve it.',
    ]);
    // The claim the production session kept making is the one this judges.
    expect(claimsPrdReady('The PRD is complete.')).toBe(true);
  });

  it('leaves readiness alone when the gate is clear or unknown', () => {
    const r = readiness(true);
    expect(withPlanGate(r, gate([]))).toBe(r);
    expect(withPlanGate(r, null)).toBe(r);
    expect(renderPlanGateBlock(r, null)).toBeNull();
  });

  it('renders the blockers for the turn', () => {
    const block = renderPlanGateBlock(
      readiness(true),
      gate(['Approve the technical design.']),
    );
    expect(block).toContain('<before_plan_closes>');
    expect(block).toContain('- Approve the technical design.');
    expect(block).toContain('set_success_measure');
  });
});
