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

/** Medical and maternity rules (Q4 A1), by what they are, for the tests and the signal. */
export const MEDICAL_RULES: RegExp[] = [
  near(CHEST, NOW),
  new RegExp(BREATHING, 'iu'),
  new RegExp(UNCONSCIOUS, 'iu'),
  new RegExp(SEIZURE, 'iu'),
  new RegExp(POISON, 'iu'),
  new RegExp(STROKE, 'iu'),
  new RegExp(SEVERE_BURN, 'iu'),
  new RegExp(HEAVY_BLEEDING, 'iu'),
  new RegExp(WATERS, 'iu'),
  near(PREGNANT, PREG_BLEEDING),
  new RegExp(BABY_STILL, 'iu'),
];

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
    ? [...RULES, ...MEDICAL_RULES]
    : RULES;
  for (const rule of rules) {
    const match = rule.exec(said);
    if (match) {
      return {
        is_crisis: true,
        level: 'emergency',
        signal: match[0].trim().slice(0, 200),
        confidence: 1,
        failed: false,
      };
    }
  }
  return null;
}
