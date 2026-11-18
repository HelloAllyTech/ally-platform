import { isGenuineReflection } from '../debrief-engagement-event.type';

const DEBRIEF = [
  'When Meena went quiet, you waited and let her find her words.',
  'Next time, ask her directly whether she has thought about ending her life.',
];

describe('isGenuineReflection (DEBRIEF_REFLECTION XP)', () => {
  it('accepts an answer of 15 words or more in the learner’s own words', () => {
    expect(
      isGenuineReflection(
        'I think the silence made me anxious so I rushed in, and I want to sit with it next time.',
        DEBRIEF,
      ),
    ).toBe(true);
  });

  it('refuses a short answer', () => {
    expect(
      isGenuineReflection('Yes, that makes sense, thank you.', DEBRIEF),
    ).toBe(false);
  });

  it('refuses an answer copied from the debrief', () => {
    expect(
      isGenuineReflection(
        'ok so next time, ask her directly whether she has thought about ending her life i guess',
        DEBRIEF,
      ),
    ).toBe(false);
  });

  it('counts words in Indic scripts', () => {
    expect(
      isGenuineReflection(
        'मुझे लगता है कि मैं चुप्पी से घबरा गई थी इसलिए मैंने जल्दी से सलाह दे दी अगली बार रुकूँगी',
        DEBRIEF,
      ),
    ).toBe(true);
  });
});
