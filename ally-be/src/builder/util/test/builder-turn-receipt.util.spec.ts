import { createEmptyPrdDocument } from '../../type/builder-prd.type';
import {
  buildTurnReceipt,
  describePrdChanges,
  receiptOfStoredTurn,
  renderReceiptLine,
} from '../builder-turn-receipt.util';
import {
  claimsPrdEdit,
  claimsPrdReady,
  notReadyNote,
} from '../builder-turn-claims.util';

describe('turn receipts', () => {
  const before = {
    ...createEmptyPrdDocument('Debrief rating'),
    summary: 'Rate the debrief.',
    requirements: [
      { id: 'R1', title: 'Rating', description: '', acceptanceCriteria: [] },
      {
        id: 'R2',
        title: 'Attribution',
        description: '',
        acceptanceCriteria: [],
      },
    ],
    assumptions: [
      { id: 'A1', text: 'Web only', status: 'unconfirmed' as const },
    ],
    technicalPlan: {
      repos: [
        { repo: 'ally-web', changesMd: '(R1)' },
        { repo: 'ally-ai', changesMd: 'tests' },
      ],
      dataModelMd: '',
      apiMd: '',
    },
    openQuestions: ['Guardrail or weight?'],
  };

  describe('describePrdChanges', () => {
    it('names what moved by section label, requirement id and repo name', () => {
      const after = {
        ...before,
        summary: 'Rate the debrief on web and mobile.',
        problem: 'Nobody knows if debriefs help.',
        requirements: [
          {
            id: 'R1',
            title: 'Thumbs rating',
            description: '',
            acceptanceCriteria: [],
          },
          { id: 'R3', title: 'Input', description: '', acceptanceCriteria: [] },
        ],
        assumptions: [
          { id: 'A1', text: 'Web only', status: 'confirmed' as const },
        ],
        technicalPlan: {
          repos: [
            { repo: 'ally-web', changesMd: '(R1)' },
            { repo: 'ally-mobile', changesMd: '(R1)' },
          ],
          dataModelMd: 'A column.',
          apiMd: '',
        },
        openQuestions: [],
      };
      expect(describePrdChanges(before, after)).toEqual([
        'Summary revised',
        'Problem written',
        'Data model notes written',
        'Requirements: added R3; revised R1; removed R2',
        'Assumptions: confirmed A1',
        'Technical plan: added ally-mobile; removed ally-ai',
        'Open questions: 1 settled',
      ]);
    });

    it('says nothing when nothing moved', () => {
      expect(
        describePrdChanges(before, JSON.parse(JSON.stringify(before))),
      ).toEqual([]);
    });
  });

  describe('buildTurnReceipt', () => {
    const calls = [
      {
        name: 'github_read_file',
        input: { repo: 'ally-be', path: 'src/skill-experiment/x.ts' },
        result: { ok: true, content: '…' },
      },
      {
        name: 'github_read_file',
        input: { repo: 'ally-be', path: 'src/debrief/missing.ts' },
        result: { ok: false, error: 'Not Found' },
      },
      {
        name: 'capability_lookup',
        input: { query: 'challenger' },
        result: { ok: true, results: [{}, {}] },
      },
      {
        name: 'update_prd',
        input: { ops: [{ op: 'replace', path: '/requirements/3/title' }] },
        result: {
          ok: false,
          error: 'patch_failed',
          message: 'PRD patch failed at operation 0: path not found',
        },
      },
      {
        name: 'stacks_get',
        input: { ids: ['x'] },
        result: { ok: true, chunks: [{ title: 'Progressive disclosure' }] },
      },
      // The reply itself is not something the turn did.
      { name: 'ask_admin', input: { prompt: 'Q?' }, result: { ok: true } },
      // Never finished — neither done nor failed.
      {
        name: 'github_search_code',
        input: { query: 'rating' },
        result: undefined,
      },
    ];

    it('lists reads, searches with what they found, and failures with why', () => {
      const receipt = buildTurnReceipt({
        calls,
        before,
        after: { ...before, summary: 'New.' },
        versionFrom: 7,
        versionTo: 9,
        warnings: ['Written before Builder had read 1 of its lookups.'],
        prdUnchangedBecause: null,
      });
      expect(receipt).toEqual({
        read: [
          'ally-be/src/skill-experiment/x.ts',
          'Stacks: Progressive disclosure',
        ],
        searched: ['Platform map "challenger" — 2 matches'],
        changed: ['Summary revised'],
        prdVersion: { from: 7, to: 9 },
        failed: [
          'Read ally-be/src/debrief/missing.ts — Not Found',
          'PRD edit at /requirements/3/title — PRD patch failed at operation 0: path not found',
        ],
        warnings: ['Written before Builder had read 1 of its lookups.'],
      });
    });

    it('reports no change when the version did not move, whatever the drafts say', () => {
      const receipt = buildTurnReceipt({
        calls: [],
        before,
        after: before,
        versionFrom: 4,
        versionTo: 4,
        prdUnchangedBecause: 'They asked how readiness works.',
      });
      expect(receipt.changed).toEqual([]);
      expect(receipt.prdUnchangedBecause).toBe(
        'They asked how readiness works.',
      );
    });
  });

  it('rebuilds a receipt for a row from before receipts, from its tool calls', () => {
    const receipt = receiptOfStoredTurn({
      toolCalls: [
        {
          id: 't1',
          name: 'update_prd',
          input: { changeSummary: 'Added R3', ops: [] },
        },
        {
          id: 't2',
          name: 'github_read_file',
          input: { repo: 'ally-web', path: 'a.tsx' },
        },
      ],
      toolResults: [
        { toolUseId: 't1', name: 'update_prd', result: { ok: true } },
        {
          toolUseId: 't2',
          name: 'github_read_file',
          result: { ok: false, error: '404' },
        },
      ],
      metadata: {},
    } as any);
    expect(receipt.changed).toEqual(['PRD edit: Added R3']);
    expect(receipt.failed).toEqual(['Read ally-web/a.tsx — 404']);
  });

  it('prefers the receipt a row was given', () => {
    const stored = {
      read: ['x'],
      searched: [],
      changed: [],
      prdVersion: { from: 1, to: 1 },
      failed: [],
      warnings: [],
    };
    expect(receiptOfStoredTurn({ metadata: { receipt: stored } } as any)).toBe(
      stored,
    );
  });

  it('renders one line for the history summary, failures in capitals', () => {
    expect(
      renderReceiptLine({
        read: ['a.ts', 'b.ts'],
        searched: ['s1', 's2', 's3'],
        changed: ['Requirements: added R3'],
        prdVersion: { from: 1, to: 2 },
        failed: ['Read c.ts — Not Found'],
        warnings: [],
      }),
    ).toBe(
      'read a.ts, b.ts · 3 searches · changed: Requirements: added R3 · FAILED: Read c.ts — Not Found',
    );
  });
});

