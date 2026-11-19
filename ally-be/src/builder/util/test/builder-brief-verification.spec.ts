import {
  filesReadIn,
  normaliseBriefResponse,
  normaliseSituationBrief,
  renderBriefResponse,
} from '../builder-situation-brief.util';

const discovery = {
  ranAt: '2026-11-19T00:00:00Z',
  planned: 'model' as const,
  items: [
    {
      ref: 'E1',
      tool: 'github_search_code' as const,
      query: 'readiness',
      ok: true,
      found: ['ally-be:src/builder/service/builder-prd.service.ts'],
    },
    {
      ref: 'E2',
      tool: 'capability_lookup' as const,
      query: 'debrief',
      ok: true,
      found: ['Debrief tab'],
    },
  ],
};

const input = {
  message: 'Here is what I found.',
  exists: [
    { text: 'Readiness rows are computed in one service.', cites: ['E1'] },
    { text: 'There is a debrief tab.', cites: ['E2'] },
  ],
  proposals: [
    { part: 'rows', approach: 'extend', text: 'Add a row.', cites: ['E1'] },
  ],
  repos: [{ repo: 'ally-be', why: 'rows live there' }],
};

describe('situation brief verification', () => {
  it('marks a line verified only when a file read supports it', () => {
    const { brief } = normaliseSituationBrief(input, {
      discovery,
      sources: [],
      readFiles: ['ally-be:src/builder/service/builder-prd.service.ts'],
    });
    const [x1, x2] = brief.lines;
    expect(x1).toMatchObject({
      verified: true,
      verifiedBy: 'ally-be:src/builder/service/builder-prd.service.ts',
    });
    expect(x2.verified).toBe(false);
    // Decisions are not claims: no verification on proposals or repos.
    expect(
      brief.lines.find((line) => line.kind === 'proposal')?.verified,
    ).toBeUndefined();
  });

  it('leaves lines unmarked when reads are not supplied', () => {
    const { brief } = normaliseSituationBrief(input, {
      discovery,
      sources: [],
    });
    expect(brief.lines[0].verified).toBeUndefined();
  });

  it('records a confirm on an unverified line as unverified', () => {
    const { brief } = normaliseSituationBrief(input, {
      discovery,
      sources: [],
      readFiles: ['ally-be:src/builder/service/builder-prd.service.ts'],
    });
    const response = normaliseBriefResponse(brief, {
      briefId: brief.id,
      lines: brief.lines.map((line) => ({ id: line.id, verdict: 'confirm' })),
    })!;
    expect(response.lines.find((line) => line.id === 'X1')?.verdict).toBe(
      'confirm',
    );
    expect(response.lines.find((line) => line.id === 'X2')?.verdict).toBe(
      'unverified',
    );
    expect(renderBriefResponse(brief, response)).toContain(
      'Unverified, no file read shows them: X2.',
    );
  });

  it('collects files read successfully from tool calls', () => {
    expect(
      filesReadIn([
        {
          name: 'github_read_file',
          input: { repo: 'ally-be', path: 'a.ts' },
          result: { ok: true },
        },
        {
          name: 'github_read_file',
          input: { repo: 'ally-be', path: 'b.ts' },
          result: { ok: false },
        },
        {
          name: 'github_search_code',
          input: { query: 'x' },
          result: { ok: true },
        },
      ]),
    ).toEqual(['ally-be:a.ts']);
  });
});
