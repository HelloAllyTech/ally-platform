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

// TF1: the page said "people at Your assistant" and its header "Your assistant" after the owner
// had named it.
describe('the default name never beats a real one (TF1)', () => {
  it('falls back to the real name', () => {
    expect(realName('Your assistant', 'Saathi Youth Helpline')).toBe(
      'Saathi Youth Helpline',
    );
  });
  it('is kept when nothing better exists', () => {
    expect(realName('Your assistant', 'Your assistant')).toBe('Your assistant');
    expect(realName('Your assistant', '')).toBe('Your assistant');
  });
});

describe('the auto name of a new chatbot', () => {
  it('never wins over a real name, like the old default', () => {
    expect(
      realName('Your new Ally Chatbot 2511251', 'Saathi Youth Helpline'),
    ).toBe('Saathi Youth Helpline');
    expect(realName('Your new Ally Chatbot 25112512', 'Saathi')).toBe('Saathi');
  });

  it('is kept when there is no real name to prefer', () => {
    expect(realName('Your new Ally Chatbot 2511251', '')).toBe(
      'Your new Ally Chatbot 2511251',
    );
    expect(
      realName(
        'Your new Ally Chatbot 2511251',
        'Your new Ally Chatbot 2511252',
      ),
    ).toBe('Your new Ally Chatbot 2511251');
  });

  it('is not mistaken for a name that merely starts the same way', () => {
    expect(realName('Your new Ally Chatbot for schools', 'Saathi')).toBe(
      'Your new Ally Chatbot for schools',
    );
  });
});
