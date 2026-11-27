import {
  applyCriticPatch,
  currentPlanReference,
} from '../course-blueprint-patch.util';

const item = (id: string, title: string, extra: any = {}): any => ({
  id,
  type: 'ARTICLE',
  title,
  estimatedMinutes: 6,
  ...extra,
});
const plan = (...items: any[]): any => ({
  title: 'Course',
  sections: [{ id: 's1', title: 'S1', items }],
});

describe('applyCriticPatch', () => {
  const before = plan(
    item('a', 'Intro'),
    item('b', 'Practice', { transfer: true }),
    item('c', 'Quiz'),
  );

  it('edits only the flagged item and puts back what the repair changed elsewhere', () => {
    const after = plan(
      item('a', 'Intro rewritten'),
      item('b', 'Practice', { transfer: false }),
      item('c', 'Quiz on outcome 2'),
      item('d', 'New journal'),
    );
    const result = applyCriticPatch(before, after, [
      { severity: 'blocking', itemId: 'c' },
      { severity: 'advisory', itemId: 'a' },
    ]);
    const items = result.blueprint.sections[0].items;
    expect(result.mode).toBe('patch');
    expect(items.map((i: any) => i.title)).toEqual([
      'Intro',
      'Practice',
      'Quiz on outcome 2',
      'New journal',
    ]);
    expect((items[1] as any).transfer).toBe(true);
    expect(result.restored).toBe(2);
    expect(result.changed).toBe(2);
  });

  it('lets the repair remove an item', () => {
    const after = plan(item('a', 'Intro'), item('c', 'Quiz fixed'));
    const result = applyCriticPatch(before, after, [
      { severity: 'blocking', itemId: 'b' },
    ]);
    expect(result.blueprint.sections[0].items.map((i: any) => i.id)).toEqual([
      'a',
      'c',
    ]);
  });

  it('takes the whole repair when a blocking finding is about the course', () => {
    const after = plan(item('a', 'Intro rewritten'), item('c', 'Quiz'));
    const result = applyCriticPatch(before, after, [
      { severity: 'blocking', itemId: 'c' },
      { severity: 'blocking' },
    ]);
    expect(result.mode).toBe('whole');
    expect(result.blueprint.sections[0].items[0].title).toBe('Intro rewritten');
    expect(result.restored).toBe(0);
  });

  it('describes the plan to edit with its ids', () => {
    const text = currentPlanReference(before);
    expect(text).toContain('CURRENT PLAN');
    expect(text).toContain('"id":"b"');
  });
});
