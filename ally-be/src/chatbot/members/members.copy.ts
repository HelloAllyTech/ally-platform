/**
 * Stage 1b wording for team changes, invites and the responder agreement. New strings only.
 */

// COPY: needs approval
export const MEMBER_COPY = {
  invalidRoles: 'Choose at least one role: Owner, Editor, Responder or Viewer.',
  lastOwner:
    'This is the only owner. Make someone else an owner before removing them.',
  lastOwnerCantLeave:
    "You're the only owner. Make someone else an owner before you leave.",
  creatorMustTransfer:
    'This person created the chatbot. They need to hand it over to another owner first.',
  creatorCantLeave:
    'You created this chatbot. Hand it over to another owner before you leave.',
  onlyCreatorCanTransfer:
    'Only the person who created this chatbot can hand it over.',
  transferNotAMember: 'Add them to the team before handing the chatbot over.',
  notAMember: "That person isn't on this chatbot's team.",
} as const;

// COPY: needs approval
export const INVITE_COPY = {
  platformAdmin:
    "That's an Ally staff account. Staff can't be invited to a chatbot.",
  alreadyMember: "They're already on this chatbot's team.",
  notFound: 'This invite has expired or was withdrawn. Ask for a new one.',
  wrongEmail:
    'This invite was sent to a different email address. Sign in with that address to accept it.',
} as const;

/**
 * The responder agreement. Bump `RESPONDER_AGREEMENT_VERSION` when the text changes: a new version
 * blocks new take-overs (and a responder-only member's reading of new chats) until accepted, never
 * conversations a person already holds.
 */
export const RESPONDER_AGREEMENT_VERSION = 'v2-interim';

// COPY: needs approval (TF1 round 2, Saathi B-10). Interim terms until Sandeep approves the final
// text; replace them, and bump the version, when he does.
export const RESPONDER_AGREEMENT_TEXT = `Interim terms, until the final version is approved.
When you reply to people through this assistant, you agree to:
- reply kindly and plainly, and say you are a person from the team when you take over;
- never give medical, legal or financial advice, or a diagnosis;
- pass on anyone who may be at risk at once, following the assistant's crisis guidance, and tell them to call 112 if they are in danger;
- keep every chat confidential: never share what people tell you outside the team;
- hand the chat back to the assistant when you are done.`;
