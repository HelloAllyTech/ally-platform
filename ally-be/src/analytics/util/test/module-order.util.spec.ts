import { inModuleOrder } from '../module-order.util';

const t = (...titles: string[]) => titles.map((title) => ({ title }));
const titles = (rows: Array<{ title: string }>) => rows.map((r) => r.title);

describe('inModuleOrder', () => {
  it('puts numbered modules in numeric order', () => {
    expect(
      titles(
        inModuleOrder(t('Section 1', 'Section 11', 'Section 2', 'Section 10')),
      ),
    ).toEqual(['Section 1', 'Section 2', 'Section 10', 'Section 11']);
  });

  it('keeps the stored order when titles are named, mixed or differ in wording', () => {
    expect(titles(inModuleOrder(t('Basics', 'Advanced')))).toEqual([
      'Basics',
      'Advanced',
    ]);
    expect(titles(inModuleOrder(t('Section 2', 'Intro')))).toEqual([
      'Section 2',
      'Intro',
    ]);
    expect(titles(inModuleOrder(t('Week 2', 'Module 1')))).toEqual([
      'Week 2',
      'Module 1',
    ]);
  });

  it('keeps stored order for equal numbers and for a single module', () => {
    expect(titles(inModuleOrder(t('Part 1', 'Part 1')))).toEqual([
      'Part 1',
      'Part 1',
    ]);
    expect(inModuleOrder(t('Only 3'))).toHaveLength(1);
  });
});
