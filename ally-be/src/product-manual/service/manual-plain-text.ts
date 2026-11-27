const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&#x27;': "'",
};

/**
 * A search snippet as plain text for a model: the search service builds it as escaped HTML with
 * `<mark>` around the matches (for the reader UI), which a model reads as noise (`&quot;new
 * badge&quot;`). Strips the marks, then decodes the five entities the escaper writes. `&amp;` is
 * decoded in the same single pass, so `&amp;lt;` stays the literal text `&lt;`.
 */
export function snippetToPlainText(snippet: string | null | undefined): string {
  return String(snippet ?? '')
    .replace(/<\/?mark>/g, '')
    .replace(/&(?:amp|lt|gt|quot|#39|#x27);/g, (entity) => ENTITIES[entity]);
}
