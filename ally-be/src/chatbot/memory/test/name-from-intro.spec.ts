import { nameFromIntro } from '../name-from-intro';

/** TF1 round 2 (Saathi B-2): only a name stated outright. */
describe('a name stated outright', () => {
  it.each([
    ['my name is Asha', 'Asha'],
    ['Hi, my name is asha rao.', 'Asha Rao'],
    ['mera naam Asha hai', 'Asha'],
    ['मेरा नाम आशा है', 'आशा'],
    ['My name is Asha and I need help', 'Asha'],
    ["Hi, I'm Asha", 'Asha'],
    ['hello, I am asha rao', 'Asha Rao'],
  ])('%s → %s', (text, name) => {
    expect(nameFromIntro(text)).toBe(name);
  });

  it.each([
    'Can someone call me back tomorrow evening?',
    'call me back',
    'call me tomorrow',
    'call me at 9',
    "I'm stressed",
    "I'm 16",
    "I'm scared",
    "Hi, I'm Asha, are you open now?",
    "I'm feeling low",
    "I'm hopeless",
    'my name is not important',
    'what is my name?',
  ])('never a name: %s', (text) => {
    expect(nameFromIntro(text)).toBeNull();
  });
});
