/**
 * A skill (plans/ally-guide/plan.md §7.3, §7.6): instructions Ally loads on
 * demand with `load_skill`, appended to the conversation as a tool result.
 * Only the one-line index sits in the cached S1 slot; the body costs tokens
 * only in the turn that needs it, and loading it appends rather than
 * changes the context, so the cached prefix stays valid.
 *
 * The code holds the defaults; each release freezes the text it ships
 * (`GuideReleaseBundle.skillDefs`), so a rollback restores the exact words.
 * Public repository: the text describes behaviour, never the frameworks it
 * draws on.
 */
export interface GuideSkill {
  id: string;
  version: number;
  title: string;
  /** One line for the index in S1: when to load it. */
  whenToUse: string;
  instructions: string;
}
