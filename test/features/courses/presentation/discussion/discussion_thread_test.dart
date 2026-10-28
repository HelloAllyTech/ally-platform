import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/courses/data/discussion_models.dart';
import 'package:ally_mobile_flutter/features/courses/data/discussion_repository.dart';
import 'package:ally_mobile_flutter/features/courses/presentation/discussion/discussion_thread.dart';

import '../../../../support/pump_app.dart';

class MockDiscussionRepository extends Mock implements DiscussionRepository {}

DiscussionViewer _viewer({
  bool canModerate = false,
  bool canPost = true,
  int maxLength = 500,
}) => DiscussionViewer(
  userId: 1,
  canModerate: canModerate,
  canPost: canPost,
  maxDepth: 3,
  maxLength: maxLength,
  editWindowMinutes: 15,
);

DiscussionPost _post({
  String id = 'p1',
  int depth = 1,
  String? parentPostId,
  String content = 'A top-level post',
  bool canReply = true,
  bool canEdit = false,
  bool canDelete = false,
  bool canLock = false,
  bool isLocked = false,
  List<DiscussionPost> replies = const [],
}) => DiscussionPost(
  id: id,
  parentPostId: parentPostId,
  depth: depth,
  author: DiscussionAuthor(id: 1, name: 'Priya', profileImageUrl: null),
  content: content,
  isDeletedByAuthor: false,
  isEdited: false,
  editedByModerator: false,
  isLocked: isLocked,
  isOwn: canEdit,
  createdAt: DateTime.now().subtract(const Duration(minutes: 5)).toIso8601String(),
  editedAt: null,
  editableUntil: null,
  canEdit: canEdit,
  canDelete: canDelete,
  canReply: canReply,
  canLock: canLock,
  replies: replies,
);

DiscussionResponse _response({
  bool enabled = true,
  bool isLocked = false,
  List<DiscussionPost> posts = const [],
  DiscussionViewer? viewer,
}) => DiscussionResponse(
  trackId: 't1',
  trackItemId: 'item-1',
  tenantId: 'tenant-1',
  enabled: enabled,
  isLocked: isLocked,
  postCount: posts.length,
  viewer: viewer ?? _viewer(),
  posts: posts,
);

