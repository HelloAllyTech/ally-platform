import { CL_AGENT_UNUSED_AFTER_REPORTS } from '../../constants/context-library.constants';
import {
  agentEvidenceScore,
  agentRetirementDecision,
  mergeLabels,
  normaliseLabels,
  parseCuratorOperations,
  splitAgentText,
} from '../agent-curator.util';

describe('parseCuratorOperations', () => {
  it('reads the JSON object the prompt asks for', () => {
    expect(
      parseCuratorOperations({
        operations: [
          { op: 'AGREE', id: 'BL-0001', candidateId: 'BL-0009' },
          { op: 'edit', id: 'BL-0002', text: 'Sharper', category: 'gotcha' },
          { op: 'ADD', id: 'BL-0009', tags: ['Migrations', ' migrations '] },
          { op: 'REMOVE', id: 'BL-0003' },
          { op: 'SHRUG', id: 'BL-0004' },
        ],
      }),
    ).toEqual([
      { op: 'AGREE', id: 'BL-0001', candidateId: 'BL-0009' },
      { op: 'EDIT', id: 'BL-0002', text: 'Sharper', category: 'gotcha' },
      { op: 'ADD', id: 'BL-0009', tags: ['migrations'] },
      { op: 'REMOVE', id: 'BL-0003' },
    ]);
  });

  it('still reads the old curators’ wordings: a bare array, fenced, with `lesson` or `body`', () => {
    const ops = parseCuratorOperations(
      'Here you go:\n```json\n[{"op":"EDIT","id":"BN-0001","body":"from Bug Hunter"},{"op":"EDIT","id":"BL-0001","lesson":"from Builder"}]\n```',
    );
    expect(ops.map((o) => o.text)).toEqual(['from Bug Hunter', 'from Builder']);
  });

  it('turns anything unreadable into no operations, never a throw', () => {
    expect(parseCuratorOperations('no json')).toEqual([]);
    expect(parseCuratorOperations(null)).toEqual([]);
    expect(parseCuratorOperations({ nope: true })).toEqual([]);
  });
});

describe('labels', () => {
  it('normalises open labels and merges without duplicates', () => {
    expect(normaliseLabels([' Ally-BE', 'ally-be', '', 42])).toEqual([
      'ally-be',
      '42',
    ]);
    expect(mergeLabels(['a', 'b'], ['B', 'c'])).toEqual(['a', 'b', 'c']);
    expect(normaliseLabels('not a list')).toEqual([]);
  });
});

describe('agentRetirementDecision', () => {
  const base = {
    pinned: false,
    sourceCount: 1,
    timesApplied: 0,
    timesContradicted: 0,
    unusedReports: 0,
  };

  it('retires a chunk contradicted more often than it was confirmed or applied', () => {
    // One bad night cannot do it: one sighting means two contradictions are the floor.
    expect(
      agentRetirementDecision({ ...base, timesContradicted: 1 }),
    ).toBeNull();
    expect(agentRetirementDecision({ ...base, timesContradicted: 2 })).toMatch(
      /Reported wrong 2 times/,
    );
    expect(
      agentRetirementDecision({
        ...base,
        sourceCount: 2,
        timesApplied: 2,
        timesContradicted: 4,
      }),
    ).toBeNull();
  });

  it('retires a chunk never applied by enough runs that reported what they used', () => {
    expect(
      agentRetirementDecision({
        ...base,
        unusedReports: CL_AGENT_UNUSED_AFTER_REPORTS - 1,
      }),
    ).toBeNull();
    expect(
      agentRetirementDecision({
        ...base,
        unusedReports: CL_AGENT_UNUSED_AFTER_REPORTS,
      }),
    ).toMatch(/Never applied/);
    expect(
      agentRetirementDecision({
        ...base,
        timesApplied: 1,
        unusedReports: 100,
      }),
    ).toBeNull();
  });

  it('never retires a pinned chunk', () => {
    expect(
      agentRetirementDecision({
        ...base,
        pinned: true,
        timesContradicted: 9,
        unusedReports: 100,
      }),
    ).toBeNull();
  });

  it('scores evidence, not recency', () => {
    expect(
      agentEvidenceScore({
        sourceCount: 3,
        timesApplied: 2,
        timesContradicted: 1,
      }),
    ).toBe(3);
  });
});

describe('splitAgentText', () => {
  it('keeps short text as the statement', () => {
    expect(splitAgentText('  short  ', 600)).toEqual({
      statement: 'short',
      body: null,
    });
  });

  it('clips long text at a word into the statement and keeps all of it as the body', () => {
    const text = 'word '.repeat(200).trim();
    const { statement, body } = splitAgentText(text, 100);
    expect(statement.length).toBeLessThanOrEqual(100);
    expect(statement.endsWith('…')).toBe(true);
    expect(statement).not.toMatch(/wor…$/);
    expect(body).toBe(text);
  });
});
