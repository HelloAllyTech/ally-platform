/// A selectable simulation-language option — RN's `LanguageOption`
/// (`src/types/simulations.ts`). Only `language_id`/`label` are modeled;
/// the original also carries an `active` flag and translation metadata the
/// ported dropdown doesn't need.
class ScenarioLanguageOption {
  ScenarioLanguageOption({required this.languageId, required this.label});

  factory ScenarioLanguageOption.fromJson(Map<String, dynamic> json) =>
      ScenarioLanguageOption(
        languageId: (json['language_id'] as num).toInt(),
        label: json['label'] as String,
      );

  final int languageId;
  final String label;
}

/// Mirrors ally-mobile (React Native)'s `src/types/simulations.ts` and
/// `src/types/credits.ts`. Only the fields the ported screens use are
/// modeled — the originals carry more (reminders, state-name mapping,
/// difficulty-driven conversational states) that a fuller port needs.
class Scenario {
  Scenario({
    required this.id,
    required this.title,
    required this.description,
    required this.coverImageUrl,
    this.coverVideoUrl,
    this.triggerWarnings = const [],
    this.availableLanguages = const [],
    this.completedAttemptCount = 0,
    this.maxTimeValue,
    this.pauseEnabled = false,
    this.experienceMode,
    this.checklistType,
    this.checklistEvents = const [],
    this.reminders = const [],
    this.showScoreMeter = true,
  });

  factory Scenario.fromJson(Map<String, dynamic> json) => Scenario(
    id: (json['id'] as num).toInt(),
    title: json['title'] as String,
    description: json['description'] as String?,
    coverImageUrl: json['coverImageUrl'] as String?,
    coverVideoUrl: json['coverVideoUrl'] as String?,
    triggerWarnings: (json['triggerWarnings'] as List<dynamic>? ?? [])
        .map((e) => (e as Map<String, dynamic>)['name'] as String)
        .toList(),
    availableLanguages: (json['availableLanguages'] as List<dynamic>? ?? [])
        .map((e) => ScenarioLanguageOption.fromJson(e as Map<String, dynamic>))
        .toList(),
    completedAttemptCount:
        (json['completion'] as Map<String, dynamic>?)?['attemptCount']
            as int? ??
        0,
    // "HH:MM:SS" — mirrors RN's own `Scenario.maxTimeValue`, parsed by
    // `parseMaxTimeSec` at the point of use (see roleplay_voice_screen.dart).
    maxTimeValue: json['maxTimeValue'] as String?,
    // Opt-in default: only an explicit `true` shows the pause control, same
    // as RN's own `scenario?.pauseEnabled === true` check.
    pauseEnabled: json['pauseEnabled'] as bool? ?? false,
    experienceMode: json['experienceMode'] as String?,
    checklistType: json['checklistType'] as String?,
    checklistEvents: (json['checklistEvents'] as List<dynamic>? ?? [])
        .map((e) => ChecklistItem.fromJson(e as Map<String, dynamic>))
        .toList(),
    reminders: (json['reminders'] as List<dynamic>? ?? []).cast<String>(),
    // Opt-OUT: visible by default for any ExperienceMode unless the
    // scenario explicitly sets this `false` — confirmed from RN's own gate
    // (`isSimulationInProgress && scenario?.showScoreMeter !== false`), not
    // gated to FEEDBACK mode specifically.
    showScoreMeter: json['showScoreMeter'] as bool? ?? true,
  );

  final int id;
  final String title;
  final String? description;
  final String? coverImageUrl;
  final String? coverVideoUrl;
  final List<String> triggerWarnings;
  final List<ScenarioLanguageOption> availableLanguages;

  /// Completing a scenario never locks it — RN's doc comment on this same
  /// field: the CTA turns into "Practise again" rather than disappearing.
  final int completedAttemptCount;

  final String? maxTimeValue;
  final bool pauseEnabled;

  /// RN's `ExperienceMode` ('FEEDBACK'/'CHECKLIST'/'NONE') — only used here
  /// to gate the live roleplay screen's focus-mode button
  /// (`showFocusButton = !isNoneMode`).
  final String? experienceMode;

