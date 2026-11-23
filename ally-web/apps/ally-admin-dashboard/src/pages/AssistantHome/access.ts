import { ChatbotMemberRole } from "@types";
import type { Chatbot } from "@types";

/**
 * What the caller may do on one chatbot, from its role set. Reads `myRoles` once the API sends it
 * and falls back to the single `myRole` until then (the old one is dual-written).
 */
export interface ChatbotAccess {
  roles: ChatbotMemberRole[];
  /** Change what it knows and how it answers: Owner and Editor. */
  build: boolean;
  /** Read and take over conversations: Responder, Editor and Owner. */
  converse: boolean;
  /** Team, seats, channels and removal: Owner. */
  manage: boolean;
  /** Holds Responder and nothing else: sees Conversations and nothing more. */
  responderOnly: boolean;
}

export const chatbotAccess = (
  bot: Pick<Chatbot, "myRole" | "myRoles"> | null | undefined,
): ChatbotAccess => {
  const roles = bot?.myRoles?.length ? bot.myRoles : bot?.myRole ? [bot.myRole] : [];
  const has = (role: ChatbotMemberRole) => roles.includes(role);
  const owner = has(ChatbotMemberRole.OWNER);
  const editor = has(ChatbotMemberRole.EDITOR);
  const responder = has(ChatbotMemberRole.RESPONDER);
  return {
    roles,
    build: owner || editor,
    converse: owner || editor || responder,
    manage: owner,
    responderOnly: responder && !owner && !editor && !has(ChatbotMemberRole.VIEWER),
  };
};

/** Roles in the order people read them: most powerful first. */
export const ROLE_ORDER: ChatbotMemberRole[] = [
  ChatbotMemberRole.OWNER,
  ChatbotMemberRole.EDITOR,
  ChatbotMemberRole.RESPONDER,
  ChatbotMemberRole.VIEWER,
];

/** A role set in reading order, without repeats or words the dashboard doesn't know. */
export const sortRoles = (roles: readonly string[] | undefined | null): ChatbotMemberRole[] =>
  ROLE_ORDER.filter(role => roles?.includes(role));

/** A member's set from the API: `roles` when sent, else the old single `role`. */
export const rolesOfMember = (member: { role?: string; roles?: string[] }): ChatbotMemberRole[] =>
  sortRoles(member.roles?.length ? member.roles : member.role ? [member.role] : []);
