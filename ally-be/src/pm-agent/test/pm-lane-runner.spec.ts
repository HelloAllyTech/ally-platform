import 'reflect-metadata';
import { PmCardCategory, PmLane } from '../enum/pm-agent.enum';
import { PM_LANES } from '../lane/pm-lane-definitions';
import { PmLaneRunner } from '../lane/pm-lane-runner';
import { PmEvidenceRef } from '../pipeline/pm-pipeline.types';
import { PmRunLedger } from '../util/run-ledger';
import {
  callTool,
  evidenceIdsIn,
  FakeLlm,
  FakeToolbox,
  recCandidate,
  Script,
  submitTurn,
  turn,
} from './pm-pipeline.fakes';

const RUN_ID = '11111111-1111-4111-8111-111111111111';

function setup(script: Script, budget = 5) {
  const llm = new FakeLlm(script);
  const toolbox = new FakeToolbox();
  const runner = new PmLaneRunner(llm, toolbox);
  const runEvidence = new Map<string, PmEvidenceRef>();
  const run = (lane: PmLane = PmLane.ANALYTICS) =>
    runner.run({
      runId: RUN_ID,
      definition: PM_LANES[lane],
      target: { provider: 'openai', model: 'gpt-5-mini' },
      promptVersion: 1,
      system: [{ text: 'system' }],
      userMessage: 'go',
      maxCandidates: 3,
      ledger: new PmRunLedger(budget, 0),
      deadline: Date.now() + 60_000,
      runEvidence,
    });
  return { llm, toolbox, run, runEvidence };
}

describe('PmLaneRunner', () => {
  it('researches, then returns schema-valid candidates citing this run’s evidence', async () => {
    const { run, toolbox } = setup((req) =>
      evidenceIdsIn(req).length
        ? submitTurn([recCandidate(0, evidenceIdsIn(req))])
        : callTool('analytics_section', { section: 'learnerActivation' }),
    );
    const result = await run();
    expect(result.outcome).toBe('ok');
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].payload.schemaVersion).toBe(1);
    expect(toolbox.calls).toHaveLength(1);
  });

  it('sends invalid candidates back once, keeps the valid ones, then discards what is still invalid', async () => {
    let submits = 0;
    const { run, llm } = setup((req) => {
      const ids = evidenceIdsIn(req);
      if (!ids.length) return callTool('analytics_section', {});
      submits += 1;
      const tooLong = recCandidate(1, ids, PmCardCategory.PRODUCT, {
        title:
          'This title is far too long to ever pass the twelve word limit set by code',
      });
      return submits === 1
        ? submitTurn([recCandidate(0, ids), tooLong])
        : submitTurn([tooLong]);
    });
    const result = await run();
    expect(result.repaired).toBe(true);
    expect(submits).toBe(2);
    expect(result.candidates.map((c) => c.payload.title)).toEqual([
      'Show streak count before each roleplay starts',
    ]);
    expect(result.discarded).toHaveLength(1);
    // The repair pass offered only submit_candidates.
    expect(llm.calls[llm.calls.length - 1].tools.map((t) => t.name)).toEqual([
      'submit_candidates',
    ]);
    const repairMessage = JSON.stringify(
      llm.calls[llm.calls.length - 1].messages,
    );
    expect(repairMessage).toContain('title must be at most 12 words');
  });

  it('rejects evidence ids that were not fetched in this run', async () => {
    const forged = '22222222-2222-4222-8222-222222222222';
    const { run } = setup((req) =>
      evidenceIdsIn(req).length
        ? submitTurn([recCandidate(0, [forged])])
        : callTool('analytics_section', {}),
    );
    const result = await run();
    expect(result.candidates).toHaveLength(0);
    expect(result.outcome).toBe('discarded');
    expect(result.discarded.flat().join(' ')).toContain(
      'was not returned by a tool in this run',
    );
  });

  it('refuses tools outside the lane allow-list without running them', async () => {
    let pass = 0;
    const { run, toolbox, llm } = setup(() => {
      pass += 1;
      if (pass === 1) return callTool('accept_card', { id: 'x' });
      return submitTurn([]);
    });
    const result = await run();
    expect(toolbox.calls).toHaveLength(0);
    expect(JSON.stringify(llm.calls[1].messages)).toContain(
      'is not available in this lane',
    );
    expect(result.outcome).toBe('ok');
  });

  it('nudges once when the model answers in prose, then gives it only the submit tool', async () => {
    let pass = 0;
    const { run, llm } = setup(() => {
      pass += 1;
      return pass === 1
        ? turn([{ type: 'text', text: 'Here are my ideas…' }], 'end_turn')
        : submitTurn([]);
    });
    const result = await run();
    expect(result.outcome).toBe('ok');
    expect(llm.calls[1].tools.map((t) => t.name)).toEqual([
      'submit_candidates',
    ]);
  });

  it('ignores a pass cut off at max_tokens (its tool call may be a fragment)', async () => {
    let pass = 0;
    const { run, toolbox } = setup(() => {
      pass += 1;
      if (pass === 1) {
        return turn(
          [
            {
              type: 'tool_use',
              id: 'tu_1',
              name: 'analytics_section',
              input: {},
            },
          ],
          'max_tokens',
        );
      }
      return submitTurn([]);
    });
    await run();
    expect(toolbox.calls).toHaveLength(0);
  });

  it('ends with `budget` when a pass cannot reserve, without calling the model', async () => {
    const { run, llm } = setup(() => submitTurn([]), 0.0001);
    const result = await run();
    expect(result.outcome).toBe('budget');
    expect(llm.calls).toHaveLength(0);
  });

  it('stops at MAX_PASSES even if the model keeps researching', async () => {
    const { run, llm } = setup(() => callTool('analytics_section', {}));
    const result = await run();
    expect(llm.calls.length).toBeLessThanOrEqual(6);
    expect(result.candidates).toHaveLength(0);
  });
});