  /// RN's `ChecklistType` ('OFF'/'GUIDED'/'UNGUIDED'/'LIST') — see
  /// `checklist_panel.dart`.
  final String? checklistType;
  final List<ChecklistItem> checklistEvents;

  /// RN's `scenario.reminders: string[]`, rendered as-is in the Reminders
  /// tab (one plain-text card per entry) — straight from this already-
  /// fetched object, no separate fetch. RN also has a `remindersEnabled`
  /// flag whose own doc comment says reminders should only render when
  /// it's true, but the real screen's `hasReminders` gate never actually
  /// checks it (confirmed from source) — not modeled here either, to match
  /// RN's real (if inconsistent) behavior rather than an unenforced intent.
  final List<String> reminders;

  /// Opt-out: the live score meter shows unless this is explicitly `false`.
  final bool showScoreMeter;

  /// Mirrors RN's `hasChecklist` (`SimulationAssistantScreen.tsx`): a
  /// CHECKLIST-mode scenario with zero checklist-visible events falls back
  /// to the plain layout rather than showing an empty panel.
  bool get hasChecklist => experienceMode == 'CHECKLIST' && checklistEvents.isNotEmpty;
}

/// Mirrors RN's `ChecklistItem` (`src/types/simulations.ts`) — a single
/// live-call checklist target, checked off in real time as its [id] appears
/// in a LiveKit `detected_event_ids` data-channel message (see
/// `roleplay_voice_screen.dart`).
class ChecklistItem {
  ChecklistItem({
    required this.id,
    required this.name,
    this.rank,
    this.score,
    this.message,
  });

  factory ChecklistItem.fromJson(Map<String, dynamic> json) => ChecklistItem(
    id: json['id'] as String,
    name: json['name'] as String,
    rank: (json['rank'] as num?)?.toInt(),
    score: (json['score'] as num?)?.toInt(),
    message: json['message'] as String?,
  );

  final String id;
  final String name;
  final int? rank;
  final int? score;
  final String? message;
}

/// LiveKit connection pair returned by starting a session — the same shape
/// `SimulationAssistantScreen.tsx` destructures as `sessionData` and passes
/// straight to `room.connect(liveKitServerUrl, accessToken)`.
class SessionData {
  SessionData({
    required this.id,
    required this.accessToken,
    required this.liveKitServerUrl,
  });

  factory SessionData.fromJson(Map<String, dynamic> json) => SessionData(
    id: json['id'] as String,
    accessToken: json['accessToken'] as String,
    liveKitServerUrl: json['liveKitServerUrl'] as String,
  );

  final String id;
  final String accessToken;
  final String liveKitServerUrl;
}

/// `secondsAllowedPerCredit` + the `isLow` threshold mirror ally-mobile
/// (React Native)'s `src/utils/credits.ts` exactly: a credit is "low" once
/// the remaining allotted time drops under `SESSION_AUTO_END_MINUTES` (20
/// minutes), not under some fraction of the limit — a session could time
/// out mid-call otherwise.
class SimulationCredits {
  SimulationCredits({
    required this.creditLimit,
    required this.consumedCredits,
    this.secondsAllowedPerCredit = 0,
  });

  factory SimulationCredits.fromJson(Map<String, dynamic> json) =>
      SimulationCredits(
        creditLimit: (json['creditLimit'] as num?)?.toInt() ?? 0,
        consumedCredits: (json['consumedCredits'] as num?)?.toInt() ?? 0,
        secondsAllowedPerCredit:
            (json['secondsAllowedPerCredit'] as num?)?.toInt() ?? 0,
      );

  final int creditLimit;
  final int consumedCredits;
  final int secondsAllowedPerCredit;

  int get remaining => (creditLimit - consumedCredits).clamp(0, creditLimit);

  int get usagePercentage =>
      creditLimit == 0 ? 0 : ((consumedCredits / creditLimit) * 100).round();

  static const _sessionAutoEndMinutes = 20;
  static const _minutesInSeconds = 60;

  bool get isLow {
    final remainingTimeInSeconds = remaining * secondsAllowedPerCredit;
    return remainingTimeInSeconds < _sessionAutoEndMinutes * _minutesInSeconds;
  }
}

class SimulationPath {
  SimulationPath({
    required this.id,
    required this.title,
    required this.description,
    required this.totalScenarios,
    required this.completedScenarios,
    this.coverImageUrl,
  });