describe('reply claims', () => {
  it.each([
    ["I've updated the PRD with the rating shape.", true],
    ['I have added R3 for mobile.', true],
    ['The PRD has been revised.', true],
    ["I'll update the PRD once you answer.", false],
    ['What should the rating look like?', false],
  ])('claimsPrdEdit(%p) is %p', (text, expected) => {
    expect(claimsPrdEdit(text)).toBe(expected);
  });

  it.each([
    ['The PRD is now build-ready. Next, draft the technical design.', true],
    ['It is ready for technical design.', true],
    ['Readiness is at 100%.', true],
    ["It isn't build-ready yet: two questions are open.", false],
    ['It is not ready to build.', false],
    ['Once it is build-ready, draft the design.', false],
    ['We are close to build-ready.', false],
    // Suite 5d24dd95's last replies on runs that never reached PRD_READY.
    ['The plan is now simpler and ready.  You can now start the build.', true],
    [
      'The PRD is complete and ready. You can start the build whenever you are satisfied.',
      true,
    ],
    [
      "The PRD is now complete and ready for development. You can start the build whenever you're ready.",
      true,
    ],
    ['You can press "Start build" when you\'re ready.', true],
    ['The PRD is ready for build.', true],
    ['After the fixes, the PRD is ready.', true],
    // ...and the nothing-to-build endings, which are not a ready claim.
    [
      "You can start a new build for a different feature whenever you're ready.",
      false,
    ],
    [
      'No build will be needed. Since no work is required, we can consider this interview complete.',
      false,
    ],
    // Conditions and questions say nothing about the PRD as it stands.
    ['Once R3 has an owner, you can start the build.', false],
    ['If you confirm A2, the PRD is ready.', false],
    ['Before you press Start, settle the toggle.', false],
    ['Shall I mark it build-ready?', false],
    ['Is the plan complete enough for you?', false],
    ["You can't start the build yet: R3 has no owner.", false],
    // Phrasings from suite 5d24dd95 and the local live check (2026-10-23).
    ['The build is now ready to start.', true],
    [
      'Next, a technical design will be drafted from this PRD, and after review, the build will begin.',
      true,
    ],
    [
      'The next step is for a technical design to be drafted from this PRD.',
      true,
    ],
    [
      "You can review the full specification and, when you're ready, start the build.",
      true,
    ],
    ["When you're happy with it, you can start the build.", true],
    ['The PRD is final.', true],
    // A rewrite after two send-backs in the live check: discloses the
    // blocker, then claims ready anyway.
    [
      'Aside from this technical constraint, the specification is ready for the next step: drafting the technical design.',
      true,
    ],
    ['Are you ready for the next step?', false],
    [
      "I'm also addressing the review findings to get this ready to build.",
      false,
    ],
    ['We are now very close to having a build-ready specification.', false],
    ["Once we define that, we'll be ready to build.", false],
    [
      'Before this is ready to build, we need to address one last point.',
      false,
    ],
    ['To start the build, R3 needs an owner.', false],
    ['When R3 has an owner, the build can start.', false],
  ])('claimsPrdReady(%p) is %p', (text, expected) => {
    expect(claimsPrdReady(text)).toBe(expected);
  });

  it('notReadyNote names what readiness still lists, in its admin hints', () => {
    const sections = [
      { key: 'summary', label: 'Summary', ok: true, hint: '' },
      {
        key: 'prdReview',
        label: 'Cold review',
        ok: false,
        hint: '2 review finding(s) to fix or dismiss.',
      },
      {
        key: 'lastMessageApplied',
        label: 'Your latest message is in the PRD',
        ok: false,
        hint: "Your latest message hasn't changed the PRD yet.",
      },
    ];
    expect(notReadyNote({ sections })).toBe(
      "Not ready to build yet — 2 review finding(s) to fix or dismiss; Your latest message hasn't changed the PRD yet.",
    );
    expect(notReadyNote({ sections: sections.slice(0, 1) })).toBe(
      'Not ready to build yet.',
    );
  });
});
