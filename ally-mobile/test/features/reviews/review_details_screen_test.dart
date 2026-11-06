import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:ally_mobile_flutter/core/permissions/permissions_repository.dart';
import 'package:ally_mobile_flutter/core/permissions/user_permissions.dart';
import 'package:ally_mobile_flutter/core/widgets/review_type_chip.dart';
import 'package:ally_mobile_flutter/features/account/data/account_repository.dart';
import 'package:ally_mobile_flutter/features/account/data/user_profile.dart';
import 'package:ally_mobile_flutter/features/reviews/data/review_api.dart';
import 'package:ally_mobile_flutter/features/reviews/data/review_models.dart';
import 'package:ally_mobile_flutter/features/reviews/data/reviews_repository.dart';
import 'package:ally_mobile_flutter/features/reviews/data/scribe_reviews_repository.dart';
import 'package:ally_mobile_flutter/features/reviews/presentation/review_details_screen.dart';

import '../../support/fake_translations.dart';

class _MockApi extends Mock implements ReviewApi {}

class _MockReviews extends Mock implements ReviewsRepository {}

class _MockScribeReviews extends Mock implements ScribeReviewsRepository {}

final _owner = ReviewAuthor(id: 1, name: 'Asha', profileImage: '');
final _reviewer = UserProfile(
  id: 2,
  email: 'r@example.com',
  name: 'Ravi',
  phone: '',
  profileImageUrl: null,
  profileCompleted: true,
);

ThreadComment _comment(String id, String content, {int authorId = 2}) => ThreadComment(
  id: id,
  content: content,
  createdAt: DateTime.now().toUtc().toIso8601String(),
  authorName: authorId == 2 ? 'Ravi' : 'Asha',
  authorId: authorId,
  reactions: const {},
  myReaction: null,
);

ReviewItem _review({bool scribe = false}) => ReviewItem(
  id: 'rev-1',
  createdAt: DateTime.now().toUtc().subtract(const Duration(days: 1)).toIso8601String(),
  note: 'Please look at the opening',
  createdBy: _owner,
  commentsCount: 3,
  summaryName: scribe ? 'CALL-12' : null,
  reviewStatus: 'IN_REVIEW',
  scenario: scribe ? null : ReviewScenario(title: 'Help Sandeep'),
  scenarioSession: scribe ? null : ReviewScenarioSession(duration: '277', createdAt: '2026-06-02T21:10:00Z'),
  scribeSession: scribe ? ReviewScribeSession(summaryName: 'CALL-12', duration: '120') : null,
  reactions: const {'1f44d': 2},
  generalCommentsThreadId: 'g-1',
);

final _thread = ReviewThread(
  id: 't-1',
  comments: [_comment('c-1', 'Good empathy here')],
  commentCount: 2,
  createdBy: _owner,
  message: null,
  selection: const ReviewTextSelection(startIndex: 4, endIndex: 9),
);

List<TranscriptMessage> _messages() => [
  TranscriptMessage(id: '7', content: 'The quick brown fox', startSeconds: 65, senderId: -1, threads: [_thread]),
  TranscriptMessage(id: '8', content: 'I hear you', startSeconds: 70, senderId: 1, threads: const []),
];

