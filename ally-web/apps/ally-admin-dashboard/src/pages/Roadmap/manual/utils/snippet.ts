/**
 * A search hit's `snippet` is HTML in which only `<mark>` is allowed (the server builds it from
 * escaped text). It is never rendered as HTML here: it is split on `<mark>` / `</mark>` into plain
 * text pieces, each flagged as highlighted or not, and React renders the text as text. Any other
 * tag that slipped through therefore shows as its literal characters instead of running.
 */
export interface SnippetPart {
  text: string;
  mark: boolean;
}

/** The five entities the server's escaping produces. Nothing else is decoded. */
const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

/**
 * Undo the server's HTML escaping for display (e.g. "learner&#39;s"). Only the five entities it
 * writes; the result is rendered as a text node, so nothing decoded here can run.
 */
export const decodeEntities = (text: string): string =>
  text.replace(/&(?:amp|lt|gt|quot|#39);/g, entity => ENTITIES[entity] ?? entity);

/**
 * Snippets come from page bodies, so they can carry markdown the reader never shows: `**`, `#`
 * heading markers, backticks and `[[slug|label]]`. Strip it before splitting on `<mark>`: a
 * wikilink becomes its label (or slug), and the fragment's cut-off ends (`[[scor…`, `…|label]]`)
 * lose their brackets. `<mark>` / `</mark>` contain none of these characters, so they survive.
 */
export const stripSnippetMarkdown = (snippet: string): string =>
  snippet
    // Whole wikilinks, even with highlights inside: the label, else the slug.
    .replace(/\[\[([^\]|]*?)(?:\|([^\]]*?))?\]\]/g, (_m, slug: string, label?: string) =>
      label?.trim() ? label : slug,
    )
    // A fragment that starts inside a labelled link: "slug|label]]" → "label".
    .replace(/(^|[\s(])[a-z0-9]+(?:-[a-z0-9]+)*\|(?=\S)/g, "$1")
    .replace(/\[\[|\]\]/g, "")
    .replace(/\*\*/g, "")
    .replace(/`+/g, "")
    // Heading markers at the start of the text or of a line.
    .replace(/(^|\n)\s*#{1,6}\s+/g, "$1")
    .replace(/(^|\s)#{1,6}\s+/g, "$1");

export const parseSnippet = (snippet: string | null | undefined): SnippetPart[] => {
  if (!snippet) return [];
  const clean = stripSnippetMarkdown(snippet);
  const parts: SnippetPart[] = [];
  let marked = false;
  for (const piece of clean.split(/(<mark>|<\/mark>)/i)) {
    const lower = piece.toLowerCase();
    if (lower === "<mark>") {
      marked = true;
      continue;
    }
    if (lower === "</mark>") {
      marked = false;
      continue;
    }
    if (!piece) continue;
    const text = decodeEntities(piece);
    const last = parts[parts.length - 1];
    if (last && last.mark === marked) last.text += text;
    else parts.push({ text, mark: marked });
  }
  return parts;
};
