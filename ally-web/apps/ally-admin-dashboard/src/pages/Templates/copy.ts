/**
 * Every string the template screens show (T1): `docs/agents-v2/T1-TEMPLATE-TEXTS.md`, "Screen
 * copy", word for word. The copy test holds each one to that file. The templates' own names,
 * one-liners and questions come from ally-be.
 */
export const TEMPLATE_COPY = {
  start: {
    title: "Start from a template",
    hint: "Pick what your assistant is for. We set up the rest.",
  },
  afterReading: "Want a head start?",
  title: "What is your assistant for?",
  suggested: "Suggested for you",
  use: "Use this template",
  setsUp: "Sets up: {lists}",
  safety: "Safety: {pack}",
  asks: "Asks you {n} questions",
  questionsTitle: "A few questions to make it yours",
  skip: "Skip for now",
  skipNote: "We'll add examples you can replace later.",
  name: "What's it called?",
  yes: "Yes",
  no: "No",
  back: "Back",
  setUp: "Set it up",
  loading: "Getting the templates…",
  failed: "The templates didn't load. Try again.",
  tryAgain: "Try again",
  tools: {
    title: "Add from a template",
    hint: "Add a whole use case: lists, what your assistant may do, and checkup questions.",
    before: "This adds to your assistant. Nothing you already have is changed.",
  },
  result: {
    added: "Added: {lists}.",
    kept: "You already have {list}, so we left it as it is.",
    packKept: "Your assistant already uses {current pack}, which is stricter. We kept it.",
    packRaised: "Safety is now {pack}. You can see what that means in Safety.",
    checkups: "{n} checkup questions added.",
    runCheckup: "Run the checkup",
    done: "Done",
  },
  origin: "Set up from: {template}",
  examplesLeft: "{n} example entries are still in {list}.",
  replaceExamples: "Replace the examples",
  example: "Example",
  publishWarning:
    "Some lists still have example entries. Your assistant may share them as if they were yours.",
  replaceThem: "Replace them",
  publishAnyway: "Publish anyway",
} as const;

/** `{name}` placeholders filled in; unknown ones are left as they are. */
export const fillIn = (text: string, values: Record<string, string | number>): string =>
  text.replace(/\{([^}]+)\}/g, (whole, key: string) =>
    key in values ? String(values[key]) : whole,
  );
