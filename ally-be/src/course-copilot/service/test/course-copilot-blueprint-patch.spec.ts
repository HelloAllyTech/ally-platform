import { applyJsonPatch } from 'src/common/util/json-patch.util';
import { blueprintPatchOps } from '../course-copilot-blueprint.service';

describe('blueprintPatchOps', () => {
  const blueprint = () => ({
    sections: [
      {
        items: [
          { type: 'BRANCHING_SCENARIO', completionCriteria: { passScore: 0 } },
          { type: 'JOURNAL' },
        ],
      },
    ],
  });

  it('reads an item rule by the name the model sees ("rule")', () => {
    // As a trainer's "SJTs must reach the positive ending" was sent on 2026-11-25.
    const patched = applyJsonPatch<any>(
      blueprint(),
      blueprintPatchOps([
        {
          op: 'replace',
          path: '/sections/0/items/0/rule',
          value: { passScore: 75 },
        },
        {
          op: 'replace',
          path: '/sections/0/items/0/rule/passScore',
          value: 80,
        },
      ]),
    );
    expect(patched.sections[0].items[0].completionCriteria).toEqual({
      passScore: 80,
    });
    expect(patched.sections[0].items[0].rule).toBeUndefined();
  });

  it('lets replace set a rule an item does not have yet', () => {
    const patched = applyJsonPatch<any>(
      blueprint(),
      blueprintPatchOps([
        {
          op: 'replace',
          path: '/sections/0/items/1/completionCriteria',
          value: { x: 1 },
        },
      ]),
    );
    expect(patched.sections[0].items[1].completionCriteria).toEqual({ x: 1 });
  });

  it('leaves every other path alone', () => {
    const ops = [
      { op: 'replace' as const, path: '/sections/0/items/0/title', value: 'T' },
      { op: 'replace' as const, path: '/sections/0/rules', value: 1 },
    ];
    expect(blueprintPatchOps(ops)).toEqual(ops);
  });
});
