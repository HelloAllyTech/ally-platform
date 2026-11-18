import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateScenarioDto } from '../../learn/dto/create-scenario.dto';
import { UpdateScenarioDto } from '../../learn/dto/update-scenario.dto';
import { cueBringsSupportLines } from '../service/debrief-agent.service';
import { runRiskCueFacts } from '../util/debrief-risk-cue.util';
import { AddDebriefRunRiskCueHandling1984430000000 } from '../../database/migrations/1984430000000-AddDebriefRunRiskCueHandling';

describe('what a run recorded about its risk-cue handling, through one accessor', () => {
  it('prefers the checked column and falls back to the workspace snapshot', () => {
    expect(runRiskCueFacts({ riskCueHandling: 'assessed' })).toMatchObject({
      handling: 'assessed',
      known: true,
      assessed: true,
    });
    expect(
      runRiskCueFacts({
        workspace: {
          riskCueOption: { handling: 'assessed', supportLinesOnCue: false },
        },
      }),
    ).toMatchObject({
      handling: 'assessed',
      assessed: true,
      supportLinesOnCue: false,
    });
    // The column wins over a disagreeing snapshot.
    expect(
      runRiskCueFacts({
        riskCueHandling: 'alarm',
        workspace: { riskCueOption: { handling: 'assessed' } },
      }).assessed,
    ).toBe(false);
  });

  it('reads a run from before risk-cue choices as unknown, which behaves as it always did', () => {
    expect(runRiskCueFacts({})).toMatchObject({
      handling: null,
      known: false,
      supportLinesOnCue: true,
    });
    expect(
      runRiskCueFacts({ riskCueHandling: 'nonsense' }).handling,
    ).toBeNull();
    expect(cueBringsSupportLines({ hasRiskCue: true })).toBe(true);
    expect(cueBringsSupportLines({ hasRiskCue: false })).toBe(false);
  });

  it('under assessed handling, only a cue not marked as the practice brings the support lines', () => {
    const cues = (...practised: boolean[]) => ({
      safety: { risk_cues: practised.map((p) => ({ part_of_practice: p })) },
    });
    const base = { hasRiskCue: true, riskCueHandling: 'assessed' };
    expect(cueBringsSupportLines({ ...base, workspace: cues(true) })).toBe(
      false,
    );
    expect(
      cueBringsSupportLines({ ...base, workspace: cues(true, false) }),
    ).toBe(true);
    // No readable cues: the lines show, the safe side.
    expect(cueBringsSupportLines({ ...base, workspace: {} })).toBe(true);
  });
});

describe('a roleplay’s saved risk-cue choice is checked', () => {
  const check = async (cls: any, value: unknown) =>
    (
      await validate(plainToInstance(cls, { debriefRiskCueOption: value }), {
        skipMissingProperties: true,
      })
    ).filter((e) => e.property === 'debriefRiskCueOption');

  it.each([
    ['create', CreateScenarioDto],
    ['update', UpdateScenarioDto],
  ])(
    '%s: accepts the two known keys and unset, rejects anything else',
    async (_n, cls) => {
      expect(await check(cls, 'part_of_practice')).toEqual([]);
      expect(await check(cls, 'standard')).toEqual([]);
      expect(await check(cls, null)).toEqual([]);
      expect(await check(cls, undefined)).toEqual([]);
      expect((await check(cls, 'peer')).length).toBe(1);
      expect((await check(cls, 'PART_OF_PRACTICE')).length).toBe(1);
    },
  );
});

describe('AddDebriefRunRiskCueHandling', () => {
  it('only adds a checked column and fills empty ones; goes back by dropping it', async () => {
    const run = async (dir: 'up' | 'down') => {
      const q: string[] = [];
      await new AddDebriefRunRiskCueHandling1984430000000()[dir]({
        query: async (s: string) => void q.push(s),
      } as any);
      return q.join('\n');
    };
    const up = await run('up');
    expect(up).toContain('ADD COLUMN IF NOT EXISTS "riskCueHandling"');
    expect(up).toContain("IN ('alarm', 'assessed')");
    expect(up).toContain('WHERE "riskCueHandling" IS NULL');
    expect(up).not.toMatch(/DROP|DELETE|TRUNCATE/i);
    const down = await run('down');
    expect(down).toContain('DROP COLUMN IF EXISTS "riskCueHandling"');
  });
});
