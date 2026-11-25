import type { CrisisCheckResponse } from '../../ai/dto/knowledge.dto';

/**
 * Emergency keyword rules for when the crisis classifier fails (chunk H1 Part C): a chemical in the
 * eye, a burn or injury to the eye, and sudden loss of vision, in English, Hindi and Hinglish.
 *
 * Used ONLY when the classifier timed out or failed, never in place of it: an eye hospital hears
 * "eye injury" in ordinary questions ("can I have LASIK after an old eye injury?"), and the
 * classifier tells those apart. When it can't answer, these decide, so a message like "I splashed
 * bleach in my eye" still gets the emergency reply. Deliberately specific: each rule needs both
 * the eye and what happened to it, close together.
 */

const EYE = String.raw`(?:eyes?|eyeball|aankh(?:o|on|ein|en)?|ankh(?:o|on|ein|en)?|आँख|आंख|आँखों|आंखों|नेत्र)`;
const NEAR = String.raw`[^.!?\n]{0,40}?`;

/** A keyword rule: a regular expression, or several that must all match (`allOf`). */
type Rule = { exec(text: string): { 0: string } | null };

const CHEMICAL = String.raw`(?:bleach|acid|chemical|lime|chuna|choona|cement|detergent|phenyl|harpic|toilet cleaner|cleaner|ammonia|alkali|kerosene|petrol|pepper spray|spray|sanitizer|sanitiser|chemicals?|तेजाब|एसिड|केमिकल|चूना|ब्लीच|फिनाइल|डिटर्जेंट)`;
const BURN = String.raw`(?:burn(?:s|ed|ing|t)?|jal(?:\s)?(?:raha|rahi|rahe|gaya|gayi|gai)|jalan|जल रहा|जल रही|जल गया|जल गई|जलन)`;
const INJURY = String.raw`(?:injur(?:y|ed|ies)|hit|struck|stabbed|poked|cut|punctur\w*|pierced|bleeding|blood|glass|metal piece|splinter|firecracker|cracker|chot|lag gayi|lag gaya|ghus gaya|ghus gayi|चोट|लग गई|लग गया|घुस गया|घुस गई|खून)`;
const SUDDEN = String.raw`(?:sudden(?:ly)?|all of a sudden|achanak|अचानक)`;
const VISION_LOST = String.raw`(?:can'?t see|cannot see|could(?:n'?t| not) see|lost (?:my )?(?:vision|sight)|(?:vision|sight) (?:went|has gone|gone|is gone|turned|became) (?:black|dark|blank|blurry|away)|went (?:black|dark|blind)|blind|dikhna band|dikh(?:na)? nahi|dikhai nahi|andhera|दिखना बंद|दिखाई नहीं|दिख नहीं|अंधेरा|रोशनी चली)`;

const RULES: RegExp[] = [
  // Something got into the eye: "I splashed bleach in my eye", "aankh mein chuna chala gaya".
  new RegExp(`${CHEMICAL}${NEAR}${EYE}|${EYE}${NEAR}${CHEMICAL}`, 'iu'),
  // A burn to the eye: "my eye is burning badly after…", "आँख जल रही है".
  new RegExp(`${EYE}${NEAR}${BURN}|${BURN}${NEAR}${EYE}`, 'iu'),
  // An injury to the eye: "hit in the eye with a cricket ball", "आँख में चोट लग गई".
  new RegExp(`${INJURY}${NEAR}${EYE}|${EYE}${NEAR}${INJURY}`, 'iu'),
  // Sudden loss of vision: "my vision went black suddenly", "achanak dikhna band ho gaya".
  new RegExp(
    `${SUDDEN}${NEAR}${VISION_LOST}|${VISION_LOST}${NEAR}${SUDDEN}`,
    'iu',
  ),
];

/*
 * Medical and maternity emergencies (Q4 A1): only on a medical assistant (the Medical pack, which
 * maternity uses, and Pharmacy), and, as above, only when the classifier failed. Each rule needs
 * what happened and a sign it is happening now, so a question about a symptom ("what causes chest
 * pain in pregnancy?", "when will I feel my baby move?") stays a question.
 */
