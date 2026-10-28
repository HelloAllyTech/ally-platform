import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/permissions/permissions_repository.dart';
import '../../../core/permissions/user_permissions.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/theme/rn_scale.dart';
import '../../../core/widgets/review_type_chip.dart';
import '../../account/data/account_repository.dart';
import '../../account/data/user_profile.dart';
import '../data/review_api.dart';
import '../data/review_models.dart';
import '../data/reviews_repository.dart';
import '../data/scribe_reviews_repository.dart';
import 'comment_list_controller.dart';
import 'review_comment_sheets.dart';
import 'review_conversation.dart';
import 'review_details_parts.dart';
import 'review_note_callout.dart';
import 'review_styles.dart';
import 'simulation_audio_player.dart';

/// Port of ally-mobile (React Native)'s `SimulationReviewDetailsScreen` /
/// `ScribeReviewDetailsScreen`, both thin wrappers around
/// `ReviewDetailsLayout` + `useReviewDetailsLogic`; [reviewType] picks the
/// data source (RN's `ReviewApiProvider`) and the few layout differences.
///
/// Layout, top to bottom: a back arrow + [ReviewTranscriptHeader] over a
/// lightGray7 rule; the transcription disclaimer (simulation only); then
/// RN's `Conversation` list — the audio player and [ReviewNoteCallout] as
/// its header, the transcript (10 messages a page), and, once every page
/// has loaded, [GeneralCommentsSection] as its footer; with the floating
/// [InteractionsBar] over the bottom.
///
/// Comment threads: selecting transcript text offers "Add comment", which
/// opens RN's `CommentInput` sheet and starts a new thread anchored to the
/// selection (`POST …/comments {messageId, selection, content}`); commented
/// ranges are highlighted and open their threads when tapped. The comment
/// button opens the threads sheet (Inline / General), and threads open
/// RN's comment-thread and reply sheets — see `review_comment_sheets.dart`.
///
/// The review is marked read 10 seconds after opening (RN's timer), not
/// when tapped in the list.
class ReviewDetailsScreen extends ConsumerStatefulWidget {
  const ReviewDetailsScreen({super.key, required this.reviewId, this.reviewType = ReviewType.simulation});

  final String reviewId;
  final ReviewType reviewType;

  @override
  ConsumerState<ReviewDetailsScreen> createState() => _ReviewDetailsScreenState();
}

class _ReviewDetailsScreenState extends ConsumerState<ReviewDetailsScreen> {
  static const _messagesPerPage = 10;

  final List<TranscriptMessage> _messages = [];
  bool _hasMore = true;
  bool _isFetching = false;
  bool _loadedOnce = false;
  bool _loadError = false;
  int _generation = 0;
  Timer? _markReadTimer;

  CommentListController? _general;
  String? _generalThreadId;

  bool get _isScribe => widget.reviewType == ReviewType.scribe;
  ReviewApi get _api => ref.read(reviewApiProvider(widget.reviewType));

  @override
  void initState() {
    super.initState();
    _loadMessages(reset: true);
    _markReadTimer = Timer(const Duration(seconds: 10), () {
      final markRead = _isScribe
          ? ref.read(scribeReviewsRepositoryProvider).markAsRead(widget.reviewId)
          : ref.read(reviewsRepositoryProvider).markAsRead(widget.reviewId);
      // The Review tab's unread dot reads `unreadReviewCountProvider`; once
      // this review is read the count is stale, so refetch it (the shell
      // outlives this screen, hence the container rather than `ref`).
      final container = ProviderScope.containerOf(context, listen: false);
      markRead.then((_) => container.invalidate(unreadReviewCountProvider)).catchError((_) {});
    });
  }

  @override
  void dispose() {
    _markReadTimer?.cancel();
    _general?.dispose();
    super.dispose();
  }

  void _refreshReview() {
    ref.invalidate(_isScribe ? scribeReviewDetailProvider(widget.reviewId) : reviewDetailProvider(widget.reviewId));
  }

