import { looksEmotional } from '../looks-emotional';

describe('looksEmotional (Q3-fast stop 1, option c)', () => {
  it.each([
    "I'm so depressed my Deadpool tee is sold out",
    "I'm 3 weeks postpartum, I cry every day",
    'I feel like such a bad mother',
    'bahut pareshan hoon, tension ho rahi hai',
    'ro rahi hoon kal se',
    'itna gussa aa raha hai',
    'mar gaya yaar itna khana kha ke',
    'मैं बहुत दुखी हूँ',
    "I don't want to live anymore, there's no point",
  ])('waits for the level: %s', (text) => {
    expect(looksEmotional(text)).toBe(true);
  });

  it.each([
    'What are your hours on Saturday?',
    'Book T2 for 3 on Tuesday 24 Nov at 1 pm please',
    'How much are the Batman high top sneakers?',
    'mera order kab aayega?',
    'Are the returns guaranteed?',
  ])('starts the run at once: %s', (text) => {
    expect(looksEmotional(text)).toBe(false);
  });
});
