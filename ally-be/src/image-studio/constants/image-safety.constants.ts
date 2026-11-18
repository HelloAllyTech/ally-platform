/**
 * What an image on this platform may show. Learners are counsellors in
 * training and the content is often about suicide, self-harm, abuse and
 * crisis, so the rules follow safe-messaging practice: show the person's
 * emotion and the setting, never a method, an injury or the act.
 *
 * Appended in code to every compiled image prompt and checked by the judge,
 * so editing a prompt in the Skills Store cannot remove them. Changing this
 * text needs a clinical lead's sign-off (docs/image-studio.md, Safety).
 */
export const IMAGE_GUARDRAILS = [
  'No text, letters, numbers, captions, signs, logos or watermarks anywhere in the image.',
  'No identifiable real or famous person.',
  'Never show a method of suicide or self-harm, an injury, wound, scar, blood, a weapon, a ligature, pills or medication held by someone at risk, or a person at a height edge. Show distress only through posture, facial expression, lighting and setting.',
  'Nothing sexual or nude; any child appears only in a safe, ordinary everyday context.',
  'People are depicted with dignity and without stereotypes.',
];

/**
 * Backstop for the compose step's safety screen when the model is unavailable
 * (or answers malformed JSON): a description naming a method or an injury is
 * blocked rather than sent to the image provider unchecked. Deliberately
 * narrow — words like "suicide" or "abuse" alone are the course's subject and
 * must not block anything.
 */
export const BLOCKED_DEPICTION_PATTERNS: RegExp[] = [
  /\b(noose|ligature|hanging (him|her|them)sel(f|ves)|hanged)\b/i,
  /\b(slit|slitting|cutting) (his|her|their|my)? ?(wrists?|arms?|skin)\b/i,
  /\b(wrist|arm|self[- ]?harm) (cuts|wounds|scars)\b/i,
  /\b(blood|bleeding|bloody)\b/i,
  /\b(overdos(e|ing)|handful of pills|swallowing pills)\b/i,
  /\b(gun|pistol|rifle|knife|blade|razor) (to|against|at) (his|her|their|my) (head|throat|wrist|chest)\b/i,
  /\b(jumping|about to jump|standing on the (edge|ledge|railing))\b/i,
  /\b(naked|nude|sexual|sex scene)\b/i,
];

export const SAFETY_SUGGESTION_DEPICTION =
  'Show the emotion and body language, not the act or the injury — for example "sitting alone on the edge of the bed, head in hands, curtains drawn".';

/** Shapes that look like a real person's records rather than a training scenario. */
export const PERSONAL_DATA_PATTERNS: RegExp[] = [
  /\b\d{10}\b/, // phone number
  /\b\d{3}[-\s]\d{3}[-\s]\d{4}\b/,
  /\b[\w.+-]+@[\w-]+\.[\w.]+\b/, // email
  /\b(MRN|patient id|case no\.?|aadhaar)\s*[:#]?\s*\w+/i,
];

export const SAFETY_SUGGESTION_PERSONAL_DATA =
  'Describe a fictional person instead — leave out names, numbers and details from a real client.';

export interface KeywordScreenResult {
  ok: boolean;
  reason?: string;
  suggestion?: string;
}

/** The local backstop. Runs on every request, before and regardless of the model's screen. */
export const keywordScreen = (text: string): KeywordScreenResult => {
  if (BLOCKED_DEPICTION_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      ok: false,
      reason:
        'This asks for something we never show in images: a method of self-harm, an injury, a weapon or sexual content.',
      suggestion: SAFETY_SUGGESTION_DEPICTION,
    };
  }
  if (PERSONAL_DATA_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      ok: false,
      reason:
        'This looks like it contains real personal details (a phone number, email or record number).',
      suggestion: SAFETY_SUGGESTION_PERSONAL_DATA,
    };
  }
  return { ok: true };
};