  /// RN's `useReviewDetailsLogic` paging: 10 at a time, `hasMore` while a
  /// full page comes back, de-duplicated by id.
  Future<void> _loadMessages({required bool reset}) async {
    if (!reset && (_isFetching || !_hasMore)) return;
    if (reset) {
      _generation++;
      _messages.clear();
      _hasMore = true;
    }
    final generation = _generation;
    setState(() => _isFetching = true);
    try {
      final page = await _api.getMessages(widget.reviewId, offset: _messages.length, limit: _messagesPerPage);
      if (!mounted || generation != _generation) return;
      setState(() {
        final seen = _messages.map((m) => m.id).toSet();
        _messages.addAll(page.where((m) => !seen.contains(m.id)));
        _hasMore = page.length >= _messagesPerPage;
        _loadError = false;
      });
    } catch (_) {
      if (!mounted || generation != _generation) return;
      setState(() {
        _hasMore = false;
        _loadError = !_loadedOnce;
      });
    } finally {
      if (mounted && generation == _generation) {
        setState(() {
          _isFetching = false;
          _loadedOnce = true;
        });
      }
    }
  }

  Future<void> _refresh() async {
    _refreshReview();
    await _loadMessages(reset: true);
  }

  CommentListController _generalFor(ReviewItem review, UserProfile? user) {
    final controller = _general ??= CommentListController(
      api: _api,
      currentUser: user,
      fetchPage: (offset, limit) => _api.getGeneralComments(widget.reviewId, offset: offset, limit: limit),
      addComment: (content) async =>
          (await _api.addComment(reviewId: widget.reviewId, threadId: _generalThreadId, content: content)).comment,
      onChanged: (change) {
        if (change is CommentAdded || change is CommentDeleted) _refreshReview();
      },
    );
    // RN only fetches once the review has a general thread
    // (`skip: !generalCommentsThreadId`).
    if (review.generalCommentsThreadId != null && review.generalCommentsThreadId != _generalThreadId) {
      _generalThreadId = review.generalCommentsThreadId;
      scheduleMicrotask(controller.refresh);
    }
    return controller;
  }

  /// RN's `useToggleReviewPrivacy`: on → IN_REVIEW, off → HIDDEN.
  Future<void> _togglePrivate(bool isEnabled) async {
    final status = isEnabled ? 'IN_REVIEW' : 'HIDDEN';
    try {
      if (_isScribe) {
        await ref.read(scribeReviewsRepositoryProvider).updateReviewStatus(reviewId: widget.reviewId, status: status);
      } else {
        await ref.read(reviewsRepositoryProvider).updateReviewStatus(reviewId: widget.reviewId, status: status);
      }
      _refreshReview();
      _toast(ref.tr('simulationPage.privacyUpdated'));
    } catch (_) {
      _toast(ref.tr('simulationPage.errorUpdatePrivacy'));
    }
  }

