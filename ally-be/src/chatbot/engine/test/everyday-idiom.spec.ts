import { isEverydayIdiom } from '../everyday-idiom';

describe('isEverydayIdiom (Q3-fast stop 1)', () => {
  it.each([
    "I'm so done with working from home, I want to die of boredom. Do you have day passes?",
    'I could die of embarrassment',
    "I'm dying of laughter",
    'bore hoke mar gaya',
  ])('leaves a keyword match to the classifier: %s', (text) => {
    expect(isEverydayIdiom(text)).toBe(true);
  });

  it.each([
    'I want to die',
    "I don't want to live anymore",
    'I want to die, I am so bored of everything',
    'I want to kill myself',
  ])('keeps the keyword rule for real risk: %s', (text) => {
    expect(isEverydayIdiom(text)).toBe(false);
  });
});
