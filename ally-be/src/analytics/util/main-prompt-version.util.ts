/**
 * The main-agent prompt a session ran and its version, read from the session's
 * own record (`metadata.selectedMainPromptCode` + `metadata.promptVersions`).
 *
 * Earlier this guessed: the first `promptVersions` key containing `main_agent`.
 * Now that every ally-ai-learn prompt ships to a session (the Skills Store is
 * the source of truth), the map also holds every `_copy_` variant, so a guess
 * by name would be arbitrary. The selected code is what ran; no selection runs
 * the default main-agent prompt.
 *
 * The JS and SQL forms MUST agree: judge rows are stamped with the JS value and
 * transcript-derived series filter through the SQL one.
 */
export const DEFAULT_MAIN_AGENT_PROMPT_CODE =
  'ally_ai_learn_system_main_agent_prompt';

export function mainPromptVersion(
  promptVersions: Record<string, unknown> | null | undefined,
  selectedMainPromptCode: string | null | undefined,
): string | null {
  if (!promptVersions) return null;
  const code = selectedMainPromptCode || DEFAULT_MAIN_AGENT_PROMPT_CODE;
  const exact = promptVersions[code];
  if (exact != null) return String(exact);
  // Sessions recorded before every prompt shipped: their map holds only the
  // dashboard-overridden prompts, so the old name match is still meaningful.
  const legacy = Object.keys(promptVersions)
    .filter(
      (k) =>
        (k.includes('main_agent') || k.includes('base_role')) &&
        !k.includes('_copy_'),
    )
    .sort()[0];
  if (legacy) return String(promptVersions[legacy]);
  const first = Object.keys(promptVersions).sort()[0];
  return first != null ? String(promptVersions[first]) : null;
}

/** SQL form of {@link mainPromptVersion} for a `scenario_sessions` alias. */
export function mainPromptVersionSql(sessionAlias: string): string {
  const pv = `${sessionAlias}.metadata->'promptVersions'`;
  const entries = `jsonb_each_text(CASE WHEN jsonb_typeof(${pv}) = 'object' THEN ${pv} ELSE '{}'::jsonb END)`;
  return `COALESCE(
    ${pv}->>COALESCE(NULLIF(${sessionAlias}.metadata->>'selectedMainPromptCode', ''), '${DEFAULT_MAIN_AGENT_PROMPT_CODE}'),
    (SELECT value FROM ${entries} AS e(key, value)
      WHERE (e.key LIKE '%main_agent%' OR e.key LIKE '%base_role%')
        AND e.key NOT LIKE '%\\_copy\\_%'
      ORDER BY e.key COLLATE "C" LIMIT 1),
    (SELECT value FROM ${entries} AS e(key, value) ORDER BY e.key COLLATE "C" LIMIT 1)
  )`;
}
