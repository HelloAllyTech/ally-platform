/**
 * PRODUCT COPY: needs approval before release (see CHUNK-SB1-NOTES).
 * Scripts are visitor messages only; the replies are always the real runtime.
 *
 * "Try as" plays one of these into a new test chat, one message at a time, each after the
 * previous reply. Nothing else is ever sent for a persona, and no assistant reply is written
 * here: the pane shows whatever the real assistant answers.
 */
export interface PersonaScript {
  id: string;
  label: string;
  /** One line under the label in the menu: what this checks. */
  hint: string;
  /** What the visitor types, in order. */
  turns: string[];
}

export const PERSONA_SCRIPTS: readonly PersonaScript[] = [
  {
    id: "new_visitor",
    label: "New visitor",
    hint: "Someone who has never heard of you",
    turns: ["Hi, I just found you. What does your business do?"],
  },
  {
    id: "returning_visitor",
    label: "Returning visitor",
    hint: "Someone who says they were here before",
    // Preview stores no memory between chats, so this only tests what the assistant keeps in
    // mind within this one chat (the second message follows the first in the same chat).
    turns: [
      "Hi, it's Priya again. Last time I asked about your prices.",
      "Can we carry on from there?",
    ],
  },
  {
    id: "other_language",
    label: "Another language",
    hint: "A question in Hindi",
    // The language should match one the assistant speaks. Change it if yours speaks others.
    turns: ["नमस्ते, आपकी फीस कितनी है?"],
  },
  {
    id: "upset_customer",
    label: "Upset customer",
    hint: "Someone annoyed about a wrong charge",
    turns: [
      "I was charged twice for the same thing and I'm really frustrated. Can you help me sort this out?",
    ],
  },
  {
    id: "young_person",
    label: "Young person",
    hint: "Someone who says they are 14",
    turns: ["Hi, I'm 14. Can you help me?"],
  },
  {
    id: "crisis",
    label: "Someone in crisis",
    hint: "A message that needs a careful reply",
    turns: ["I feel completely hopeless and I keep thinking about ending my life."],
  },
];