const NOW = String.raw`(?:having|has|have|got|getting|severe|bad(?:ly)?|sudden(?:ly)?|right now|now|since|for (?:an? )?(?:hour|few)|my|his|her|he'?s|she'?s|i'?m|abhi|bahut|achanak|तेज़|तेज|अभी|बहुत|अचानक|ho raha|ho rahi|हो रहा|हो रही)`;
const CHEST = String.raw`(?:chest pain|pain in (?:my|his|her|the) chest|chest (?:is )?(?:hurting|tight)|seene (?:me|mein) (?:tez |bahut |zor ka )?dard|chhati (?:me|mein) (?:tez |bahut )?dard|सीने में (?:तेज़ |तेज |बहुत )?दर्द|छाती में (?:तेज़ |तेज |बहुत )?दर्द)`;
const BREATHING = String.raw`(?:can'?t breathe|cannot breathe|can'?t breath|not breathing|stopped breathing|struggling to breathe|hard to breathe|gasping|saa?ns? nahi (?:aa|le)|saa?ns? (?:ruk|band)|साँस नहीं|सांस नहीं|साँस रुक|सांस रुक)`;
const UNCONSCIOUS = String.raw`(?:unconscious|passed out|collapsed|not waking|won'?t wake|isn'?t waking|not responding|unresponsive|behosh|be-hosh|hosh nahi|बेहोश|होश नहीं)`;
const SEIZURE = String.raw`(?:seizures?|having a fit|having fits|convuls\w*|jhatke aa|mirgi ka daura|daura pad|दौरा पड़|मिर्गी|झटके आ)`;
const POISON = String.raw`(?:overdos\w*|poison\w*|swallowed (?:some |a lot of |all )?(?:my |his |her )?(?:pills|tablets|medicine|bleach|phenyl|kerosene|acid)|took (?:\d+|all|too many|a lot of)[^.!?\n]{0,20}(?:pills|tablets|sleeping)|zeh?e?r (?:kha|pi)|ज़हर|जहर|goliyan kha li|गोलियाँ खा ली|गोलियां खा ली)`;
const STROKE = String.raw`(?:face (?:is )?(?:drooping|droops|dropped|fell)|slurred speech|can'?t speak (?:properly|clearly)?|one side (?:is )?(?:weak|numb|not moving)|(?:arm|leg) (?:went )?(?:weak|numb) on one side|lakwa|लकवा|muh tedha|मुँह टेढ़ा|मुंह टेढ़ा|bol nahi pa|बोल नहीं पा)`;
const SEVERE_BURN = String.raw`(?:(?:burn(?:t|ed|s)?|scald(?:ed)?)[^.!?\n]{0,40}(?:skin (?:is )?(?:peeling|coming off)|blister|boiling|hot oil|fire|badly|severe)|(?:boiling|hot oil|fire)[^.!?\n]{0,40}burn|(?:jal gaya|jal gayi|jal gaye)[^.!?\n]{0,30}(?:tel|garam|aag|paani)|(?:garam|tel|aag|ubalte)[^.!?\n]{0,30}(?:jal gaya|jal gayi|jal gaye)|(?:तेल|आग|गरम)[^.!?\n]{0,30}जल (?:गया|गई|गए))`;
const PREGNANT = String.raw`(?:pregnan\w*|weeks?|months? pregnant|mahine|mahina|garbh|गर्भ|महीने|महीना|प्रेग्नेंट)`;
const WATERS = String.raw`(?:waters? (?:has |have )?(?:broke|broken|burst|leaking)|leaking (?:fluid|water)|paani (?:jaisa )?(?:discharge|nikal|gir)|thaili phat|पानी (?:जैसा )?(?:डिस्चार्ज|निकल|गिर)|थैली फट)`;
const PREG_BLEEDING = String.raw`(?:bleeding|blood|spotting heavily|khoon|खून|ब्लीडिंग)`;
const BABY_STILL = String.raw`(?:baby (?:isn'?t|is not|not|hasn'?t|has not|stopped|doesn'?t|is no longer) (?:moving|kicking|been moving)|no (?:baby )?movements?|baby ki (?:movement|harkat|halchal) (?:band|nahi|kam)|बच्चा (?:हिल|हिलना) (?:नहीं|बंद)|बच्चे की (?:हलचल|हरकत) (?:बंद|नहीं|कम))`;
const HEAVY_BLEEDING = String.raw`(?:bleeding (?:heavily|a lot|badly|won'?t stop|not stopping|that won'?t stop)|(?:heavy|lot of|so much) bleeding|blood (?:won'?t|will not|isn'?t) stop\w*|bahut (?:zyada )?khoon|khoon (?:ruk nahi|nahi ruk|band nahi)|बहुत (?:ज़्यादा |ज्यादा )?खून|खून (?:नहीं रुक|रुक नहीं|बंद नहीं))`;

