/// Direct port of ally-mobile (React Native)'s `src/constants/permissions.ts`
/// `USER_PERMISSIONS` enum — same string values, so a token captured from
/// the backend (which is shared between both apps) round-trips unchanged.
class UserPermissions {
  UserPermissions._();

  // === CALL / CHAT ===
  static const viewCallLogs = 'view:call:logs';
  static const startMicrophoneChat = 'start:microphone-chat';
  static const startCloudTelephonyChat = 'start:cloud-telephony-chat';
  static const viewChatDetails = 'view:chat:details';
  static const exportChatSummary = 'export:chat:summary';
  static const viewCounselorChat = 'view:chat:counselor';
  static const viewMessages = 'view:messages';
  static const archiveCallLog = 'archive:call-log';

  // === SUMMARY ===
  static const editSummary = 'edit:summary';
  static const editSummaryFeedback = 'edit:summary:feedback';
  static const editMessageFeedback = 'edit:message:feedback';

  // === SIMULATION / LEARN ===
  static const viewScenarioSession = 'view:scenario-session';
  static const viewScenarioSessionDetails = 'view:scenario-session:details';
  static const editScenarioSession = 'edit:scenario-session';
  static const viewSessionScenarioMessages = 'view:session-scenario:messages';

  // === SIMULATION REVIEW ===
  static const viewSimulationReview = 'view:simulation-review';
  static const editSimulationReview = 'edit:simulation-review';
  static const viewSimulationReviews = 'view:simulation-reviews';
  static const viewSimulationReviewThreads = 'view:simulation-review-threads';
  static const editSimulationReviewThread = 'edit:simulation-review-thread';

  // === SCRIBE REVIEW ===
  static const viewScribeReview = 'view:scribe-review';
  static const editScribeReview = 'edit:scribe-review';
  static const viewScribeReviews = 'view:scribe-reviews';
  static const viewScribeReviewThreads = 'view:scribe-review-threads';
  static const editScribeReviewThread = 'edit:scribe-review-thread';

  // === ANALYTICS ===
  static const viewAnalyticsDashboard = 'view:analytics:dashboard';

  // === REFERENCE / SEARCH ===
  static const viewReferenceDocument = 'view:reference-document';

  // === COMMUNITY ===
  static const viewCommunity = 'view:community';
  static const viewCommunityLeaderboard = 'view:community:leaderboard';
  static const viewUserRank = 'view:user:rank';

  // === BADGES ===
  static const viewUserBadges = 'view:user:badges';
  static const editUserBadges = 'edit:user:badges';

  // === CUSTOM FIELDS ===
  static const manageCustomFieldDefinitions = 'manage:custom-field:definitions';

  // === COUNSELLOR ===
  static const counselorAccess = 'counselor:access';

  // === EVALUATION ===
  static const evaluatorAccess = 'evaluator:access';
}