  void _toast(String message) {
    if (!mounted) return;
    ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _reactToReview(String? current, String unicode) async {
    try {
      await _api.addReactionToReview(
        reviewId: widget.reviewId,
        reaction: unicode,
        action: reactionActionFor(current, unicode),
      );
      _refreshReview();
    } catch (_) {
      // RN only logs this.
    }
  }

  /// RN's `handleSelection` → `CommentInput` → `handleSendComment`: posts a
  /// new thread anchored to the selection and adds it to the message
  /// locally (RN's `updateMessage`).
  Future<void> _addCommentOnSelection(TranscriptMessage message, ReviewTextSelection selection, UserProfile? user) async {
    final content = await showTranscriptCommentInput(context, ref);
    if (content == null || content.trim().isEmpty || selection.selectedText.isEmpty) return;
    try {
      final result = await _api.addComment(
        reviewId: widget.reviewId,
        messageId: message.id,
        selection: selection,
        content: content.trim(),
      );
      final thread = result.thread;
      final comment = result.comment;
      if (thread == null || comment == null || !mounted) return;
      final author = ReviewAuthor(id: user?.id ?? 0, name: user?.name ?? '', profileImage: user?.profileImageUrl ?? '');
      final newThread = ReviewThread(
        id: thread.id,
        comments: [
          ThreadComment(
            id: comment.id,
            content: content.trim(),
            createdAt: comment.createdAt,
            authorName: author.name,
            authorId: user?.id,
            authorProfileImage: user?.profileImageUrl,
            reactions: const {},
            myReaction: null,
          ),
        ],
        commentCount: 1,
        createdBy: author,
        message: null,
        selection: selection,
      );
      setState(() {
        final i = _messages.indexWhere((m) => m.id == message.id);
        if (i != -1) _messages[i] = _messages[i].copyWith(threads: [..._messages[i].threads, newThread]);
      });
      _refreshReview();
    } catch (_) {
      // RN only logs this.
    }
  }

  /// RN's `handleThreadCommentChange` — keeps the transcript's copy of a
  /// thread in step with the comment sheet (a thread whose last comment is
  /// deleted disappears, un-highlighting its text).
  void _onThreadChange(String threadId, CommentChange change) {
    if (!mounted) return;
    setState(() {
      for (var i = 0; i < _messages.length; i++) {
        final message = _messages[i];
        if (!message.threads.any((t) => t.id == threadId)) continue;
        final threads = <ReviewThread>[];
        for (final thread in message.threads) {
          if (thread.id != threadId) {
            threads.add(thread);
            continue;
          }
          final comments = switch (change) {
            CommentDeleted(:final commentId) => thread.comments.where((c) => c.id != commentId).toList(),
            CommentEdited(:final commentId, :final content) => [
              for (final c in thread.comments) c.id == commentId ? c.copyWith(content: content) : c,
            ],
            CommentAdded(:final comment) => [comment, ...thread.comments],
            CommentHidden(:final commentId, :final hidden) => [
              for (final c in thread.comments) c.id == commentId ? c.copyWith(hidden: hidden) : c,
            ],
          };
          if (comments.isNotEmpty) threads.add(thread.copyWith(comments: comments));
        }
        _messages[i] = message.copyWith(threads: threads);
      }
    });
  }

  void _editNote(ReviewItem review) {
    final session = _isScribe ? null : review.scenarioSession;
    final scribe = review.scribeSession;
    context.push(
      '/share-for-review/${review.id}',
      extra: (
        reviewId: review.id,
        note: review.note,
        contextDateTime: session?.createdAt ?? scribe?.createdAt,
        contextDuration: session?.duration ?? scribe?.duration,
        isScribe: _isScribe,
        contextTitle: _isScribe ? (review.summaryName ?? scribe?.summaryName) : review.scenario?.title,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final reviewAsync = _isScribe
        ? ref.watch(scribeReviewDetailProvider(widget.reviewId))
        : ref.watch(reviewDetailProvider(widget.reviewId));
    final review = reviewAsync.value;
    final user = ref.watch(currentUserProvider).value;
    final permissions = ref.watch(userPermissionsProvider).value ?? const <String>[];

    if (!_loadedOnce && _isFetching) {
      return const Scaffold(
        backgroundColor: Colors.white,
        body: Center(child: CircularProgressIndicator(color: AppColors.primary)),
      );
    }
    if (_loadError) {
      // RN keeps spinning on an error; say what happened instead.
      return Scaffold(
        backgroundColor: Colors.white,
        body: Center(child: Text(ref.t('review.error.loadReviewFailed'))),
      );
    }

    final canEditReview = permissions.contains(
      _isScribe ? UserPermissions.editScribeReview : UserPermissions.editSimulationReview,
    );
    final canViewThreads = _isScribe || permissions.contains(UserPermissions.viewSimulationReviewThreads);
    final canEditThread = _isScribe || permissions.contains(UserPermissions.editSimulationReviewThread);
    final isPrivate = review?.isPrivate ?? false;
    final isOwner = review != null && user != null && user.id == review.createdBy.id;
    final onTogglePrivate = canEditReview && isOwner ? _togglePrivate : null;
    final canEditNote = review != null && !isMinutesPassed(review.createdAt) && isOwner && !isPrivate;

    final sheetContext = review == null
        ? null
        : ReviewSheetContext(
            api: _api,
            reviewId: widget.reviewId,
            reviewOwnerId: review.createdBy.id,
            isPrivate: isPrivate,
            generalCommentsThreadId: review.generalCommentsThreadId,
            currentUser: user,
            onThreadChange: _onThreadChange,
            onReviewChanged: _refreshReview,
          );

    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        bottom: false,
        child: Stack(
          children: [
            Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _titleBar(review, isPrivate: isPrivate, onTogglePrivate: _isScribe ? onTogglePrivate : null),
                if (!_isScribe)
                  Padding(
                    padding: EdgeInsets.only(left: 20, right: 20, top: RnSize.of(context).s(6)),
                    child: Text(
                      ref.t('transcription.accuracyDisclaimer'),
                      style: const TextStyle(
                        fontFamily: AppFonts.ibmPlexSerifRegular,
                        fontSize: 11,
                        color: AppColors.mediumEmphasis,
                      ),
                    ),
                  ),
                Expanded(
                  child: _conversation(
                    review: review,
                    user: user,
                    sheetContext: sheetContext,
                    selectable: !isPrivate && canEditThread,
                    canViewThreads: canViewThreads,
                    canEditNote: canEditNote,
                  ),
                ),
              ],
            ),
            if (review != null)
              Positioned(
                left: 0,
                right: 0,
                bottom: RnSize.of(context).vs(30),
                child: Center(
                  child: InteractionsBar(
                    reviewId: widget.reviewId,
                    reviewType: widget.reviewType,
                    reactions: review.reactions,
                    commentsCount: review.commentsCount,
                    myReaction: review.myReaction,
                    isPrivate: isPrivate,
                    onReact: _reactToReview,
                    onCommentPress: canViewThreads && sheetContext != null
                        ? () => showReviewCommentSheet(
                            context,
                            sheetContext: sheetContext,
                            initialPage: const ThreadsSheetPage(),
                          )
                        : null,
                    onTogglePrivate: _isScribe ? null : onTogglePrivate,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  /// RN's `styles.titleContainer`: back arrow + header over a 1pt rule.
  Widget _titleBar(ReviewItem? review, {required bool isPrivate, ValueChanged<bool>? onTogglePrivate}) {
    final rn = RnSize.of(context);
    return Container(
      padding: EdgeInsets.symmetric(vertical: rn.s(8), horizontal: 20),
      decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: AppColors.lightGray7))),
      child: Row(
        children: [
          GestureDetector(
            key: const Key('review-details-back'),
            behavior: HitTestBehavior.opaque,
            onTap: () => context.pop(),
            child: SvgPicture.asset(
              'assets/icons/leftArrow.svg',
              width: 16,
              height: 16,
              colorFilter: const ColorFilter.mode(Colors.black, BlendMode.srcIn),
            ),
          ),
          if (review != null)
            Expanded(
              child: ReviewTranscriptHeader(
                reviewType: widget.reviewType,
                title: _isScribe
                    ? (review.summaryName ??
                          review.scribeSession?.summaryName ??
                          ref.t('review.details.callTitle', {'id': review.scribeSession?.id ?? ''}))
                    : (review.scenario?.title ?? ''),
                user: review.createdBy,
                createdAt: _isScribe ? review.scribeSession?.createdAt : review.scenarioSession?.createdAt,
                duration: _isScribe ? review.scribeSession?.duration : review.scenarioSession?.duration,
                scenario: _isScribe ? null : review.scenario,
                isPrivate: isPrivate,
                onTogglePrivate: onTogglePrivate,
              ),
            )
          else
            const Spacer(),
        ],
      ),
    );
  }

  String _senderName(TranscriptMessage message, ReviewItem? review) {
    if (message.isClient) {
      return ref.t(_isScribe ? 'transcription.clientLabel' : 'transcription.aiClientSuffix');
    }
    return review?.createdBy.name ?? ref.t('transcription.youLabel');
  }

  Widget _conversation({
    required ReviewItem? review,
    required UserProfile? user,
    required ReviewSheetContext? sheetContext,
    required bool selectable,
    required bool canViewThreads,
    required bool canEditNote,
  }) {
    final audioUrl = _isScribe ? null : review?.scenarioSession?.audioUrl;
    final note = review?.note;
    final hasNote = (note != null && note.isNotEmpty) || canEditNote;

    // Messages are built lazily by the list below (the transcript pages
    // without bound); only the few rows around them are built up front.
    final leading = <Widget>[
      if (audioUrl != null)
        SimulationAudioPlayer(audioUrl: audioUrl, margin: const EdgeInsets.only(left: 16, right: 16, top: 12, bottom: 4)),
      if (review != null && hasNote)
        ReviewNoteCallout(note: note, onEditNote: canEditNote ? () => _editNote(review) : null),
      if (_messages.isEmpty && !_isFetching)
        Center(
          child: Text(ref.t('conversation.noMessages'), style: const TextStyle(fontFamily: systemFontFamily, fontSize: 14)),
        ),
    ];
    Widget messageRow(TranscriptMessage message) => TranscriptMessageRow(
          key: ValueKey('message-${message.id}'),
          message: message,
          senderName: _senderName(message, review),
          selectable: selectable,
          addCommentLabel: ref.t('common.addComment'),
          onAddComment: (selection) => _addCommentOnSelection(message, selection, user),
          onThreadsTap: canViewThreads && sheetContext != null
              ? (ids) => showReviewCommentSheet(
                  context,
                  sheetContext: sheetContext,
                  initialPage: MessageThreadsSheetPage(
                    messageContent: message.content,
                    threads: message.threads.where((t) => ids.contains(t.id)).toList(),
                  ),
                )
              : null,
        );
    final trailing = <Widget>[
      if (_isFetching && _messages.isNotEmpty)
        const Padding(
          padding: EdgeInsets.symmetric(vertical: 16),
          child: Center(child: CircularProgressIndicator(color: AppColors.primary)),
        )
      else if (!_hasMore && review != null && sheetContext != null)
        GeneralCommentsSection(
          controller: _generalFor(review, user),
          currentUser: user,
          isPrivate: review.isPrivate,
          reviewOwnerId: review.createdBy.id,
          hasGeneralThread: review.generalCommentsThreadId != null,
          onReplyPress: (comment) =>
              showReviewCommentSheet(context, sheetContext: sheetContext, initialPage: ReplySheetPage(comment)),
        ),
    ];

    Map<String, int>? messageIndex;
    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: _refresh,
      child: NotificationListener<ScrollNotification>(
        onNotification: (n) {
          if (n.metrics.extentAfter < n.metrics.viewportDimension * 0.5) _loadMessages(reset: false);
          return false;
        },
        child: ListView.builder(
          physics: const AlwaysScrollableScrollPhysics(),
          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
          padding: const EdgeInsets.only(left: 16, right: 16, top: 16, bottom: 100),
          itemCount: leading.length + _messages.length + trailing.length,
          // Like ListView(children:)'s key lookup: a message row keeps its
          // state when the rows above it (audio player, note) come or go.
          findChildIndexCallback: (key) {
            if (key is! ValueKey<String>) return null;
            messageIndex ??= {for (var i = 0; i < _messages.length; i++) 'message-${_messages[i].id}': i};
            final i = messageIndex![key.value];
            return i == null ? null : leading.length + i;
          },
          itemBuilder: (context, index) {
            if (index < leading.length) return leading[index];
            index -= leading.length;
            if (index < _messages.length) return messageRow(_messages[index]);
            return trailing[index - _messages.length];
          },
        ),
      ),
    );
  }
}
