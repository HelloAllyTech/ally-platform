/**
 * What an admin's persisted chat turn should read as on screen.
 *
 * Builder, Course Copilot and the character interview all store an answered question's turn for
 * the model, not for the admin: a `[answers question <id>] ` prefix, the words the admin chose,
 * and — for a structured answer — a suffix such as ` [selected ids: a, b | custom: "x"]` (or
 * `[none of these]`), so the agent can act on the exact selections. The live feed shows only the
 * admin's words, so a resumed one must too; the card already shows the labels.
 */

/** The prefix the server adds to a turn that answers a question card. */
const ANSWER_PREFIX_RE = /^\[answers question [^\]]+\]\s*/i;

/**
 * The structured-answer suffix. Custom values are quoted and may themselves contain `]`, so a
 * quoted run is consumed whole rather than stopping at the first bracket.
 */
const ANSWER_SUFFIX_RE = /\s*\[(?:none of these|selected ids:|custom:)(?:[^\]"]|"[^"]*")*\]\s*$/i;

export const userTurnText = (content: string | null | undefined): string =>
  (typeof content === "string" ? content : "")
    .replace(ANSWER_PREFIX_RE, "")
    .replace(ANSWER_SUFFIX_RE, "");
