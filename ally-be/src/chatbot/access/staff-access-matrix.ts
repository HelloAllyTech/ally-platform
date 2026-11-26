/**
 * Assistants stage 8 — what Ally staff may read on a chatbot they are not a member of.
 *
 * Staff (the `system:access` permission, as `StaffOnlyGuard`) get VIEW and nothing else on any
 * chatbot, and only on the routes this matrix names. Every staff read writes a
 * `chatbot_staff_views` row first; when that write fails the read is refused (fail closed).
 * Routes needing build, respond or manage-people never admit staff, whatever this file says.
 *
 * Policies:
 * - `setup`: setup data (settings, knowledge, test results, analytics, change history).
 * - `conversations`: conversation content or a customer's data (threads, memory, contacts,
 *   list records, access lists). Only while the owner has a live grant (`chatbot_access_grants`).
 * - `deny`: never, even with a grant: the route changes something or spends money although the
 *   member check calls it a "view" route.
 *
 * A view route missing here is denied (default `deny`), and `staff-access-matrix.spec.ts` fails, so
 * every new view route has to be classified here. Keyed by `Controller.handler`, so the
 * controllers themselves carry no staff decorator.
 *
 * | Route                                                   | Handler                                   | Staff policy  | Why |
 * |---------------------------------------------------------|-------------------------------------------|---------------|-----|
 * | GET  v1/chatbots/:id                                    | ChatbotController.get                     | setup         | The chatbot's settings |
 * | GET  v1/chatbots/:id/settings                           | ChatbotController.getSettings             | setup         | Settings |
 * | GET  v1/chatbots/:id/documents                          | ChatbotController.listDocuments           | setup         | Knowledge |
 * | GET  v1/chatbots/:id/documents/:documentId              | ChatbotController.getDocument             | setup         | Knowledge (the builder's own text) |
 * | GET  v1/chatbots/:id/members                            | ChatbotController.listMembers             | setup         | The team, not customers |
 * | GET  v1/chatbots/:id/audience                           | ChatbotController.listAudience            | conversations | Customers' phone numbers |
 * | POST v1/chatbots/:id/restore                            | ChatbotController.restore                 | deny          | Changes the chatbot |
 * | POST v1/chatbots/:id/test                               | ChatbotController.test                    | deny          | Spends the builder's credit |
 * | POST v1/chatbots/:id/test/stream                        | ChatbotController.testStream              | deny          | Spends the builder's credit |
 * | GET  v1/chatbots/:id/images                             | BotImageController.list                   | setup         | Page images |
 * | GET  v1/chatbots/:id/page                               | BotPageAdminController.get                | setup         | Bot page settings |
 * | GET  v1/chatbots/:id/page/access                        | BotPageAdminController.listAccess         | conversations | Customers' emails and phones |
 * | GET  v1/chatbots/:id/seats                              | AssistantSeatsController.seats            | setup         | Team seats |
 * | GET  v1/chatbots/:id/publish-use                        | AssistantSeatsController.publishUse       | setup         | Plan use |
 * | GET  v1/inbox/chatbots/:chatbotId/conversations/:id     | InboxController.thread                    | conversations | A conversation (never marked read by staff) |
 * | GET  v1/inbox/chatbots/:chatbotId/contacts/:cid/memory  | InboxController.memoryOf                  | conversations | What it remembers about a person |
 * | GET  v1/inbox/conversations?chatbotId=                  | InboxController.list                      | conversations | Conversation list (list scope, see below) |
 * | GET  v1/inbox/counts?chatbotId=                         | InboxController.counts                    | conversations | Conversation counts (list scope) |
 * | GET  v1/chatbots/:id/lists                              | ListController.listLists                  | setup         | List definitions |
 * | GET  v1/chatbots/:id/lists/ready-made                   | ListController.readyMadeCatalogue         | setup         | Catalogue |
 * | GET  v1/chatbots/:id/lists/:key                         | ListController.getList                    | setup         | One list's fields and rules |
 * | GET  v1/chatbots/:id/lists/contacts                     | ListController.searchContacts             | conversations | Customers |
 * | GET  v1/chatbots/:id/lists/:key/records                 | ListController.listRecords                | conversations | Records collected from customers |
 * | POST v1/chatbots/:id/lists/:key/records/query           | ListController.queryRecords               | conversations | Records (a read with a body) |
 * | GET  v1/chatbots/:id/lists/:key/records/:recordId       | ListController.getRecord                  | conversations | One record |
 * | POST v1/chatbots/:id/leave                              | ChatbotTeamController.leave               | deny          | Changes the team |
 * | GET  v1/chatbots/:id/go-live                            | GoLiveController.checklist                | setup         | Go-live checklist |
 * | GET  v1/chatbots/:id/safety-terms                       | GoLiveController.terms                    | setup         | Safety terms state |
 * | GET  v1/chatbots/:id/knowledge/review                   | ChatbotKnowledgeController.listReview     | setup         | Knowledge held for review (builder uploads) |
 * | GET  v1/chatbots/:id/knowledge/freshness                | ChatbotKnowledgeController.freshnessOf    | setup         | Knowledge age |
 * | GET  v1/chatbots/:id/safety-translations                | ChatbotKnowledgeController.listTranslations | setup       | Safety text |
 * | GET  v1/chatbots/:id/checkup                            | CheckupController.view                    | setup         | Test results |
 * | GET  v1/chatbots/:id/checkup/cases                      | CheckupController.listCases               | setup         | Saved tests |
 * | GET  v1/chatbots/:id/checkup/runs/:runId                | CheckupController.getRun                  | setup         | One test run |
 * | GET  v1/chatbots/:id/changes                            | ChatbotChangesController.changes          | setup         | Change history |
 * | GET  v1/chatbots/:id/team-names                         | ChatbotChangesController.teamNames        | setup         | Team names for the history |
 * | GET  v1/chatbots/:id/working-copy/pending               | WorkingCopyController.pendingForChatbot   | setup         | Unapplied edits |
 * | GET  v1/chatbots/:id/home                               | AssistantHomeController.get               | setup         | The chatbot home |
 * | GET  v1/chatbots/:id/home/lists/quickReplies            | AssistantHomeController.readReplies       | setup         | Quick replies |
 * | GET  v1/chatbots/:id/home/lists/:list                   | AssistantHomeController.readList          | by :list      | team, documents: setup; pageAccess, audience: conversations |
 * | GET  v1/chatbots/:id/sources                            | AssistantHomeController.listSources       | setup         | Knowledge sources |
 * | GET  v1/chatbots/:id/home/numbers                       | AssistantHomeController.numbers           | setup         | WhatsApp numbers |
 * | GET  v1/chatbots/:id/how-it-works                       | AssistantHomeController.howItWorks        | setup         | Explainer |
 * | GET  v1/chatbots/:id/history                            | AssistantHomeController.history           | setup         | Change history |
 * | GET  v1/chatbots/:id/scorecard                          | ScorecardController.view                  | setup         | Analytics (counts only) |
 * | GET  v1/chatbots/:id/home/overview                      | ScorecardController.overview              | setup         | Overview counts; verbatim questions only with a live grant (see below) |
 * | GET  v1/chatbots/:id/widget-sites                       | BotPageAdminController.widgetSites        | setup         | Sites the widget loaded on |
 * | GET  v1/chatbots/:id/page/domains                       | BotPageDomainController.list              | setup         | Custom domains and DNS records |
 * | GET  v1/chatbots/:id/templates                          | TemplateController.catalogue              | setup         | Templates |
 * | GET  v1/chatbots/:id/templates/origin                   | TemplateController.origin                 | setup         | Template origin |
 *
 * The scorecard and overview carry customers' own words (open questions, thumbs-downs, top
 * unanswered). For staff without a live grant the services return counts and themes only
 * (`ChatbotAccessService.mayReadCustomerText`); with a grant they see what the owner sees.
 *
 * Never reachable by staff (member-only capability, by design): `working-copy` (creates one),
 * `invites`, `staff-access`, `staff-views` (manage people), `lists/:key/export.csv` (build).
 *
 * Not covered here: list-scope routes with no chatbot in the path (`v1/chatbots`, the WhatsApp
 * conversation and analytics lists) stay filtered to the caller's own chatbots, so staff see
 * nothing extra through them; the inbox list and counts take a `chatbotId` for staff (above).
 */

