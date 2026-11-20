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

/**
 * An emergency verdict from the keyword rules, or null. The phrase that matched is the signal,
 * verbatim, as the classifier gives it.
 */
export function emergencyByKeywords(
  text: string | null | undefined,
): CrisisCheckResponse | null {
  const said = (text ?? '').trim();
  if (!said) return null;
  for (const rule of RULES) {
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
