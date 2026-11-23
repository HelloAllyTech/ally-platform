import {
  atRiskByKeywords,
  emergencyByKeywords,
  lifeThreatening,
  moreSevere,
} from '../emergency-keywords';

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

describe('medical and maternity emergencies when the classifier fails (Q4 A1)', () => {
  const emergencies = [
    // heavy bleeding
    'My father is bleeding heavily from his leg',
    'Papa ko bahut zyada khoon aa raha hai, ruk nahi raha',
    'बहुत ज़्यादा खून बह रहा है, रुक नहीं रहा',
    // chest pain
    'My father has chest pain and is sweating',
    'Mummy ke seene mein dard ho raha hai abhi',
    'पापा के सीने में तेज़ दर्द हो रहा है',
    // can't breathe
    "He can't breathe properly",
    'Bachche ko saans nahi aa rahi',
    'मेरी माँ को साँस नहीं आ रही',
    // unconscious, not waking
    "My grandmother is unconscious and won't wake up",
    'Dadi behosh ho gayi hain',
    'वो बेहोश हो गए हैं',
    // seizure
    'My son is having a seizure',
    'Bete ko jhatke aa rahe hain',
    'उसे दौरा पड़ रहा है',
    // poisoning, overdose
    'I took 20 of my sleeping pills ten minutes ago',
    'My toddler swallowed some bleach',
    'Usne zeher kha liya hai',
    'उसने गोलियाँ खा ली हैं',
    // stroke signs
    "Dad's face is drooping and he can't speak properly",
    'Nana ko lakwa maar gaya lagta hai, ek side weak hai',
    'उनका मुँह टेढ़ा हो गया है',
    // severe burn
    'My hand got burnt with boiling oil, the skin is peeling',
    'Haath garam tel se jal gaya',
    'आग से हाथ जल गया',
    // waters broken
    'I think my waters broke, I am 36 weeks',
    '9 mahine ki pregnancy hai aur paani jaisa discharge ho raha hai',
    'पानी जैसा डिस्चार्ज हो रहा है, नौवाँ महीना है',
    // bleeding in pregnancy
    "I'm 20 weeks pregnant and bleeding",
    'Pregnancy ke 5 mahine hain, khoon aa raha hai',
    'गर्भ के तीसरे महीने में खून आ रहा है',
    // baby not moving
    "The baby isn't moving since this morning",
    'Baby ki movement band ho gayi hai',
    'बच्चे की हलचल बंद हो गई है',
  ];

  it.each(emergencies)('emergency on a medical assistant: %s', (text) => {
    expect(emergencyByKeywords(text, 'medical')).toMatchObject({
      is_crisis: true,
      level: 'emergency',
    });
  });

  it('the same rules hold on a pharmacy assistant', () => {
    expect(
      emergencyByKeywords('I took 20 of my sleeping pills', 'pharmacy'),
    ).not.toBeNull();
  });

  it('life-threatening rules on every assistant (Q4, 23 Nov); maternity only on a medical one', () => {
    expect(
      emergencyByKeywords("He can't breathe properly", 'standard'),
    ).not.toBeNull();
    expect(emergencyByKeywords("He can't breathe properly")).not.toBeNull();
    expect(
      emergencyByKeywords('I splashed bleach in my eye', 'standard'),
    ).not.toBeNull();
    expect(emergencyByKeywords('My waters have broken', 'standard')).toBeNull();
    expect(
      emergencyByKeywords('My waters have broken', 'medical'),
    ).not.toBeNull();
  });

  it.each([
    'I am dying to see you',
    'This deadline is killing me lol',
    "I'm dead tired after my shift",
    'This form is killing me',
    'When will I feel my baby move?',
    'What causes chest pain in pregnancy?',
    'Do you treat burns?',
    'Mar gaya yaar itna khana kha ke',
    'मैं थक के मर गया हूँ, कल सुबह क्लिनिक कितने बजे खुलता है?',
  ])('a look-alike is never an emergency: %s', (text) => {
    expect(emergencyByKeywords(text, 'medical')).toBeNull();
  });
});

describe('life-threatening emergencies decide on their own, on every assistant (Q4, 23 Nov)', () => {
  it.each([
    "Someone collapsed in the hub and isn't breathing",
    'A man just collapsed near the reception',
    'My father is unconscious and not waking up',
    'A child is choking on a coin',
    'He is bleeding heavily from his head',
    'My mother has chest pain right now',
    'She is having a seizure',
    'My friend took 20 sleeping pills',
    "Her face is drooping and she can't speak properly",
    'The kitchen is on fire',
    'Someone was stabbed outside the centre',
    'Koi behosh ho gaya hai, saans nahi le raha',
    'आग लग गई है',
  ])('an emergency: %s', (text) => {
    expect(lifeThreatening(text)).toMatchObject({
      is_crisis: true,
      level: 'emergency',
    });
  });

  it.each([
    'The deal collapsed last week',
    'What is a seizure?',
    'Do you offer fire safety training?',
    'Do you have a first-aid kit at the hub?',
    'Our sales collapsed this quarter, can you help?',
    'I am dying to see you',
    'This deadline is killing me lol',
  ])('not an emergency: %s', (text) => {
    expect(lifeThreatening(text)).toBeNull();
  });
});

describe('indirect hopelessness on a mental-health assistant (Q4 H1)', () => {
  it.each([
    "Honestly some days I feel there's no point to anything",
    "what's the point of anything anymore, I'm just tired of everything",
    "I don't want to wake up tomorrow",
    'sach mein ab kisi cheez ka koi matlab nahi lagta, roz uthne ka mann nahi karta',
    'मुझे अब जीने का मन नहीं करता',
  ])('at risk: %s', (text) => {
    expect(atRiskByKeywords(text, 'mental_health')).toMatchObject({
      is_crisis: true,
      level: 'at_risk',
    });
  });

  it('only on a mental-health assistant, and never on ordinary questions', () => {
    expect(
      atRiskByKeywords("what's the point of a day pass?", 'standard'),
    ).toBeNull();
    expect(
      atRiskByKeywords('Is there any point in booking early?', 'mental_health'),
    ).toBeNull();
    expect(
      atRiskByKeywords('What are your timings?', 'mental_health'),
    ).toBeNull();
  });
});

describe('the more severe verdict wins (Q4 H1)', () => {
  const base = { signal: '', confidence: 0 };
  const none = {
    ...base,
    is_crisis: false,
    level: 'none' as const,
    failed: false,
  };
  const atRisk = {
    ...base,
    is_crisis: true,
    level: 'at_risk' as const,
    failed: false,
  };
  const failed = {
    ...base,
    is_crisis: false,
    level: 'none' as const,
    failed: true,
  };
  it('at risk alone beats none with history; a failed one never wins', () => {
    expect(moreSevere(none, atRisk)).toBe(atRisk);
    expect(moreSevere(atRisk, none)).toBe(atRisk);
    expect(moreSevere(failed, none)).toBe(none);
    expect(moreSevere(none, failed)).toBe(none);
    expect(moreSevere(null, atRisk)).toBe(atRisk);
  });
});