export type StaffPolicy = 'setup' | 'conversations' | 'deny';

export interface StaffMatrixEntry {
  /** One policy, or one per value of a route parameter (an unknown value is denied). */
  policy: StaffPolicy | { param: string; values: Record<string, StaffPolicy> };
  /** What an owner reads under "Who looked". */
  what: string;
}

const S = 'setup' as const;
const C = 'conversations' as const;
const D = 'deny' as const;

export const STAFF_ACCESS_MATRIX: Readonly<Record<string, StaffMatrixEntry>> = {
  'ChatbotController.get': { policy: S, what: 'Chatbot settings' },
  'ChatbotController.getSettings': { policy: S, what: 'Chatbot settings' },
  'ChatbotController.listDocuments': { policy: S, what: 'Knowledge' },
  'ChatbotController.getDocument': { policy: S, what: 'A knowledge document' },
  'ChatbotController.listMembers': { policy: S, what: 'Team' },
  'ChatbotController.listAudience': { policy: C, what: 'WhatsApp audience' },
  'ChatbotController.restore': { policy: D, what: 'Restore' },
  'ChatbotController.test': { policy: D, what: 'Test chat' },
  'ChatbotController.testStream': { policy: D, what: 'Test chat' },
  'BotImageController.list': { policy: S, what: 'Page images' },
  'BotPageAdminController.get': { policy: S, what: 'Bot page settings' },
  'BotPageAdminController.listAccess': {
    policy: C,
    what: 'Bot page access list',
  },
  'AssistantSeatsController.seats': { policy: S, what: 'Seats' },
  'AssistantSeatsController.publishUse': { policy: S, what: 'Plan use' },
  'InboxController.thread': { policy: C, what: 'A conversation' },
  'InboxController.memoryOf': { policy: C, what: "A person's memory" },
  'InboxController.list': { policy: C, what: 'Conversation list' },
  'InboxController.counts': { policy: C, what: 'Conversation counts' },
  'ListController.listLists': { policy: S, what: 'Lists' },
  'ListController.readyMadeCatalogue': { policy: S, what: 'Lists' },
  'ListController.getList': { policy: S, what: 'A list' },
  'ListController.searchContacts': { policy: C, what: 'Contacts' },
  'ListController.listRecords': { policy: C, what: 'List records' },
  'ListController.queryRecords': { policy: C, what: 'List records' },
  'ListController.getRecord': { policy: C, what: 'A list record' },
  'ChatbotTeamController.leave': { policy: D, what: 'Leave' },
  'GoLiveController.checklist': { policy: S, what: 'Go-live checklist' },
  'GoLiveController.terms': { policy: S, what: 'Safety terms' },
  'ChatbotKnowledgeController.listReview': {
    policy: S,
    what: 'Knowledge review',
  },
  'ChatbotKnowledgeController.freshnessOf': { policy: S, what: 'Knowledge' },
  'ChatbotKnowledgeController.listTranslations': {
    policy: S,
    what: 'Safety translations',
  },
  'CheckupController.view': { policy: S, what: 'Test results' },
  'CheckupController.listCases': { policy: S, what: 'Saved tests' },
  'CheckupController.getRun': { policy: S, what: 'A test run' },
  'ChatbotChangesController.changes': { policy: S, what: 'Change history' },
  'ChatbotChangesController.teamNames': { policy: S, what: 'Change history' },
  'WorkingCopyController.pendingForChatbot': {
    policy: S,
    what: 'Unapplied changes',
  },
  'AssistantHomeController.get': { policy: S, what: 'Chatbot home' },
  'AssistantHomeController.readReplies': { policy: S, what: 'Quick replies' },
  'AssistantHomeController.readList': {
    policy: {
      param: 'list',
      values: { team: S, documents: S, pageAccess: C, audience: C },
    },
    what: 'A home list',
  },
  'AssistantHomeController.listSources': { policy: S, what: 'Sources' },
  'AssistantHomeController.numbers': { policy: S, what: 'WhatsApp numbers' },
  'AssistantHomeController.howItWorks': { policy: S, what: 'How it works' },
  'AssistantHomeController.history': { policy: S, what: 'Change history' },
  'ScorecardController.view': { policy: S, what: 'Scorecard' },
  'ScorecardController.overview': { policy: S, what: 'Overview numbers' },
  'BotPageAdminController.widgetSites': { policy: S, what: 'Widget sites' },
  'BotPageDomainController.list': { policy: S, what: 'Page domains' },
  'TemplateController.catalogue': { policy: S, what: 'Templates' },
  'TemplateController.origin': { policy: S, what: 'Template origin' },
};

