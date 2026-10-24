import {
  matchFirstPersonRisk,
  normaliseForRisk,
} from '../first-person-risk.matcher';

describe('matchFirstPersonRisk', () => {
  it.each([
    ['I want to die', 'en'],
    ["I'm going to kill myself tonight", 'en'],
    ['im going to end my life', 'en'],
    ['Honestly I don’t want to live anymore.', 'en'],
    ['I feel like I want to die', 'en'],
    ["I can't say it out loud but I want to kill myself", 'en'],
    ['ive taken too many pills', 'en'],
    ['there is no reason to live', 'en'],
    ['मैं मरना चाहती हूँ', 'hi'],
    ['sach mein mujhe mar jana hai', 'hi'],
    ['main suicide kar lunga', 'hi'],
    ['मला जगायचं नाही', 'mr'],
    ['நான் சாகப் போகிறேன்', 'ta'],
    ['ನನಗೆ ಬದುಕಲು ಇಷ್ಟವಿಲ್ಲ', 'kn'],
  ])('catches the learner’s own statement: %s', (text, language) => {
    expect(matchFirstPersonRisk(text)?.language).toBe(language);
  });

  // Professional discussion is the course's subject matter; none of these
  // may put a counsellor-in-training into crisis mode.
  it.each([
    'How do I respond when a client says they want to kill themselves?',
    'My client said "I want to die" and I froze.',
    'The persona says I want to end my life — what should I reflect back?',
    'She told me I want to die, every session.',
    'What are the warning signs of suicide?',
    'The article on self harm was really helpful.',
    'Asking directly about suicide does not increase risk, right?',
    'मरीज ने कहा मैं मरना चाहती हूँ, मैं क्या कहूँ?',
    'client ne kaha mujhe mar jana hai',
    'I would die for a coffee right now',
    'This quiz is killing me',
    'therapist rapport building tips',
  ])('ignores professional or idiomatic talk: %s', (text) => {
    expect(matchFirstPersonRisk(text)).toBeNull();
  });

  it('matches whole words only', () => {
    expect(matchFirstPersonRisk('I want to dielectric')).toBeNull();
  });
});

describe('normaliseForRisk', () => {
  it('keeps Indic vowel signs and folds punctuation and case', () => {
    expect(normaliseForRisk('  मैं  मरना, चाहती हूँ!! ')).toBe(
      'मैं मरना चाहती हूँ',
    );
    expect(normaliseForRisk('I’M Going…')).toBe("i'm going");
  });
});
