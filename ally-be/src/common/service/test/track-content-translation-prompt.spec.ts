import {
  OPENAI_TRACK_CONTENT_TRANSLATION,
  renderPrompt,
} from 'src/prompt/contracts';
import { shippedPromptDefault } from 'src/common/util/prompt-template.util';
import { renderTemplate } from 'src/learn/util/autofill-shared.util';

/**
 * The course-content translation prompt
 * (DEFAULT_OPENAI_TRACK_CONTENT_TRANSLATION_PROMPT_TEMPLATE) moved out of code
 * into a shipped default. LEGACY is the removed constant verbatim — a frozen
 * copy of its source as it stood in git before the move.
 *
 * The one difference is whitespace at the ends: the constant began and ended
 * with a newline, and the Skills Store trims every body (sync stores
 * content.trim(), and so does the file fallback). With the same inputs the
 * rendered prompt is the old one minus that leading and trailing newline.
 */
const LEGACY = `
You are a native {{languageName}} speaker localising a counsellor-training
course. The learners are practising counsellors who will read this content and
be assessed on it.

Re-express each string as natural, idiomatic {{languageName}} — the way a
{{languageName}}-speaking trainer would actually write it. Do not translate
word-for-word.

{{toneGuidance}}
{{glossary}}
════════════════════════════════════════════════════
🧾 PER-FIELD RULES — obey the "kind" on each field
════════════════════════════════════════════════════
- TITLE / LABEL: keep it as short as the English. No added explanation.
- DESCRIPTION / PROSE: natural {{languageName}} prose, same register.
- HTML: translate only the visible text. Every tag, attribute, entity and
  self-closing marker must survive byte-for-byte. Never add or remove markup.
- BLANK_TEMPLATE: placeholders of the form <blankToken> mark the gaps the
  learner fills in. Reproduce every placeholder exactly, unchanged and
  untranslated, and place them where they read naturally in {{languageName}}.
- SHORT_ANSWER: this is a marking key — the exact word or phrase a learner must
  type to be marked correct. Give the single most natural {{languageName}}
  equivalent. No alternatives, no punctuation, no explanation, no parentheses.
- RUBRIC: read by an automated grader, not the learner. Preserve the precise
  assessment criteria; do not soften or generalise them.
- SPEAKER: a person's name or role in a transcript. Transliterate names into
  the {{languageName}} script; translate role words ("Counsellor", "Caller").

════════════════════════════════════════════════════
🧠 GENERAL RULES
════════════════════════════════════════════════════
1. Translate EVERY field you are given. Never omit a key.
2. Return the SAME keys you were given, unchanged.
3. "context" is background only — never translate it, never echo it.
4. Preserve the meaning exactly. This content is assessed; an invented detail
   becomes a wrong answer.
5. Keep clinical and safeguarding terminology precise. Where a technical term
   has no settled {{languageName}} equivalent, keep the English term rather
   than coining a new one.
6. Never add commentary, notes, or translator's remarks.

════════════════════════════════════════════════════
🧾 OUTPUT
════════════════════════════════════════════════════
Return ONLY a valid JSON object mapping each field key to its translated
string, e.g. {"f1": "...", "f2": "..."}. No markdown, no commentary.

Fields to translate:
{{inputJson}}
`;

const INPUTS = {
  languageName: 'Hindi',
  toneGuidance: 'Warm, plain Hindi.',
  glossary: 'counsellor → परामर्शदाता',
  blankToken: '{{blankId}}',
  inputJson: JSON.stringify([{ key: 'f1', kind: 'TITLE', text: 'Hello' }]),
};

describe('openai_track_content_translation', () => {
  it('ships the removed constant as its default, trimmed as the store keeps it', () => {
    expect(shippedPromptDefault(OPENAI_TRACK_CONTENT_TRANSLATION.code)).toBe(
      LEGACY.trim(),
    );
  });

  it('renders what the call site rendered before, less the end newlines', () => {
    const shipped = shippedPromptDefault(
      OPENAI_TRACK_CONTENT_TRANSLATION.code,
    )!;
    const before = renderTemplate(LEGACY, INPUTS);
    const after = renderPrompt(
      OPENAI_TRACK_CONTENT_TRANSLATION,
      shipped,
      INPUTS,
    );
    expect(after).toBe(before.trim());
    expect(before).toBe(`\n${after}\n`);
    // The fill-blank marker still renders to the literal placeholder.
    expect(after).toContain('placeholders of the form {{blankId}} mark');
  });
});
