import { ChatbotCapability, ChatbotMemberRole } from '../enum/chatbot.enum';

/**
 * Stage 1b: a member holds a SET of roles; each role grants capabilities. Pure functions only, so
 * the guard, the services, the raw-SQL readers and the tests share one definition.
 */

/** Canonical order: how a set is stored and shown. */
export const CHATBOT_ROLE_ORDER: readonly ChatbotMemberRole[] = [
  ChatbotMemberRole.OWNER,
  ChatbotMemberRole.EDITOR,
  ChatbotMemberRole.RESPONDER,
  ChatbotMemberRole.VIEWER,
];

const { VIEW, RESPOND, BUILD, MANAGE_PEOPLE } = ChatbotCapability;

export const ROLE_CAPABILITIES: Record<
  ChatbotMemberRole,
  readonly ChatbotCapability[]
> = {
  [ChatbotMemberRole.OWNER]: [VIEW, RESPOND, BUILD, MANAGE_PEOPLE],
  [ChatbotMemberRole.EDITOR]: [VIEW, RESPOND, BUILD],
  // A responder reads (conversations; the dashboard shows them nothing else, stage 2) and
  // responds. Never BUILD: a responder must not get edit rights.
  [ChatbotMemberRole.RESPONDER]: [VIEW, RESPOND],
  [ChatbotMemberRole.VIEWER]: [VIEW],
};

/** The capability the old `assert(minRole)` / `@ChatbotRole(minRole)` meant. */
export function capabilityForLegacyRole(
  role: ChatbotMemberRole,
): ChatbotCapability {
  switch (role) {
    case ChatbotMemberRole.OWNER:
      return MANAGE_PEOPLE;
    case ChatbotMemberRole.EDITOR:
      return BUILD;
    case ChatbotMemberRole.RESPONDER:
      return RESPOND;
    default:
      return VIEW;
  }
}

export function isChatbotRole(value: unknown): value is ChatbotMemberRole {
  return (
    typeof value === 'string' &&
    (Object.values(ChatbotMemberRole) as string[]).includes(value)
  );
}

/** Deduplicated, in canonical order; unknown names dropped. */
export function normaliseRoles(input: Iterable<unknown>): ChatbotMemberRole[] {
  const set = new Set<ChatbotMemberRole>();
  for (const value of input) {
    const v = typeof value === 'string' ? value.trim().toLowerCase() : value;
    if (isChatbotRole(v)) set.add(v);
  }
  return CHATBOT_ROLE_ORDER.filter((r) => set.has(r));
}

/**
 * The value for the OLD `role` column: the highest of the set on the old ladder. Responder-only
 * is `viewer`, so an old instance gives a responder viewing and nothing more.
 */
export function legacyRole(
  roles: readonly ChatbotMemberRole[],
): ChatbotMemberRole {
  if (roles.includes(ChatbotMemberRole.OWNER)) return ChatbotMemberRole.OWNER;
  if (roles.includes(ChatbotMemberRole.EDITOR)) return ChatbotMemberRole.EDITOR;
  return ChatbotMemberRole.VIEWER;
}

/**
 * A member row's set. `roles` wins; a row an old instance wrote (no `roles` yet, or written before
 * the trigger existed) falls back to its single `role`.
 */
export function rolesOfRow(row: {
  role?: string | null;
  roles?: readonly string[] | string | null;
}): ChatbotMemberRole[] {
  const raw = parsePgArray(row.roles);
  const roles = normaliseRoles(raw);
  if (roles.length) return roles;
  return normaliseRoles([row.role ?? '']);
}

/** node-postgres returns text[] as an array, but a raw query through some drivers gives '{a,b}'. */
function parsePgArray(
  value: readonly string[] | string | null | undefined,
): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return [...value];
  const text = String(value).trim();
  if (!text.startsWith('{')) return [text];
  return text
    .slice(1, -1)
    .split(',')
    .map((s) => s.replace(/^"|"$/g, '').trim())
    .filter(Boolean);
}

export function capabilitiesOf(
  roles: readonly ChatbotMemberRole[],
): Set<ChatbotCapability> {
  return new Set(roles.flatMap((r) => ROLE_CAPABILITIES[r] ?? []));
}

export function can(
  roles: readonly ChatbotMemberRole[],
  capability: ChatbotCapability,
): boolean {
  return capabilitiesOf(roles).has(capability);
}

/**
 * Holds Responder and nothing that already lets them read every conversation as a viewer would:
 * the person the responder agreement gates even for reading a thread.
 */
export function isResponderOnly(roles: readonly ChatbotMemberRole[]): boolean {
  return (
    roles.includes(ChatbotMemberRole.RESPONDER) &&
    !roles.some((r) =>
      [
        ChatbotMemberRole.OWNER,
        ChatbotMemberRole.EDITOR,
        ChatbotMemberRole.VIEWER,
      ].includes(r),
    )
  );
}

/** A member input as the API takes it: the new `roles`, or the old single `role`. */
export function rolesFromInput(input: {
  role?: unknown;
  roles?: unknown;
}): ChatbotMemberRole[] {
  if (Array.isArray(input.roles) && input.roles.length) {
    return normaliseRoles(input.roles);
  }
  return normaliseRoles([input.role]);
}

/** SQL fragment: "this member row holds `role`" (roles first, old column as fallback). */
export const sqlHasRole = (alias: string, role: ChatbotMemberRole): string =>
  `('${role}' = ANY(COALESCE(${alias}.roles, ARRAY[${alias}.role]::text[])))`;