void main() {
  late _MockApi api;
  late _MockReviews reviews;
  late _MockScribeReviews scribeReviews;

  setUpAll(() => registerFallbackValue(const ReviewTextSelection(startIndex: 0, endIndex: 0)));

  setUp(() {
    api = _MockApi();
    reviews = _MockReviews();
    scribeReviews = _MockScribeReviews();
    when(() => api.getMessages(any(), offset: any(named: 'offset'), limit: any(named: 'limit')))
        .thenAnswer((_) async => _messages());
    when(() => api.getGeneralComments(any(), offset: any(named: 'offset'), limit: any(named: 'limit')))
        .thenAnswer((_) async => (comments: [_comment('g-c1', 'Overall nicely done', authorId: 1)], count: 1));
    when(() => reviews.getReview('rev-1')).thenAnswer((_) async => _review());
    when(() => reviews.markAsRead('rev-1')).thenAnswer((_) async {});
    when(() => scribeReviews.getScribeReview('rev-1')).thenAnswer((_) async => _review(scribe: true));
    when(() => scribeReviews.markAsRead('rev-1')).thenAnswer((_) async {});
  });

  Future<void> pump(WidgetTester tester, {ReviewType type = ReviewType.simulation, UserProfile? user}) async {
    SharedPreferences.setMockInitialValues({});
    tester.view.physicalSize = const Size(1206, 2622);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          fixedTranslationsOverride(),
          reviewApiProvider(type).overrideWithValue(api),
          reviewsRepositoryProvider.overrideWithValue(reviews),
          scribeReviewsRepositoryProvider.overrideWithValue(scribeReviews),
          currentUserProvider.overrideWith((ref) async => user ?? _reviewer),
          userPermissionsProvider.overrideWith(
            (ref) async => [
              UserPermissions.viewSimulationReviewThreads,
              UserPermissions.editSimulationReviewThread,
              UserPermissions.editSimulationReview,
              UserPermissions.editScribeReview,
            ],
          ),
        ],
        child: MaterialApp(home: ReviewDetailsScreen(reviewId: 'rev-1', reviewType: type)),
      ),
    );
    await tester.pumpAndSettle();
  }

  Future<void> finish(WidgetTester tester) async {
    // Let RN's 10s mark-read timer fire so no timer is left pending.
    await tester.pump(const Duration(seconds: 11));
  }

  testWidgets('renders RN\'s layout: header, disclaimer, note, transcript, general comments; marks read after 10s', (
    tester,
  ) async {
    await pump(tester);

    expect(find.text('Help Sandeep'), findsOneWidget);
    expect(find.text('By Asha'), findsOneWidget);
    expect(find.text('Simulation'), findsOneWidget);
    expect(find.text('Transcription may not always be fully accurate.'), findsOneWidget);
    expect(find.text('NOTE'), findsOneWidget);
    expect(find.text('Please look at the opening'), findsOneWidget);
    expect(find.text('01:05'), findsOneWidget);
    expect(find.textContaining('AI client: The quick brown fox', findRichText: true), findsOneWidget);
    expect(find.textContaining('Asha: I hear you', findRichText: true), findsOneWidget);
    // Fewer than a full page of messages → all loaded → the footer shows.
    expect(find.byKey(const Key('general-comments-section')), findsOneWidget);
    expect(find.text('Overall nicely done'), findsOneWidget);
    expect(find.byKey(const Key('interactions-bar')), findsOneWidget);
    expect(find.text('3'), findsOneWidget, reason: 'comment count badge');

    verifyNever(() => reviews.markAsRead(any()));
    await finish(tester);
    verify(() => reviews.markAsRead('rev-1')).called(1);
  });

  testWidgets('selecting transcript text offers "Add comment" and starts a thread anchored to the selection', (
    tester,
  ) async {
    when(
      () => api.addComment(
        reviewId: any(named: 'reviewId'),
        content: any(named: 'content'),
        messageId: any(named: 'messageId'),
        selection: any(named: 'selection'),
      ),
    ).thenAnswer(
      (_) async => (
        comment: (id: 'c-new', createdAt: '2026-10-28T10:00:00Z'),
        thread: (id: 't-new', createdAt: '2026-10-28T10:00:00Z'),
        reply: null,
      ),
    );
    await pump(tester);

    final editable = find.descendant(
      of: find.byKey(const ValueKey('transcript-message-8')),
      matching: find.byType(EditableText),
    );
    final state = tester.state<EditableTextState>(editable);
    // "Asha: I hear you" — select "hear" (display offsets 8..12).
    state.userUpdateTextEditingValue(
      state.textEditingValue.copyWith(selection: const TextSelection(baseOffset: 8, extentOffset: 12)),
      SelectionChangedCause.drag,
    );
    state.showToolbar();
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('add-comment-menu')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('transcript-comment-input')), 'Nice reflection');
    await tester.pump();
    await tester.tap(find.byKey(const Key('comment-send-button')).last);
    await tester.pumpAndSettle();

    final captured = verify(
      () => api.addComment(
        reviewId: 'rev-1',
        content: 'Nice reflection',
        messageId: '8',
        selection: captureAny(named: 'selection'),
      ),
    ).captured.single as ReviewTextSelection;
    expect(captured.startIndex, 2);
    expect(captured.endIndex, 6);
    expect(captured.selectedText, 'hear');
    await finish(tester);
  });

  testWidgets('tapping a highlighted range opens its threads; a thread opens the comment thread, back returns', (
    tester,
  ) async {
    when(() => api.getThreadComments('t-1', offset: any(named: 'offset'), limit: any(named: 'limit')))
        .thenAnswer((_) async => (comments: [_comment('c-1', 'Good empathy here'), _comment('c-2', 'Agreed')], count: 2));
    await pump(tester);

    // Tap inside "quick" (display offset 17 of "AI client: The quick brown fox").
    final editable = tester.state<EditableTextState>(
      find.descendant(of: find.byKey(const ValueKey('transcript-message-7')), matching: find.byType(EditableText)),
    );
    final render = editable.renderEditable;
    final caret = render.getLocalRectForCaret(const TextPosition(offset: 17));
    await tester.tapAt(render.localToGlobal(caret.center));
    await tester.pumpAndSettle();

    expect(find.text('Selected text: "quick"'), findsOneWidget);
    expect(find.text('Good empathy here'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('thread-card-t-1')));
    await tester.pumpAndSettle();
    expect(find.text('Comment thread'), findsOneWidget);
    expect(find.text('Agreed'), findsOneWidget);
    expect(find.text('Add comment'), findsOneWidget, reason: 'footer input placeholder');

    await tester.tap(find.byKey(const Key('sheet-back-button')));
    await tester.pumpAndSettle();
    expect(find.text('Comment thread'), findsNothing);
    expect(find.text('Selected text: "quick"'), findsOneWidget);
    await finish(tester);
  });

  testWidgets('the comments button opens the threads sheet with Inline and General tabs', (tester) async {
    when(() => api.getThreads('rev-1', offset: any(named: 'offset'), limit: any(named: 'limit'))).thenAnswer(
      (_) async => (
        threads: [
          ReviewThread(
            id: 't-1',
            comments: [_comment('c-1', 'Good empathy here')],
            commentCount: 3,
            createdBy: _owner,
            message: ReviewThreadMessage(id: '7', content: 'The quick brown fox', senderId: -1),
            selection: const ReviewTextSelection(startIndex: 4, endIndex: 9),
          ),
        ],
        count: 1,
      ),
    );
    await pump(tester);

    await tester.tap(find.byKey(const Key('interactions-comments')));
    await tester.pumpAndSettle();

    expect(find.text('Inline'), findsOneWidget);
    expect(find.text('General'), findsOneWidget);
    expect(find.text('Selected text: "quick"'), findsOneWidget);
    expect(find.text('2 more comments'), findsOneWidget);

    await tester.tap(find.text('General'));
    await tester.pumpAndSettle();
    expect(find.text('Overall nicely done'), findsWidgets);
    await finish(tester);
  });

  testWidgets('scribe review: scribe title, no disclaimer, owner gets the Share switch in the header', (tester) async {
    final owner = UserProfile(
      id: 1,
      email: 'a@example.com',
      name: 'Asha',
      phone: '',
      profileImageUrl: null,
      profileCompleted: true,
    );
    await pump(tester, type: ReviewType.scribe, user: owner);

    expect(find.text('CALL-12'), findsOneWidget);
    expect(find.text('Scribe'), findsOneWidget);
    expect(find.text('Transcription may not always be fully accurate.'), findsNothing);
    expect(find.textContaining('Client: The quick brown fox', findRichText: true), findsOneWidget);
    expect(find.byKey(const Key('review-share-switch')), findsOneWidget);
    // Only one switch: the scribe layout keeps it out of the InteractionsBar.
    expect(
      find.descendant(of: find.byKey(const Key('interactions-bar')), matching: find.byKey(const Key('review-share-switch'))),
      findsNothing,
    );
    await finish(tester);
    verify(() => scribeReviews.markAsRead('rev-1')).called(1);
  });

  testWidgets('adding a general comment posts it into the general thread; Reply opens the replies sheet', (
    tester,
  ) async {
    when(
      () => api.addComment(
        reviewId: any(named: 'reviewId'),
        content: any(named: 'content'),
        threadId: any(named: 'threadId'),
        parentCommentId: any(named: 'parentCommentId'),
      ),
    ).thenAnswer(
      (_) async => (comment: (id: 'g-new', createdAt: '2026-10-28T10:00:00Z'), thread: null, reply: (id: 'r-new', createdAt: null)),
    );
    when(() => api.getCommentReplies('g-c1', offset: any(named: 'offset'), limit: any(named: 'limit')))
        .thenAnswer((_) async => (comments: [_comment('r-1', 'Thanks!', authorId: 1)], count: 1));
    await pump(tester);

    final input = find.descendant(
      of: find.byKey(const Key('general-comment-input-row')),
      matching: find.byType(TextField),
    );
    await tester.ensureVisible(input);
    await tester.enterText(input, 'Great call overall');
    await tester.pump();
    await tester.tap(
      find.descendant(of: find.byKey(const Key('general-comment-input-row')), matching: find.byKey(const Key('comment-send-button'))),
    );
    await tester.pumpAndSettle();

    verify(() => api.addComment(reviewId: 'rev-1', content: 'Great call overall', threadId: 'g-1')).called(1);
    expect(find.text('Great call overall'), findsOneWidget);

    await tester.ensureVisible(find.text('Overall nicely done'));
    await tester.tap(find.text('Reply').last);
    await tester.pumpAndSettle();
    expect(find.text('Replies'), findsOneWidget);
    expect(find.text('Thanks!'), findsOneWidget);

    await tester.enterText(find.byType(TextField).last, 'Glad it helped');
    await tester.pump();
    await tester.tap(find.byKey(const Key('comment-send-button')).last);
    await tester.pumpAndSettle();
    verify(() => api.addComment(reviewId: 'rev-1', content: 'Glad it helped', parentCommentId: 'g-c1')).called(1);
    await finish(tester);
  });

  testWidgets('the review refetches when the app comes back to the foreground (RN refetchOnFocus)', (tester) async {
    await pump(tester);
    verify(() => reviews.getReview('rev-1')).called(1);

    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pumpAndSettle();
    verify(() => reviews.getReview('rev-1')).called(1);
    await finish(tester);
  });
}