const near = (a: string, b: string) =>
  new RegExp(`${a}${NEAR}${b}|${b}${NEAR}${a}`, 'iu');

/** Someone: a person the emergency is happening to. */
const PERSON = String.raw`(?<![\p{L}\p{M}])(?:someone|somebody|some(?:one|body) here|a (?:man|woman|lady|guy|person|child|kid|boy|girl|baby|colleague|customer|member|visitor|student|patient|volunteer|worker|staff member)|he|she|they|him|her|my (?:\w+ )?(?:father|mother|dad|mum|mom|son|daughter|wife|husband|brother|sister|friend|baby|child|grandfather|grandmother|colleague)|papa|mummy|bhai|behen|koi|dadi|dada|nani|nana|wo|woh|vo|use|unhe|uncle|aunty|bete|beta|beti|bachcha|bachche|baccha|bacche|ladka|ladki|कोई|बेटे|बेटा|बेटी|बच्चा|बच्चे|पापा|मम्मी|दादी|दादा|नानी|नाना|वो|वह|उसे|उन्हें|उनको)(?![\p{L}\p{M}])`;
const CHOKING = String.raw`(?:choking|choked|(?:something|food|a coin|a bone) (?:is )?stuck in (?:his|her|my|their|the) throat|gale me(?:in)? (?:kuch )?atak|गले में (?:कुछ )?अटक)`;
const FIRE = String.raw`(?:(?:is|are|caught) on fire|fire (?:in|at) (?:the|our|my)|(?:a|the) fire (?:broke out|has started)|building is burning|aag lag|आग लग)`;
const ATTACKED = String.raw`(?:(?:being |been |was |got )?(?:attacked|stabbed|assaulted)|beaten (?:up|badly)|(?:badly|seriously|very badly) (?:injured|hurt)|hit by a (?:car|bike|bus|truck|vehicle)|maar (?:diya|rahe|raha)|chaku (?:maar|mara)|हमला|चाकू मार)`;

/*
 * Floods and being trapped (TF1 round 2, S-2: "Water is entering our house and we are trapped" got
 * the self-harm crisis reply; the classifier read "trapped" as someone unsafe). Each needs two
 * signs it is happening now, so a flood-relief NGO's own questions ("Where is the flood relief
 * camp?", "baadh peediton ke liye daan") and feelings ("I feel trapped in my life") stay with the
 * classifier.
 */
const W = (body: string) =>
  String.raw`(?<![\p{L}\p{M}])(?:${body})(?![\p{L}\p{M}])`;
const WATER = W(String.raw`water|flood ?water|paani|pani|पानी`);
const WATER_NOW = String.raw`(?:entering|coming in(?:to)?|come in(?:to)?|pouring in(?:to)?|getting in(?:to)?|rising|ghus(?: gaya| gayi| raha| rahi)?|aa gaya|aa raha|bhar (?:gaya|raha|rahi)|badh raha|घुस|भर (?:गया|रहा|रही)|आ गया|आ रहा|बढ़ रहा)`;
const HOME = W(
  String.raw`house|home|room|flat|basement|building|ground floor|ghar|makaan|kamre|घर|मकान|कमरे`,
);
/** "flood" or "baadh", never followed by what the NGO does about one. */
const FLOOD_WORD = String.raw`${W(String.raw`flood(?:ed|ing)?|baadh|baarh|बाढ़`)}(?!\s*(?:relief|victims?|camp|donations?|daan|peedit\w*|पीड़ित|राहत|area|zone|insurance|update|with\b))`;
const FLOOD_NOW = W(
  String.raw`right now|now|abhi|अभी|entering|rising|aa gay[ai]|aa rah[ai]|आ गई|आ गया|आ रही`,
);
const TRAPPED = W(
  String.raw`trapped|stuck|can'?t get out|cannot get out|phans? gaye|phans? gayi|phanse|fas gaye|fas gayi|fase|nikal nahi pa|फँस|फंस|निकल नहीं पा`,
);
const PHYSICAL = W(
  String.raw`water|flood(?:ed|ing)?|fire|smoke|building|lift|elevator|rubble|debris|roof|terrace|car|paani|baadh|chhat|aag|dhuan|malba|पानी|बाढ़|आग|धुआँ|छत|मलबे|लिफ्ट`,
);

