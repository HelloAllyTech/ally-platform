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
  });

  factory Scenario.fromJson(Map<String, dynamic> json) => Scenario(
        id: (json['id'] as num).toInt(),
        title: json['title'] as String,
        description: json['description'] as String?,
        coverImageUrl: json['coverImageUrl'] as String?,
      );

  final int id;
  final String title;
  final String? description;
  final String? coverImageUrl;
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

class SimulationCredits {
  SimulationCredits({
    required this.creditLimit,
    required this.consumedCredits,
  });

  factory SimulationCredits.fromJson(Map<String, dynamic> json) =>
      SimulationCredits(
        creditLimit: (json['creditLimit'] as num?)?.toInt() ?? 0,
        consumedCredits: (json['consumedCredits'] as num?)?.toInt() ?? 0,
      );

  final int creditLimit;
  final int consumedCredits;

  int get remaining => (creditLimit - consumedCredits).clamp(0, creditLimit);
}

class SimulationPath {
  SimulationPath({
    required this.id,
    required this.title,
    required this.description,
    required this.totalScenarios,
    required this.completedScenarios,
  });

  factory SimulationPath.fromJson(Map<String, dynamic> json) => SimulationPath(
        id: json['id'] as String,
        title: json['title'] as String,
        description: json['description'] as String?,
        totalScenarios: (json['totalScenarios'] as num?)?.toInt() ?? 0,
        completedScenarios: (json['completedScenarios'] as num?)?.toInt() ?? 0,
      );

  final String id;
  final String title;
  final String? description;
  final int totalScenarios;
  final int completedScenarios;
}

class PathScenario {
  PathScenario({
    required this.id,
    required this.scenarioId,
    required this.order,
    required this.title,
    required this.description,
  });

  factory PathScenario.fromJson(Map<String, dynamic> json) => PathScenario(
        id: json['id'] as String,
        scenarioId: (json['scenarioId'] as num).toInt(),
        order: (json['order'] as num?)?.toInt() ?? 0,
        title: json['title'] as String?,
        description: json['description'] as String?,
      );

  final String id;
  final int scenarioId;
  final int order;
  final String? title;
  final String? description;
}

/// Mirrors ally-mobile (React Native)'s `SimulationSummaryData` —
/// the post-session debrief ally-be's AI judge generates. Only the fields
/// SessionSummaryScreen renders; `events` (turn-by-turn transcript) and
/// `metadata` are not modeled in this pass — a full transcript view is
/// separate, substantial work (ally-mobile's own `TranscriptTab.tsx`).
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
  });

  factory SimulationSummary.fromJson(Map<String, dynamic> json) => SimulationSummary(
        id: json['id'] as String,
        score: (json['score'] as num?)?.toDouble(),
        startedAt: json['startedAt'] as String,
        endedAt: json['endedAt'] as String?,
        whatWentWell: (json['whatWentWell'] as List<dynamic>?)?.cast<String>() ?? [],
        areasForImprovement:
            (json['areasForImprovement'] as List<dynamic>?)?.cast<String>() ?? [],
        hasFeedback: json['hasFeedback'] as bool? ?? false,
        feedbackRating: (json['feedbackRating'] as num?)?.toInt(),
      );

  final String id;
  final double? score;
  final String startedAt;
  final String? endedAt;
  final List<String> whatWentWell;
  final List<String> areasForImprovement;
  final bool hasFeedback;
  final int? feedbackRating;
}

class SimulationPathDetails {
  SimulationPathDetails({
    required this.id,
    required this.title,
    required this.completedScenarios,
    required this.scenarios,
  });

  factory SimulationPathDetails.fromJson(Map<String, dynamic> json) =>
      SimulationPathDetails(
        id: json['id'] as String,
        title: json['title'] as String?,
        completedScenarios: (json['completedScenarios'] as num?)?.toInt() ?? 0,
        scenarios: (json['scenarios'] as List<dynamic>? ?? [])
            .map((e) => PathScenario.fromJson(e as Map<String, dynamic>))
            .toList(),
      );

  final String id;
  final String? title;
  final int completedScenarios;
  final List<PathScenario> scenarios;
}