  factory SimulationPath.fromJson(Map<String, dynamic> json) => SimulationPath(
    id: json['id'] as String,
    title: json['title'] as String,
    description: json['description'] as String?,
    totalScenarios: (json['totalScenarios'] as num?)?.toInt() ?? 0,
    completedScenarios: (json['completedScenarios'] as num?)?.toInt() ?? 0,
    coverImageUrl: json['coverImageUrl'] as String?,
  );

  final String id;
  final String title;
  final String? description;
  final int totalScenarios;
  final int completedScenarios;
  final String? coverImageUrl;
}

/// Mirrors ally-mobile (React Native)'s `SessionItemStatus` — a path/case
/// scenario's progress state within that path/case.
enum SessionItemStatus { locked, unlocked, completed, unknown }

SessionItemStatus _sessionItemStatusFromString(String? value) {
  switch (value) {
    case 'LOCKED':
      return SessionItemStatus.locked;
    case 'UNLOCKED':
      return SessionItemStatus.unlocked;
    case 'COMPLETED':
      return SessionItemStatus.completed;
    default:
      return SessionItemStatus.unknown;
  }
}

/// Mirrors `src/types/simulations.ts`'s `LanguageOption` — kept local to
/// this feature rather than reusing `preferences`' identical shape, same
/// as the rest of this port's per-feature model scoping.
class SimulationLanguageOption {
  SimulationLanguageOption({required this.languageId, required this.label});

  factory SimulationLanguageOption.fromJson(Map<String, dynamic> json) =>
      SimulationLanguageOption(
        languageId: (json['language_id'] as num).toInt(),
        label: json['label'] as String,
      );

  final int languageId;
  final String label;
}

class PathScenario {
  PathScenario({
    required this.id,
    required this.scenarioId,
    required this.order,
    required this.title,
    required this.description,
    required this.coverImageUrl,
    this.coverVideoUrl,
    this.triggerWarnings = const [],
    required this.sessionId,
    required this.status,
    required this.availableLanguages,
  });

  factory PathScenario.fromJson(Map<String, dynamic> json) => PathScenario(
    id: json['id'] as String,
    scenarioId: (json['scenarioId'] as num).toInt(),
    order: (json['order'] as num?)?.toInt() ?? 0,
    title: json['title'] as String?,
    description: json['description'] as String?,
    coverImageUrl: json['coverImageUrl'] as String?,
    coverVideoUrl: json['coverVideoUrl'] as String?,
    triggerWarnings: (json['triggerWarnings'] as List<dynamic>? ?? [])
        .map((e) => (e as Map<String, dynamic>)['name'] as String)
        .toList(),
    sessionId: json['sessionId'] as String?,
    status: _sessionItemStatusFromString(json['status'] as String?),
    availableLanguages: (json['availableLanguages'] as List<dynamic>?)
        ?.map(
          (e) => SimulationLanguageOption.fromJson(e as Map<String, dynamic>),
        )
        .toList(),
  );

  final String id;
  final int scenarioId;
  final int order;
  final String? title;
  final String? description;
  final String? coverImageUrl;

  /// Carried through but not rendered — matches `SimulationDetailsScreen`'s
  /// own documented scope line: no video-preview widget exists in this app
  /// yet, only the full course-item video player, so the pre-start preview
  /// falls back to [coverImageUrl] the same way that screen does.
  final String? coverVideoUrl;
  final List<String> triggerWarnings;
  final String? sessionId;
  final SessionItemStatus status;
  final List<SimulationLanguageOption>? availableLanguages;
}

/// Mirrors ally-mobile (React Native)'s `SimulationSummaryData`
/// (`src/types/simulations.ts`) — `GET /learn/scenario-session/:id`. Models
/// what `SimulationFeedbackScreen` reads: the scenario (title, cover,
/// client name, experience mode, which feedback tabs are on), the
/// `details` block (call length, Ally's `supervisorNote`, a generation
/// `errorMessage`), the learner's own rating, and the review it was shared
/// as. `score` / `whatWentWell` / `areasForImprovement` are older top-level
/// fields RN still types but no longer renders.
class SimulationSummary {
  SimulationSummary({
    required this.id,
    required this.score,
    required this.startedAt,
    required this.endedAt,
    required this.whatWentWell,
    required this.areasForImprovement,
    required this.hasFeedback,
    required this.feedbackRating,
    required this.reviewId,
    required this.reviewStatus,
    this.createdAt,
    this.sessionName,
    this.scenario,
    this.callDuration,
    this.hasSummaryFeedback = false,
    this.supervisorNote,
    this.errorMessage,
    this.sessionFeedback,
  });