/** The list-scope routes above that take a chatbot from `?chatbotId=` rather than the path. */
export const STAFF_LIST_SCOPE_HANDLERS = [
  'InboxController.list',
  'InboxController.counts',
] as const;

/** The staff policy for one request; anything unlisted, or an unknown parameter value, is `deny`. */
export function staffPolicyFor(
  key: string,
  params: Record<string, unknown> = {},
): StaffPolicy {
  const entry = STAFF_ACCESS_MATRIX[key];
  if (!entry) return 'deny';
  if (typeof entry.policy === 'string') return entry.policy;
  const value = String(params[entry.policy.param] ?? '');
  return Object.prototype.hasOwnProperty.call(entry.policy.values, value)
    ? entry.policy.values[value]
    : 'deny';
}

/**
 * Logged staff reads that are not member routes (so not in the matrix above), by what an owner
 * reads under "Who looked".
 */
export const STAFF_LOG_ONLY_WHAT: Readonly<Record<string, string>> = {
  'StaffChatbotsController.search': 'Staff search',
  'StaffChatbotsController.conversationAccess':
    'Whether conversations are shared',
};

/**
 * What Ally staff can NEVER do to conversations, even with the owner's live grant. Each handler is
 * gated on a capability above VIEW (respond or build), which staff never hold, or is a list-scope
 * route filtered to the caller's own memberships, so it is not in the matrix (the matrix only names
 * view routes). `staff-access-matrix.spec.ts` walks this list against the real decorators and the
 * guard, so a route moved down to VIEW, or a new one, fails the build.
 */
