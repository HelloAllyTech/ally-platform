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

  it('only on a medical assistant; the eye rules stay on every assistant', () => {
    expect(
      emergencyByKeywords("He can't breathe properly", 'standard'),
    ).toBeNull();
    expect(emergencyByKeywords("He can't breathe properly")).toBeNull();
    expect(
      emergencyByKeywords('I splashed bleach in my eye', 'standard'),
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
