import { isPlaceholder, realName } from '../name-placeholders';

describe('a placeholder is never a name (Q4 N1)', () => {
  it.each([
    'unchanged',
    'Unchanged',
    '"unchanged"',
    '(unchanged)',
    'no change',
    'same',
    'N/A',
    'none',
    '-',
  ])('%s is a placeholder', (value) => expect(isPlaceholder(value)).toBe(true));

  it.each([
    'Vandrevala Foundation',
    'Same Day Clinic',
    'Keep Fit Gym',
    'Nonesuch Books',
  ])('%s is a real name', (value) => expect(isPlaceholder(value)).toBe(false));

  it('falls back to the next real name', () => {
    expect(realName('unchanged', 'Vandrevala Foundation')).toBe(
      'Vandrevala Foundation',
    );
    expect(realName('  ', 'Goonj')).toBe('Goonj');
    expect(realName('Goonj', 'x')).toBe('Goonj');
  });
});