export const STAFF_NEVER_CONVERSATION_ACTIONS: Readonly<
  Record<string, { action: string; enforcedBy: 'respond' | 'build' | 'own' }>
> = {
  'InboxController.takeOver': {
    action: 'Take over a chat',
    enforcedBy: 'respond',
  },
  'InboxController.handBack': {
    action: 'Hand a chat back',
    enforcedBy: 'respond',
  },
  'InboxController.reply': { action: 'Reply', enforcedBy: 'respond' },
  // WA-A §3: sending a file on the chat's WhatsApp is a reply.
  'InboxController.attach': { action: 'Send a file', enforcedBy: 'respond' },
  'InboxController.forgetLine': {
    action: 'Forget a memory line',
    enforcedBy: 'build',
  },
  'InboxController.editLine': {
    action: 'Edit a memory line',
    enforcedBy: 'build',
  },
  'InboxController.forgetPerson': {
    action: 'Forget a person',
    enforcedBy: 'build',
  },
  'ListController.exportCsv': { action: 'Export CSV', enforcedBy: 'build' },
  'ListController.deleteRecord': {
    action: 'Delete a record',
    enforcedBy: 'build',
  },
  'ChatbotController.removeAudience': {
    action: 'Delete an audience entry',
    enforcedBy: 'build',
  },
  'BotPageAdminController.removeAccess': {
    action: 'Delete a page access entry',
    enforcedBy: 'build',
  },
  'WhatsAppConversationController.erase': {
    action: 'Erase a contact',
    enforcedBy: 'own',
  },
  'WhatsAppConversationController.eraseWebContact': {
    action: 'Erase a visitor',
    enforcedBy: 'own',
  },
};

export function staffWhatFor(key: string): string {
  return STAFF_ACCESS_MATRIX[key]?.what ?? STAFF_LOG_ONLY_WHAT[key] ?? key;
}