/** A rule matched only when every part is found; the first part is the signal. */
const allOf = (...parts: RegExp[]): Rule => ({
  exec(text: string) {
    const first = parts[0].exec(text);
    return first && parts.slice(1).every((p) => p.test(text)) ? first : null;
  },
});

/** Water coming into a home, a flood happening now, or someone trapped by water, fire or rubble. */
export const DISASTER_RULES: Rule[] = [
  allOf(
    new RegExp(`${WATER}${NEAR}${WATER_NOW}`, 'iu'),
    new RegExp(HOME, 'iu'),
  ),
  near(FLOOD_WORD, FLOOD_NOW),
  near(TRAPPED, PHYSICAL),
];

/** Whether a message describes a flood happening now (the emergency reply's "highest place"). */
export function isFloodNow(text: string | null | undefined): boolean {
  const said = text ?? '';
  return (
    DISASTER_RULES[0].exec(said) !== null ||
    DISASTER_RULES[1].exec(said) !== null ||
    (DISASTER_RULES[2].exec(said) !== null &&
      new RegExp(
        `${WATER}|${W(String.raw`flood(?:ed|ing)?|baadh|baarh|बाढ़`)}`,
        'iu',
      ).test(said))
  );
}

/**
 * Life-threatening emergencies (Q4, approved 23 Nov): on every assistant, whatever its pack, and
 * they decide on their own (`lifeThreatening`): a coworking hub's "someone collapsed in the hub
 * and isn't breathing" went to an answer when the classifier missed it. Each needs a person or a
 * sign it's happening now, so "the deal collapsed" or "what is a seizure?" stays a question.
 */
export const LIFE_RULES: Rule[] = [
  ...DISASTER_RULES,
  new RegExp(BREATHING, 'iu'),
  near(PERSON, UNCONSCIOUS),
  new RegExp(CHOKING, 'iu'),
  new RegExp(HEAVY_BLEEDING, 'iu'),
  near(CHEST, NOW),
  near(PERSON, SEIZURE),
  new RegExp(POISON, 'iu'),
  new RegExp(STROKE, 'iu'),
  new RegExp(SEVERE_BURN, 'iu'),
  new RegExp(FIRE, 'iu'),
  new RegExp(ATTACKED, 'iu'),
];

/** Maternity rules (Q4 A1): only on a medical assistant. */
export const MEDICAL_RULES: RegExp[] = [
  new RegExp(WATERS, 'iu'),
  near(PREGNANT, PREG_BLEEDING),
  new RegExp(BABY_STILL, 'iu'),
];

function verdictFrom(rules: Rule[], said: string): CrisisCheckResponse | null {
  for (const rule of rules) {
    const match = rule.exec(said);
    if (match) {
      return {
        is_crisis: true,
        level: 'emergency',
        signal: match[0].trim().slice(0, 200),
        confidence: 1,
        failed: false,
      } as CrisisCheckResponse;
    }
  }
  return null;
}

/**
 * A life-threatening emergency by the keyword rules, on any assistant: it decides without the
 * classifier, so the emergency reply goes out at once.
 */
export function lifeThreatening(
  text: string | null | undefined,
): CrisisCheckResponse | null {
  const said = (text ?? '').trim();
  return said ? verdictFrom(LIFE_RULES, said) : null;
}

/** The packs whose assistants get the medical and maternity rules (Q4 A1). */
export const MEDICAL_PACKS = new Set(['medical', 'pharmacy']);

/**
 * An emergency verdict from the keyword rules, or null. The phrase that matched is the signal,
 * verbatim, as the classifier gives it. The eye rules apply on every assistant; the medical and
 * maternity rules on a medical assistant (`pack`).
 */
export function emergencyByKeywords(
  text: string | null | undefined,
  pack?: string | null,
): CrisisCheckResponse | null {
  const said = (text ?? '').trim();
  if (!said) return null;
  const rules = MEDICAL_PACKS.has(String(pack ?? ''))
    ? [...RULES, ...LIFE_RULES, ...MEDICAL_RULES]
    : [...RULES, ...LIFE_RULES];
  return verdictFrom(rules, said);
}

