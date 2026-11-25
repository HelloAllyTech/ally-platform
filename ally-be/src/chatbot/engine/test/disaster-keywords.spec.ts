import { isFloodNow, lifeThreatening } from '../emergency-keywords';

/**
 * TF1 round 2, S-2: "Water is entering our house and we are trapped" got the self-harm crisis
 * reply. A flood or being trapped by water, fire or rubble is an emergency on every assistant; a
 * flood-relief NGO's own questions and feelings of being "trapped" are not.
 */
describe('floods and being trapped (TF1 round 2, S-2)', () => {
  it.each([
    'Water is entering our house and we are trapped',
    'Water is coming into our home, please help',
    'We are stuck on the roof with the children, the water is rising',
    'Paani ghar mein ghus gaya hai, hum fas gaye hain',
    'Abhi baadh aa gayi hai gaon mein',
    'पानी घर में घुस गया है',
    'बाढ़ में फँस गए हैं',
    'Our building is on fire and we are trapped on the third floor',
    'We are stuck in the lift and smoke is coming in',
    'The flood is rising right now',
  ])('an emergency: %s', (text) => {
    expect(lifeThreatening(text)).toMatchObject({
      is_crisis: true,
      level: 'emergency',
    });
  });

  it.each([
    'I feel trapped in my life',
    "I'm trapped in a bad relationship",
    "I'm flooded with work right now",
    'Can I pay my water bill here?',
    'Do you help flood victims?',
    'baadh peediton ke liye daan',
    'Where is the flood relief camp?',
    'Is the camp still at Bahadurpur?',
    'Kambal daan kab tak le rahe ho?',
    'Is the flood relief camp open now?',
    'I feel stuck and alone',
  ])('not an emergency: %s', (text) => {
    expect(lifeThreatening(text)).toBeNull();
  });

  it('a flood happening now is told the highest place; a fire is not', () => {
    expect(isFloodNow('Water is entering our house and we are trapped')).toBe(
      true,
    );
    expect(isFloodNow('पानी घर में घुस गया है')).toBe(true);
    expect(isFloodNow('Our building is on fire and we are trapped')).toBe(
      false,
    );
    expect(isFloodNow('Where is the flood relief camp?')).toBe(false);
  });
});