void main() {
  late MockDiscussionRepository repository;

  setUp(() {
    repository = MockDiscussionRepository();
  });

  Future<void> pump(WidgetTester tester) async {
    await pumpApp(
      tester,
      Scaffold(body: DiscussionThread(itemId: 'item-1')),
      overrides: [discussionRepositoryProvider.overrideWithValue(repository)],
    );
  }

  // RN PostInput testIDs: `<testID>-submit`.
  Future<void> tapSubmit(WidgetTester tester, String composerKey) =>
      tester.tap(find.byKey(Key('$composerKey-submit')));

  testWidgets('the full empty-state, post, reply, edit, delete, lock flow', (tester) async {
    // 1. Empty state: no posts yet, composer visible since the viewer can post.
    when(() => repository.getDiscussion('item-1')).thenAnswer((_) async => _response(posts: []));
    await pump(tester);

    expect(find.byKey(const Key('discussion-empty-state')), findsOneWidget);
    expect(find.text('Discussion (0)'), findsOneWidget);
    expect(find.byKey(const Key('discussion-composer')), findsOneWidget);

    // 2. Submitting a new top-level post.
    final createdPost = _post(id: 'p1', canEdit: true, canDelete: true);
    when(() => repository.createPost(itemId: 'item-1', content: 'Hello there')).thenAnswer((_) async => createdPost);
    when(() => repository.getDiscussion('item-1')).thenAnswer((_) async => _response(posts: [createdPost]));

    await tester.enterText(find.byKey(const Key('discussion-composer')).first, 'Hello there');
    await tester.pump();
    await tapSubmit(tester, 'discussion-composer');
    await tester.pumpAndSettle();

    expect(find.text('Discussion (1)'), findsOneWidget);
    expect(find.text('A top-level post'), findsOneWidget);
    verify(() => repository.createPost(itemId: 'item-1', content: 'Hello there')).called(1);

    // 3. Reply to the post.
    final reply = _post(id: 'p2', depth: 2, parentPostId: 'p1', content: 'A reply', canReply: true);
    when(() => repository.replyToPost(postId: 'p1', content: 'Thanks!')).thenAnswer((_) async => reply);
    when(
      () => repository.getDiscussion('item-1'),
    ).thenAnswer((_) async => _response(posts: [_post(id: 'p1', canEdit: true, canDelete: true, replies: [reply])]));

    await tester.tap(find.byKey(const Key('discussion-post-p1-reply-toggle')));
    await tester.pump();
    await tester.enterText(find.byKey(const Key('discussion-post-p1-reply')), 'Thanks!');
    await tester.pump();
    await tapSubmit(tester, 'discussion-post-p1-reply');
    await tester.pumpAndSettle();

    expect(find.text('A reply'), findsOneWidget);
    verify(() => repository.replyToPost(postId: 'p1', content: 'Thanks!')).called(1);

    // 4. Edit the top-level post (it carries canEdit: true).
    final edited = _post(id: 'p1', canEdit: true, canDelete: true, content: 'Hello there, edited');
    when(() => repository.editPost(postId: 'p1', content: 'Hello there, edited')).thenAnswer((_) async => edited);
    when(() => repository.getDiscussion('item-1')).thenAnswer((_) async => _response(posts: [edited]));

    await tester.tap(find.byKey(const Key('discussion-post-p1-edit-toggle')));
    await tester.pump();
    await tester.enterText(find.byKey(const Key('discussion-post-p1-edit')), 'Hello there, edited');
    await tester.pump();
    await tapSubmit(tester, 'discussion-post-p1-edit');
    await tester.pumpAndSettle();

    expect(find.text('Hello there, edited'), findsOneWidget);
    verify(() => repository.editPost(postId: 'p1', content: 'Hello there, edited')).called(1);

    // 5. Delete the post: confirmation modal, confirm, mutation fires.
    when(() => repository.deletePost('p1')).thenAnswer((_) async {});
    when(() => repository.getDiscussion('item-1')).thenAnswer((_) async => _response(posts: []));

    await tester.tap(find.byKey(const Key('discussion-post-p1-delete')));
    await tester.pumpAndSettle();
    // RN Alert.alert → a Cupertino alert with a destructive Delete.
    expect(find.text('Delete this post?'), findsOneWidget);

    await tester.tap(find.byKey(const Key('discussion-delete-confirm')));
    await tester.pumpAndSettle();

    verify(() => repository.deletePost('p1')).called(1);
    expect(find.byKey(const Key('discussion-empty-state')), findsOneWidget);
  });

  testWidgets('a moderator sees the lock-post and lock-discussion controls and can toggle both', (tester) async {
    final lockablePost = _post(id: 'p1', canLock: true);
    when(
      () => repository.getDiscussion('item-1'),
    ).thenAnswer((_) async => _response(posts: [lockablePost], viewer: _viewer(canModerate: true)));
    await pump(tester);

    expect(find.byKey(const Key('discussion-lock-toggle')), findsOneWidget);
    expect(find.byKey(const Key('discussion-post-p1-lock-toggle')), findsOneWidget);

    when(() => repository.lockPost(postId: 'p1', locked: true)).thenAnswer((_) async => lockablePost);
    when(
      () => repository.getDiscussion('item-1'),
    ).thenAnswer((_) async => _response(posts: [_post(id: 'p1', canLock: true, isLocked: true)], viewer: _viewer(canModerate: true)));

    await tester.tap(find.byKey(const Key('discussion-post-p1-lock-toggle')));
    await tester.pumpAndSettle();

    verify(() => repository.lockPost(postId: 'p1', locked: true)).called(1);
    expect(find.byKey(Key('post-lock-badge-p1')), findsOneWidget);

    when(() => repository.lockDiscussion(itemId: 'item-1', locked: true)).thenAnswer((_) async {});
    when(() => repository.getDiscussion('item-1')).thenAnswer(
      (_) async =>
          _response(posts: [_post(id: 'p1', canLock: true, isLocked: true)], isLocked: true, viewer: _viewer(canModerate: true)),
    );

    await tester.tap(find.byKey(const Key('discussion-lock-toggle')));
    await tester.pumpAndSettle();

    verify(() => repository.lockDiscussion(itemId: 'item-1', locked: true)).called(1);
    expect(find.byKey(const Key('discussion-locked-note')), findsOneWidget);
    // A locked discussion hides the composer even for a poster who still
    // has `canPost` — mirrors RN's `data.isLocked ? ... : data.viewer.canPost`.
    expect(find.byKey(const Key('discussion-composer')), findsNothing);
  });

  testWidgets('a load failure shows the error state, and retry re-fetches', (tester) async {
    when(() => repository.getDiscussion('item-1')).thenThrow(Exception('network down'));
    await pump(tester);

    expect(find.byKey(const Key('discussion-retry')), findsOneWidget);

    when(() => repository.getDiscussion('item-1')).thenAnswer((_) async => _response(posts: []));
    await tester.tap(find.byKey(const Key('discussion-retry')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('discussion-empty-state')), findsOneWidget);
  });

  testWidgets('a reader with no post permission sees no composer at all', (tester) async {
    when(
      () => repository.getDiscussion('item-1'),
    ).thenAnswer((_) async => _response(posts: [], viewer: _viewer(canPost: false)));
    await pump(tester);

    expect(find.byKey(const Key('discussion-composer')), findsNothing);
    expect(find.byKey(const Key('discussion-locked-note')), findsNothing);
  });

  testWidgets('long threads build posts lazily and an open reply draft survives scrolling away', (tester) async {
    final posts = [for (var i = 0; i < 40; i++) _post(id: 'p$i', content: 'Post number $i')];
    when(() => repository.getDiscussion('item-1')).thenAnswer((_) async => _response(posts: posts));
    await pump(tester);

    expect(find.byKey(const Key('discussion-post-p0')), findsOneWidget);
    expect(find.byKey(const Key('discussion-post-p39'), skipOffstage: false), findsNothing);

    await tester.tap(find.byKey(const Key('discussion-post-p0-reply-toggle')));
    await tester.pump();
    await tester.enterText(find.byKey(const Key('discussion-post-p0-reply')), 'Half-written reply');
    // Unfocused: a focused EditableText keeps itself alive on its own.
    FocusManager.instance.primaryFocus?.unfocus();
    await tester.pump();

    final list = find.byKey(const Key('keyboard-aware-scroll-view'));
    await tester.dragUntilVisible(find.byKey(const Key('discussion-post-p39')), list, const Offset(0, -300));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('discussion-post-p39')), findsOneWidget);
    // p0 is scrolled out but kept alive (offstage) because its composer is open.
    expect(find.byKey(const Key('discussion-post-p1'), skipOffstage: false), findsNothing);

    await tester.dragUntilVisible(find.byKey(const Key('discussion-post-p0')), list, const Offset(0, 300));
    await tester.pumpAndSettle();
    expect(find.text('Half-written reply'), findsOneWidget);
  });
}