  factory SimulationSummary.fromJson(Map<String, dynamic> json) {
    final details = json['details'] as Map<String, dynamic>?;
    final summary = details?['summary'] as Map<String, dynamic>?;
    final feedback = summary?['feedback'] as Map<String, dynamic>?;
    final sessionFeedback = json['sessionFeedback'] as Map<String, dynamic>?;
    return SimulationSummary(
      id: json['id'] as String,
      score: (json['score'] as num?)?.toDouble(),
      startedAt: json['startedAt'] as String,
      endedAt: json['endedAt'] as String?,
      whatWentWell: (json['whatWentWell'] as List<dynamic>?)?.cast<String>() ?? [],
      areasForImprovement: (json['areasForImprovement'] as List<dynamic>?)?.cast<String>() ?? [],
      hasFeedback: json['hasFeedback'] as bool? ?? false,
      feedbackRating: (json['feedbackRating'] as num?)?.toInt(),
      reviewId: json['reviewId'] as String?,
      reviewStatus: json['reviewStatus'] as String?,
      createdAt: json['createdAt'] as String?,
      sessionName: (json['metadata'] as Map<String, dynamic>?)?['sessionName'] as String?,
      scenario: json['scenario'] == null
          ? null
          : SimulationSummaryScenario.fromJson(json['scenario'] as Map<String, dynamic>),
      callDuration: (details?['callDuration'] as num?)?.toDouble(),
      hasSummaryFeedback: feedback != null,
      supervisorNote: feedback?['supervisorNote'] as String?,
      errorMessage: summary?['errorMessage'] as String?,
      sessionFeedback: sessionFeedback == null
          ? null
          : (
              rating: (sessionFeedback['rating'] as num?)?.toInt(),
              tags: (sessionFeedback['tags'] as List<dynamic>?)?.cast<String>() ?? const <String>[],
              comment: sessionFeedback['feedback'] as String? ?? '',
            ),
    );
  }

  final String id;
  final double? score;
  final String startedAt;
  final String? endedAt;
  final List<String> whatWentWell;
  final List<String> areasForImprovement;
  final bool hasFeedback;
  final int? feedbackRating;

  /// Mirrors ally-mobile (React Native)'s `SimulationSummaryData.reviewId`
  /// — a simulation review (`/scenario-session-reviews`), a genuinely
  /// separate resource from a scribe review. Drives the floating "view
  /// review" button on `SimulationFeedbackScreen`.
  final String? reviewId;

  /// Mirrors `SimulationSummaryData.reviewStatus` (`ReviewStatus` enum in
  /// RN — `'HIDDEN'`/`'IN_REVIEW'`/etc., kept as a raw string here the same
  /// way `CallSummaryDetails.reviewStatus` already does).
  final String? reviewStatus;

  final String? createdAt;

  /// `metadata.sessionName`, shown as "ID: …" (falls back to [id]).
  final String? sessionName;
  final SimulationSummaryScenario? scenario;

  /// `details.callDuration` in seconds; RN's `isShortSession` reads it.
  final double? callDuration;

  /// Whether `details.summary.feedback` has landed — RN's poll loop stops
  /// once it has.
  final bool hasSummaryFeedback;

  /// Ally's debrief (`details.summary.feedback.supervisorNote`), anchoring
  /// transcript moments as `[[msg:<messageId>]]`.
  final String? supervisorNote;

  /// `details.summary.errorMessage` — set when generation failed.
  final String? errorMessage;

  /// The learner's own rating (`sessionFeedback`), when already given.
  final ({int? rating, List<String> tags, String comment})? sessionFeedback;

  /// RN `isShortSession`: 30s or less; unknown length is not short.
  bool get isShortSession => callDuration != null && callDuration! <= 30;

