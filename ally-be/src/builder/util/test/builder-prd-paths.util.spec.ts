import { createEmptyPrdDocument } from '../../type/builder-prd.type';
import {
  checkPrdPaths,
  pathsRow,
  prdCitedPaths,
} from '../builder-prd-paths.util';

const trees = new Map<string, Set<string> | null>([
  [
    'ally-be',
    new Set([
      'src/builder/service/builder-prd.service.ts',
      'src/builder/controller/builder.controller.ts',
    ]),
  ],
  [
    'ally-web',
    new Set(['apps/ally-admin-dashboard/src/pages/Roadmap/IdeaView.tsx']),
  ],
  ['ally-ai', new Set(['app/main.py'])],
  ['ally-ai-learn', new Set(['app/worker.py'])],
  [
    'ally-mobile',
    new Set(['lib/main.dart', 'lib/features/debrief/debrief_screen.dart']),
  ],
]);

const draftWith = (existingBehaviour: string, changes = '') => ({
  ...createEmptyPrdDocument(),
  existingBehaviour,
  technicalPlan: {
    repos: changes ? [{ repo: 'ally-mobile', changesMd: changes }] : [],
    dataModelMd: '',
    apiMd: '',
  },
});

describe('PRD path check', () => {
  it('finds paths that exist, by full path, partial path or file name', () => {
    const draft = draftWith(
      'Readiness is in `ally-be/src/builder/service/builder-prd.service.ts`; the page is ' +
        '`IdeaView.tsx`; see `builder/controller/builder.controller.ts`.',
    );
    const result = checkPrdPaths(prdCitedPaths(draft), trees);
    expect(result.missing).toEqual([]);
    expect(result.checked).toBe(3);
  });

  it('reports a controller that does not exist, and React Native paths in the Flutter app', () => {
    const draft = draftWith(
      'Handled by `ally-be/src/roadmap/roadmap-plan.controller.ts`.',
      '- new screen in `src/screens/DebriefScreen.tsx`',
    );
    const result = checkPrdPaths(prdCitedPaths(draft), trees);
    expect(result.missing.map((entry) => entry.path)).toEqual([
      'ally-be/src/roadmap/roadmap-plan.controller.ts',
      'ally-mobile/src/screens/DebriefScreen.tsx',
    ]);
    const row = pathsRow(result);
    expect(row.ok).toBe(false);
    expect(row.hint).toContain("2 path(s) in the PRD don't exist");
  });

  it('accepts a file the PRD says it creates, where its folder exists', () => {
    const draft = draftWith(
      '',
      '- (R1) new file `lib/features/debrief/rating_card.dart`',
    );
    expect(checkPrdPaths(prdCitedPaths(draft), trees).missing).toEqual([]);
  });

  it('leaves paths unchecked when a tree could not be read', () => {
    const partial = new Map(trees);
    partial.set('ally-be', null);
    const draft = draftWith(
      'See `ally-be/src/nowhere/x.ts` and `src/nowhere/y.ts`.',
    );
    const result = checkPrdPaths(prdCitedPaths(draft), partial);
    expect(result).toEqual({ checked: 0, missing: [] });
  });

  it('counts a file read this session as existing', () => {
    const draft = draftWith('See `ally-be/src/fresh/new-thing.service.ts`.');
    const result = checkPrdPaths(prdCitedPaths(draft), trees, [
      'ally-be:src/fresh/new-thing.service.ts',
    ]);
    expect(result.missing).toEqual([]);
  });
});
