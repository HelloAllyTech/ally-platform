/**
 * Ally admin -> Safety packs (assistants stage 9): curators draft, check, release and roll back the
 * safety packs every chatbot uses. New strings only, never inside `COPY`.
 * Every line below is new wording. // COPY: needs approval
 */
export const SAFETY_PACKS_COPY = {
  nav: "Safety packs",
  title: "Safety packs",
  intro:
    "Every chatbot on a pack uses its current release. A new release goes out only after it passes the crisis check in every supported language, and owners are emailed when it changes.",
  loading: "Loading…",
  loadFailed: "Couldn't load the safety packs. Refresh to try again.",
  switchedOff:
    "Releases are switched off on this server: every chatbot uses the packs written in code.",
  languages: (list: string[]) => `Languages a release must pass: ${list.join(", ")}`,
  pack: {
    current: (version: number | null) =>
      version === null ? "No release yet" : `Current release: version ${version}`,
    code: (version: number) => `Code version ${version}`,
    chatbots: (n: number) => (n === 1 ? "1 chatbot uses it" : `${n} chatbots use it`),
    newDraft: "New draft from current",
    newFromCode: "New draft from code",
    rollback: "Roll back",
    rollbackConfirm: (name: string) =>
      `Roll ${name} back to the release before the current one? Every chatbot on it changes at once and owners are emailed.`,
    rollbackNote: "Why are you rolling back? (optional)",
    rolledBack: "Rolled back. Owners will be emailed.",
    noRollback: "There is no earlier release to go back to.",
    history: "Releases",
  },
  status: {
    draft: "Draft",
    testing: "Checked",
    released: "Released",
    rolled_back: "Rolled back",
    current: "Current",
  } as Record<string, string>,
  release: {
    open: "Open",
    version: (v: number) => `Version ${v}`,
    created: (at: string) => `Created ${at}`,
    releasedAt: (at: string) => `Released ${at}`,
    rolledBackAt: (at: string) => `Rolled back ${at}`,
    note: "Note",
    close: "Close",
  },
  editor: {
    title: (name: string, version: number) => `${name}, version ${version}`,
    readOnly: "Released versions can't be changed. Start a new draft to change it.",
    fields: {
      rules: "Rules given to the assistant (one per line)",
      always: "Always (shown to owners, one per line)",
      never: "Never (shown to owners, one per line)",
      atRisk: "If someone is at risk (shown to owners, one per line)",
      probes: "Safety questions for the check-up (one per line)",
      name: "Name",
      industryLabel: "Industry label",
      builderMessage: "Message to the builder when the pack is turned on",
      summary: "Catalogue line",
      disclaimer: "Disclaimer on the bot page",
    } as Record<string, string>,
    save: "Save draft",
    saved: "Saved. Run the crisis check again before releasing.",
    saveFailed: "Couldn't save this draft.",
    errors: {
      classifier_floor: "The crisis classifier must stay on for this pack.",
      disclaimer_required: "Health packs must keep a disclaimer.",
      rules_required: "A pack needs at least one rule.",
      too_many_lines: "Too many lines in one list.",
      line_too_long: "A line is too long.",
    } as Record<string, string>,
  },
  diff: {
    title: "What changes against the current release",
    none: "Nothing changes against the current release.",
    added: "Added",
    removed: "Removed",
    textChanged: (field: string) => `${field} changed`,
    classifier: (on: boolean) => `Crisis classifier required: ${on ? "on" : "off"}`,
  },
  suite: {
    title: "Crisis check",
    chatbot: "Test on this chatbot",
    chatbotHint:
      "The draft pack is tested on a chatbot you can edit. Ally pays for the check; the chatbot's own settings are not changed.",
    noChatbots: "You need a chatbot of your own to test on.",
    run: "Run crisis check",
    running: "Running in every language. This can take a few minutes.",
    notRun: "Not checked yet.",
    failedToRun: "The check could not run. Try again.",
    passed: "Passed in every language.",
    failed: "Failed in at least one language. Fix the draft and check again.",
    language: (l: string) => l.toUpperCase(),
    result: (passed: number, total: number) => `${passed} of ${total}`,
    statusText: { pass: "Pass", fail: "Fail", error: "Error" } as Record<string, string>,
  },
  gate: {
    release: "Release to every chatbot",
    releaseConfirm: (name: string, n: number) =>
      `Release this version of ${name}? ${n === 1 ? "1 chatbot" : `${n} chatbots`} will use it at once and owners will be emailed.`,
    released: "Released. Owners will be emailed.",
    failed: "Couldn't release.",
    blockers: {
      not_tested: "Run the crisis check first.",
      suite_running: "The crisis check is still running.",
      suite_error: "The last crisis check could not run.",
      content_changed: "The draft changed after the check. Run it again.",
      suite_outdated: "The crisis suite changed since the check. Run it again.",
      no_languages: "No languages to check.",
      already_released: "Already released.",
    } as Record<string, string>,
    languageFailed: (l: string) => `Failed in ${l.toUpperCase()}.`,
    languageMissing: (l: string) => `Not checked in ${l.toUpperCase()}.`,
  },
};
