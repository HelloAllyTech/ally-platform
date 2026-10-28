import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/permissions/permissions_repository.dart';
import 'package:ally_mobile_flutter/core/permissions/user_permissions.dart';
import 'package:ally_mobile_flutter/core/routing/app_router.dart';
import 'package:ally_mobile_flutter/core/widgets/ask_ai_chat/ask_ai_chat.dart';
import 'package:ally_mobile_flutter/core/widgets/root_scaffold_messenger.dart';
import 'package:ally_mobile_flutter/features/reactions/data/reactions_repository.dart';
import 'package:ally_mobile_flutter/features/reviews/data/review_models.dart';
import 'package:ally_mobile_flutter/features/reviews/data/reviews_repository.dart';
import 'package:ally_mobile_flutter/features/simulations/data/simulation_models.dart';
import 'package:ally_mobile_flutter/features/simulations/data/simulation_transcript_repository.dart';
import 'package:ally_mobile_flutter/features/simulations/data/simulations_repository.dart';
import 'package:ally_mobile_flutter/features/simulations/presentation/simulation_feedback_screen.dart';

import '../../../support/pump_router_app.dart';

/// Shared setup for the `SimulationFeedbackScreen` widget tests.

class MockSimulationsRepository extends Mock implements SimulationsRepository {}

class MockSimulationTranscriptRepository extends Mock implements SimulationTranscriptRepository {}

class MockReviewsRepository extends Mock implements ReviewsRepository {}

class MockReactionsRepository extends Mock implements ReactionsRepository {}

class MockAskAiChatApi extends Mock implements AskAiChatApi {}

const allPermissions = [
  UserPermissions.viewSessionScenarioMessages,
  UserPermissions.viewSimulationReview,
];

/// A `GET /learn/scenario-session/:id` body. [note] lands Ally's
/// supervisor note (and so stops the poll loop).
Map<String, dynamic> summaryJson({
  String? note,
  String? errorMessage,
  bool hasFeedback = false,
  int? rating,
  String? reviewId,
  String? reviewStatus,
  num? callDuration,
  String? experienceMode,
  Map<String, bool>? feedbackTabs,
  String clientName = 'Asha',
  String? endedAt = '2026-01-01T10:05:00.000Z',
}) => {
  'id': 'session-1',
  'startedAt': '2026-01-01T10:00:00.000Z',
  'endedAt': endedAt,
  'createdAt': '2026-01-01T10:00:00.000Z',
  'hasFeedback': hasFeedback,
  if (rating != null) 'sessionFeedback': {'rating': rating, 'tags': <String>[], 'feedback': ''},
  'reviewId': reviewId,
  'reviewStatus': reviewStatus,
  'scenario': {
    'title': 'Supporting a grieving parent',
    'metadata': {
      'name': clientName,
      'experienceMode': ?experienceMode,
      'feedbackTabs': ?feedbackTabs,
    },
  },
  'details': {
    'callDuration': callDuration ?? 300,
    'summary': {
      if (note != null) 'feedback': {'supervisorNote': note},
      'errorMessage': ?errorMessage,
    },
  },
};

class FeedbackHarness {
  FeedbackHarness() {
    when(
      () => transcript.getMessages(
        scenarioSessionId: any(named: 'scenarioSessionId'),
        offset: any(named: 'offset'),
        languageCode: any(named: 'languageCode'),
      ),
    ).thenAnswer((_) async => (messages: <SimulationTranscriptMessage>[], count: 0));
    when(() => transcript.getRecordingUrl(any())).thenAnswer((_) async => null);
    when(() => reviews.getThreads(any(), limit: any(named: 'limit')))
        .thenAnswer((_) async => (threads: const <ReviewThread>[], count: 0));
    when(() => reactions.getReactionsCount(any())).thenAnswer((_) async => <String, int>{});
    when(() => chatApi.getHistory(any())).thenAnswer((_) async => <AskAiChatMessage>[]);
    when(() => simulations.getEventChecklist(any())).thenAnswer((_) async => <EventChecklistItem>[]);
    when(
      () => simulations.addSimulationFeedback(
        scenarioSessionId: any(named: 'scenarioSessionId'),
        rating: any(named: 'rating'),
        comment: any(named: 'comment'),
        tags: any(named: 'tags'),
      ),
    ).thenAnswer((_) async {});
  }

  final simulations = MockSimulationsRepository();
  final transcript = MockSimulationTranscriptRepository();
  final reviews = MockReviewsRepository();
  final reactions = MockReactionsRepository();
  final chatApi = MockAskAiChatApi();

  /// `GET /scenario-session-reviews/:id` (the share switch reads it).
  void stubReview({String status = 'IN_REVIEW', String createdAt = '2026-01-01T10:10:00.000Z'}) {
    when(() => reviews.getReview(any())).thenAnswer(
      (invocation) async => ReviewItem.fromJson({
        'id': invocation.positionalArguments.first as String,
        'createdAt': createdAt,
        'note': 'my note',
        'createdBy': {'id': 1, 'name': 'Learner'},
        'reviewStatus': status,
      }),
    );
  }

  void stubSummary(Map<String, dynamic> json) {
    when(() => simulations.getSimulationDetails('session-1'))
        .thenAnswer((_) async => SimulationSummary.fromJson(json));
  }

  Future<GoRouter> pump(
    WidgetTester tester, {
    bool fromLogs = false,
    String? pathId,
    String? caseId,
    List<String> permissions = allPermissions,
  }) {
    return pumpRouterApp(
      tester,
      initialLocation: '/feedback',
      scaffoldMessengerKey: rootScaffoldMessengerKey,
      routes: [
        GoRoute(
          path: '/feedback',
          builder: (context, state) => SimulationFeedbackScreen(
            scenarioSessionId: 'session-1',
            fromLogs: fromLogs,
            pathId: pathId,
            caseId: caseId,
          ),
        ),
        GoRoute(
          path: '/simulation-paths/:pathId',
          builder: (context, state) => Text('PATH_DETAILS:${state.pathParameters['pathId']}'),
        ),
        GoRoute(
          path: '/cases/:caseId',
          builder: (context, state) => Text('CASE_DETAILS:${state.pathParameters['caseId']}'),
        ),
        GoRoute(path: '/home', builder: (context, state) => const Text('HOME')),
        GoRoute(path: '/simulations', builder: (context, state) => const Text('SIMULATIONS_LIST')),
        GoRoute(
          path: '/reviews/:reviewId',
          builder: (context, state) => Text('REVIEW_DETAILS:${state.pathParameters['reviewId']}:${state.extra}'),
        ),
        GoRoute(
          path: '/share-for-review/:scenarioSessionId',
          builder: (context, state) {
            final extra = state.extra! as ShareSimulationForReviewArgs;
            final args = extra.args;
            return Text(
              'SHARE:${args.reviewId}:${args.contextDuration}:${args.contextTitle}'
              ':${extra.coverImageUrl}:${extra.description}',
            );
          },
        ),
      ],
      overrides: [
        simulationsRepositoryProvider.overrideWithValue(simulations),
        simulationTranscriptRepositoryProvider.overrideWithValue(transcript),
        reviewsRepositoryProvider.overrideWithValue(reviews),
        reactionsRepositoryProvider.overrideWithValue(reactions),
        askAiChatApiProvider.overrideWithValue(chatApi),
        userPermissionsProvider.overrideWith((ref) async => permissions),
      ],
    );
  }
}

void registerFeedbackFallbacks() {
  registerFallbackValue(<String>[]);
}
