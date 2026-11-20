import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import {
  DebriefGraphClient,
  DebriefGraphError,
} from '../service/debrief-graph.client';
import {
  DEBRIEF_CONTRACT_VERSION,
  DebriefContractError,
  normaliseGraphResponse,
} from '../util/debrief-graph-contract.util';

jest.mock('axios');

/**
 * The ally-be <-> ally-ai response contract, from the one fixture ally-ai's
 * `test_contract_fixture.py` also reads (docs/debrief-harness/contract-fixture-response.json).
 */
const FIXTURE = JSON.parse(
  fs.readFileSync(
    path.resolve(
      __dirname,
      '../../../../docs/debrief-harness/contract-fixture-response.json',
    ),
    'utf8',
  ),
);
const copy = () => JSON.parse(JSON.stringify(FIXTURE));

describe('reading ally-ai’s response', () => {
  it('reads the shared fixture with no warning and keeps what it does not know', () => {
    const { value, warnings } = normaliseGraphResponse(copy());
    expect(warnings).toEqual([]);
    expect(FIXTURE.contract_version).toBe(DEBRIEF_CONTRACT_VERSION);
    expect(value.status).toBe('published');
    expect(value.cards?.lead).toContain('You stayed');
    expect(value.steps?.[0].step).toBe('safety_reader');
    expect(value.check_failures).toHaveLength(1);
    // Unknown fields pass through, nested ones too.
    expect((value as any).a_top_level_field_added_later).toBe('tolerated');
    expect((value.steps?.[0] as any).a_field_added_later).toBe(true);
    expect((value.cards as any).a_card_added_later).toEqual({
      note: 'an unknown card must pass through untouched',
    });
  });

  it('fails the attempt as a clear contract error when the response cannot be read at all', () => {
    for (const bad of [null, 'x', [], {}, { status: '' }, { status: 5 }]) {
      expect(() => normaliseGraphResponse(bad)).toThrow(DebriefContractError);
    }
    expect(() => normaliseGraphResponse({})).toThrow(
      /debrief graph contract: the response has no status/,
    );
    const published = { ...copy(), cards: 'not cards' };
    expect(() => normaliseGraphResponse(published)).toThrow(
      /cards: expected an object/,
    );
    expect(new DebriefContractError('x').status).toBe(422);
  });

  it('drops a wrongly shaped optional field with a warning that names its path, and carries on', () => {
    const body = {
      ...copy(),
      steps: [{ step: 'writer' }, { label: 'no name' }, 'x'],
      logs: 'nope',
      evaluator_hard_fails: [
        { code: 'missed_risk_cue', evidence: 'e' },
        { evidence: 'no code' },
      ],
      check_failures: ['plain text', { detail: 'no code' }],
      fallback_rung: 'two',
      has_risk_cue: 'yes',
      workspace: 7,
      status: 'skipped',
      cards: 5,
    };
    const { value, warnings } = normaliseGraphResponse(body);
    expect(warnings).toEqual(
      expect.arrayContaining([
        'cards: expected an object or null',
        'steps[1]: expected a step with a name',
        'steps[2]: expected a step with a name',
        'logs: expected a list',
        'evaluator_hard_fails[1]: expected a hard fail with a code',
        'check_failures[1]: expected a check failure with a code',
        'fallback_rung: expected a number',
        'has_risk_cue: expected true or false',
        'workspace: expected an object',
      ]),
    );
    expect(value.steps).toEqual([{ step: 'writer' }]);
    expect(value.logs).toEqual([]);
    expect(value.evaluator_hard_fails).toHaveLength(1);
    expect(value.check_failures).toEqual(['plain text']);
    expect(value.fallback_rung).toBe(0);
    expect(value.has_risk_cue).toBe(true);
    expect(value.workspace).toEqual({});
    expect(value.cards).toBeNull();
  });

  it('warns about a version it does not know and treats a missing one as fine', () => {
    expect(
      normaliseGraphResponse({ ...copy(), contract_version: 2 }).warnings,
    ).toEqual(['contract_version: ally-ai speaks v2, ally-be reads v1']);
    const old = copy();
    delete old.contract_version;
    expect(normaliseGraphResponse(old).warnings).toEqual([]);
  });
});

describe('the graph client', () => {
  const post = axios.post as jest.Mock;
  const client = () =>
    new DebriefGraphClient({
      ai: { apiUrl: 'http://ai', outboundApiKey: 'k' },
    } as any);

  beforeEach(() => post.mockReset());

  it('returns the normalised response', async () => {
    post.mockResolvedValue({ data: copy() });
    const res = await client().run({ run_id: 'r' } as any, 1000);
    expect(res.status).toBe('published');
  });

  it('turns an unreadable response into a 422 graph error, which is never left for the sweeper', async () => {
    post.mockResolvedValue({ data: { cards: null } });
    await expect(
      client().run({ run_id: 'r' } as any, 1000),
    ).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining('the response has no status'),
    });
    await expect(
      client().run({ run_id: 'r' } as any, 1000),
    ).rejects.toBeInstanceOf(DebriefGraphError);
  });
});