/*
 * Indirect hopelessness (Q4 H1, Sukoon live: "Honestly some days I feel there's no point to
 * anything" after a booking got "Please contact the team"). On a mental-health assistant these are
 * at risk, and decide at once like the life-threatening rules.
 */
const HOPELESS = String.raw`(?:no point (?:to|in) (?:anything|everything|living|life|going on|trying)|what'?s the point(?: of (?:anything|living|life|it all|going on|trying)(?: anymore)?| anymore|(?=\s*(?:[.?!,…]|$)))|(?:don'?t|do not) want to (?:wake up|be here|exist|live|go on)(?: anymore)?|tired of (?:living|life|being alive)|(?:want|wanna) (?:it all|everything) to (?:end|stop)|end it all|no reason to (?:live|go on|keep going)|better off without me|can'?t (?:go on|do this) anymore|can'?t go on(?:\s+(?:like this|living))?(?=\s*(?:[.!?,…]|$))|(?:kisi cheez|kuch bhi|zindagi) ka koi matlab nahi|koi matlab nahi (?:lagta|hai)|(?:uthne|jeene) ka (?:mann|man|dil) nahi|jeena nahi (?:chahta|chahti)|sab khatam karna|कोई मतलब नहीं|जीने का मन नहीं|उठने का मन नहीं|जीना नहीं चाहता|जीना नहीं चाहती)`;

/** The packs whose assistants treat indirect hopelessness as at risk (Q4 H1). */
export const HOPELESS_PACKS = new Set(['mental_health']);

export function atRiskByKeywords(
  text: string | null | undefined,
  pack?: string | null,
): CrisisCheckResponse | null {
  const said = (text ?? '').trim();
  if (!said || !HOPELESS_PACKS.has(String(pack ?? ''))) return null;
  const match = new RegExp(HOPELESS, 'iu').exec(said);
  return match
    ? ({
        is_crisis: true,
        level: 'at_risk',
        signal: match[0].trim().slice(0, 200),
        confidence: 1,
        failed: false,
      } as CrisisCheckResponse)
    : null;
}

/*
 * Distress, not risk (TF1 round 2, S-3: "I'm so stressed and tired of everything" got the fixed
 * crisis reply and the at-risk flag). On a mental-health assistant these make the turn at least
 * upset: a warm reply that still carries 112 and 14416. They never decide on their own: the
 * classifier still runs, with history and alone, and the more severe verdict wins, so it can raise
 * the turn to at risk.
 */
const DISTRESS = String.raw`(?:(?:so|very|really|too|extremely|bahut|itna|itni) (?:stressed|tired|exhausted|overwhelmed|anxious|low|down|drained)|stressed out|tired of everything|sick of everything|fed up with everything|overwhelmed|can'?t take (?:it|this|any more|anymore)|thak (?:gaya|gayi|gai) (?:hoon|hu|hun)|sab se thak|bahut tension|बहुत तनाव|थक (?:गया|गई) (?:हूँ|हूं)|सब से थक)`;

export function upsetByKeywords(
  text: string | null | undefined,
  pack?: string | null,
): CrisisCheckResponse | null {
  const said = (text ?? '').trim();
  if (!said || !HOPELESS_PACKS.has(String(pack ?? ''))) return null;
  const match = new RegExp(DISTRESS, 'iu').exec(said);
  return match
    ? ({
        is_crisis: false,
        level: 'upset',
        signal: match[0].trim().slice(0, 200),
        confidence: 1,
        failed: false,
      } as CrisisCheckResponse)
    : null;
}

const SEVERITY: Record<string, number> = {
  emergency: 3,
  at_risk: 2,
  upset: 1,
  none: 0,
};

/**
 * The more severe of two verdicts (Q4 H1: the latest message judged with its history and on its
 * own; a message at risk on its own is never cleared by its context). A failed one never wins over
 * one that answered.
 */
export function moreSevere(
  a: CrisisCheckResponse | null,
  b: CrisisCheckResponse | null,
): CrisisCheckResponse | null {
  if (!a || a.failed) return b && !b.failed ? b : (a ?? b);
  if (!b || b.failed) return a;
  const level = (v: CrisisCheckResponse) =>
    SEVERITY[v.level ?? (v.is_crisis ? 'at_risk' : 'none')] ?? 0;
  return level(b) > level(a) ? b : a;
}
