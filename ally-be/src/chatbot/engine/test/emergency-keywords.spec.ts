import { emergencyByKeywords } from '../emergency-keywords';

describe('emergency keywords, for when the crisis classifier fails (chunk H1)', () => {
  it.each([
    "I splashed bleach in my eye and it's burning badly",
    'acid went into my eyes',
    'My vision went black suddenly in one eye 10 minutes ago',
    'I suddenly cannot see from my left eye',
    'got hit in the eye with a cricket ball and it is bleeding',
    'aankh mein chuna chala gaya hai',
    'meri aankh jal rahi hai',
    'achanak dikhna band ho gaya',
    'मेरी आंख में ब्लीच चला गया है, बहुत जल रहा है',
    'आँख में चोट लग गई है',
    'अचानक दिखना बंद हो गया',
  ])('%s is an emergency', (text) => {
    const verdict = emergencyByKeywords(text);
    expect(verdict).toMatchObject({ is_crisis: true, level: 'emergency' });
    expect(verdict!.signal.length).toBeGreaterThan(0);
  });

  it.each([
    'What are the timings of your Indore branch?',
    'Do you do LASIK? Which types?',
    'Can I use my mother’s leftover eye drops for my red eye?',
    'After cataract surgery how soon will my vision get better?',
    'so depressed my tee is sold out',
    '',
  ])('%s is not', (text) => {
    expect(emergencyByKeywords(text)).toBeNull();
  });
});
