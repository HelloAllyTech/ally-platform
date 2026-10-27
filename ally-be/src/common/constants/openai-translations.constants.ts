/**
 * Course (track) content translation: src/prompts/openai_track/content_translation.txt.
 *
 * Fields arrive as an opaque `{f1: {...}}` map rather than the real course
 * structure: the model never sees a question id, an option id or an answer key,
 * so it cannot reshape the course — the caller reads results back by key and
 * splices them into the authored structure itself. `kind` tells the model what
 * each string is for, because a fill-blank accepted answer and an article body
 * need opposite treatment.
 */
export const OPENAI_TRACK_CONTENT_TRANSLATION_PROMPT_CODE =
  'openai_track_content_translation';
