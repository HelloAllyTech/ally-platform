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
export const RESPONDER_AGREEMENT_VERSION = 'v1';

// COPY: needs approval — placeholder text; the plan (section 7) needs sign-off before stage 1b ships.
export const RESPONDER_AGREEMENT_TEXT = `PLACEHOLDER - NOT APPROVED.
When you reply to people through this chatbot you agree to:
- treat what people tell you as private and not share it outside the team;
- follow the chatbot's crisis guidance and never give medical, legal or emergency instructions;
- say you are a person when you take over, and hand the chat back when you are done.`;