  /// RN `feedbackTabs ?? DEFAULT_FEEDBACK_TABS` (both on).
  bool get showDebriefTab => scenario?.feedbackDebrief ?? true;
  bool get showTranscriptTab => scenario?.feedbackTranscript ?? true;

  /// RN `feedbackEnabled`: both tabs off is the wholesale opt-out.
  bool get feedbackEnabled => showDebriefTab || showTranscriptTab;

  bool get isChecklistMode => scenario?.experienceMode == 'CHECKLIST';
}

/// RN `SimulationSummaryData.scenario` (+ the `metadata` fields the
/// feedback screen reads).
class SimulationSummaryScenario {
  SimulationSummaryScenario({
    this.title,
    this.description,
    this.coverImageUrl,
    this.coverVideoUrl,
    this.clientName,
    this.experienceMode,
    this.feedbackDebrief,
    this.feedbackTranscript,
  });

  factory SimulationSummaryScenario.fromJson(Map<String, dynamic> json) {
    final metadata = json['metadata'] as Map<String, dynamic>?;
    final tabs = metadata?['feedbackTabs'] as Map<String, dynamic>?;
    return SimulationSummaryScenario(
      title: json['title'] as String?,
      description: json['description'] as String?,
      coverImageUrl: json['coverImageUrl'] as String?,
      coverVideoUrl: json['coverVideoUrl'] as String?,
      clientName: metadata?['name'] as String?,
      experienceMode: metadata?['experienceMode'] as String?,
      feedbackDebrief: tabs == null ? null : tabs['debrief'] as bool? ?? true,
      feedbackTranscript: tabs == null ? null : tabs['transcript'] as bool? ?? true,
    );
  }

  final String? title;
  final String? description;
  final String? coverImageUrl;
  final String? coverVideoUrl;

  /// `metadata.name` — the simulated client, e.g. "Asha (AI client)".
  final String? clientName;
  final String? experienceMode;
  final bool? feedbackDebrief;
  final bool? feedbackTranscript;

  /// Whether the backend sent `feedbackTabs` at all (RN's poll loop stops
  /// early when it did and both are off).
  bool get hasFeedbackTabs => feedbackDebrief != null;
}

/// One row of `GET /learn/scenario-session/:id/event-checklist`.
class EventChecklistItem {
  EventChecklistItem({required this.id, required this.name, required this.hasOccurred});

  factory EventChecklistItem.fromJson(Map<String, dynamic> json) => EventChecklistItem(
    id: '${json['id']}',
    name: json['name'] as String? ?? '',
    hasOccurred: json['hasOccurred'] as bool? ?? false,
  );

  final String id;
  final String name;
  final bool hasOccurred;
}

class SimulationPathDetails {
  SimulationPathDetails({
    required this.id,
    required this.title,
    required this.description,
    required this.coverImageUrl,
    required this.completedScenarios,
    required this.completedAt,
    required this.scenarioPathSessionId,
    required this.caseSessionId,
    required this.scenarios,
  });

  factory SimulationPathDetails.fromJson(Map<String, dynamic> json) =>
      SimulationPathDetails(
        id: json['id'] as String,
        title: json['title'] as String?,
        description: json['description'] as String?,
        coverImageUrl: json['coverImageUrl'] as String?,
        completedScenarios: (json['completedScenarios'] as num?)?.toInt() ?? 0,
        completedAt: json['completedAt'] as String?,
        scenarioPathSessionId: json['scenarioPathSessionId'] as String?,
        caseSessionId: json['caseSessionId'] as String?,
        scenarios: (json['scenarios'] as List<dynamic>? ?? [])
            .map((e) => PathScenario.fromJson(e as Map<String, dynamic>))
            .toList(),
      );

  final String id;
  final String? title;
  final String? description;
  final String? coverImageUrl;
  final int completedScenarios;
  final String? completedAt;
  final String? scenarioPathSessionId;
  final String? caseSessionId;
  final List<PathScenario> scenarios;

  /// First scenario not yet completed and not locked — same definition as
  /// the RN screen's `nextSimulation`, used to resume a case/path exactly
  /// where the learner left off.
  PathScenario? get nextScenario => scenarios
      .where(
        (s) =>
            s.status != SessionItemStatus.completed &&
            s.status != SessionItemStatus.locked,
      )
      .firstOrNull;
}
