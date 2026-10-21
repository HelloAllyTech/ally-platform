import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/permissions/permissions_repository.dart';
import '../../../core/permissions/user_permissions.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/app_chat_input.dart';
import '../../../core/widgets/review_type_chip.dart';
import '../../account/data/account_repository.dart';
import '../data/review_models.dart';
import '../data/reviews_repository.dart';
import '../data/scribe_reviews_repository.dart';
import 'review_note_callout.dart';
import 'thread_detail_screen.dart';

/// Mirrors ally-mobile (React Native)'s `isMinutesPassed` — the edit-note
/// window check (`!isMinutesPassed(createdAt)` gates the pencil icon).
bool _isMinutesPassed(String dateString, {int minutes = 10}) {
  if (dateString.trim().isEmpty) return true;
  final diff = DateTime.now().toUtc().difference(
    DateTime.parse(dateString).toUtc(),
  );
  return diff.inSeconds / 60 >= minutes;
}

/// Scoped port of ally-mobile (React Native)'s `ReviewDetailsScreen` — the
/// review note + author, a flat general discussion (matching
/// `generalCommentsApi.ts`'s scope exactly), and transcript-anchored
/// discussion threads (`reviewThreadsApi.ts`'s `getThreads` — see
/// `ThreadDetailScreen` for replies + comment-level reactions). Starting a
/// *new* thread from a fresh transcript selection, and review-status
/// updates (approve/request changes), are real further work — see
/// `reviews_repository.dart`'s doc comments.
///
/// RN splits this into `SimulationReviewDetailsScreen`/
/// `ScribeReviewDetailsScreen`, but both are thin wrappers around one
/// shared `ReviewDetailsLayout`, switching only the data source
/// (`ReviewApiProvider`) and a couple of layout props neither of which
/// this scoped port renders yet (audio player, privacy toggle). [reviewType]
/// plays that same "which data source" role here, so this one widget
/// serves both instead of duplicating the UI.
class ReviewDetailsScreen extends ConsumerStatefulWidget {
  const ReviewDetailsScreen({
    super.key,
    required this.reviewId,
    this.reviewType = ReviewType.simulation,
  });

  final String reviewId;
  final ReviewType reviewType;

  bool get _isScribe => reviewType == ReviewType.scribe;

  @override
  ConsumerState<ReviewDetailsScreen> createState() =>
      _ReviewDetailsScreenState();
}

class _ReviewDetailsScreenState extends ConsumerState<ReviewDetailsScreen> {
  final _commentController = TextEditingController();
  bool _isSubmitting = false;

  @override
  void dispose() {
    _commentController.dispose();
    super.dispose();
  }

  Future<void> _submitComment() async {
    final content = _commentController.text.trim();
    if (content.isEmpty) return;
    setState(() => _isSubmitting = true);
    try {
      if (widget._isScribe) {
        await ref
            .read(scribeReviewsRepositoryProvider)
            .addGeneralComment(reviewId: widget.reviewId, content: content);
        ref.invalidate(scribeGeneralCommentsProvider(widget.reviewId));
      } else {
        await ref
            .read(reviewsRepositoryProvider)
            .addGeneralComment(reviewId: widget.reviewId, content: content);
        ref.invalidate(generalCommentsProvider(widget.reviewId));
      }
      _commentController.clear();
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  /// Mirrors RN's `useToggleReviewPrivacy`'s `handleTogglePrivate` — `true`
  /// means the switch was turned ON (shared/visible), which maps to
  /// `IN_REVIEW`; `false` (switched off) maps to `HIDDEN`.
  Future<void> _togglePrivate(bool isEnabled) async {
    final newStatus = isEnabled ? 'IN_REVIEW' : 'HIDDEN';
    try {
      await ref
          .read(reviewsRepositoryProvider)
          .updateReviewStatus(reviewId: widget.reviewId, status: newStatus);
      if (widget._isScribe) {
        ref.invalidate(scribeReviewDetailProvider(widget.reviewId));
      } else {
        ref.invalidate(reviewDetailProvider(widget.reviewId));
      }
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(ref.tr('simulationPage.privacyUpdated'))),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(ref.tr('simulationPage.errorUpdatePrivacy'))),
        );
      }
    }
  }

  void _editNote(ReviewItem review) {
    context.push(
      '/share-for-review/${review.id}',
      extra: (reviewId: review.id, note: review.note),
    );
  }

  @override
  Widget build(BuildContext context) {
    final reviewAsync = widget._isScribe
        ? ref.watch(scribeReviewDetailProvider(widget.reviewId))
        : ref.watch(reviewDetailProvider(widget.reviewId));
    final currentUser = ref.watch(currentUserProvider).value;
    final permissions =
        ref.watch(userPermissionsProvider).value ?? const <String>[];

    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: Text(ref.t('review.title')),
          actions: [
            IconButton(
              icon: SvgPicture.asset(
                'assets/icons/smile.svg',
                width: 24,
                height: 24,
              ),
              tooltip: ref.t('review.reactionsModal.title'),
              onPressed: () => context.push(
                '/reactions/${widget.reviewId}',
                extra: widget.reviewType,
              ),
            ),
          ],
          bottom: TabBar(
            tabs: [
              Tab(text: ref.t('courses.discussion.heading')),
              Tab(text: ref.t('review.details.threadsTab')),
            ],
          ),
        ),
        body: reviewAsync.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (error, _) => Center(
            child: Text('${ref.t('review.error.loadReviewFailed')}: $error'),
          ),
          data: (review) {
            final isOwner =
                currentUser != null && currentUser.id == review.createdBy.id;
            final canEditReview = permissions.contains(
              widget._isScribe
                  ? UserPermissions.editScribeReview
                  : UserPermissions.editSimulationReview,
            );
            final canEditNote =
                isOwner &&
                !review.isPrivate &&
                !_isMinutesPassed(review.createdAt);

            return Column(
              children: [
                Padding(
                  padding: const EdgeInsets.all(24),
                  child: Row(
                    children: [
                      CircleAvatar(
                        backgroundImage:
                            review.createdBy.profileImage.isNotEmpty
                            ? NetworkImage(review.createdBy.profileImage)
                            : null,
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          review.createdBy.name,
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                      ),
                      // RN's InteractionsBar/ReviewTranscriptHeader privacy
                      // switch — ON means shared/visible (IN_REVIEW), OFF
                      // means hidden/private, same label RN uses
                      // (`learn.scenario.share`), only shown to the review's
                      // owner with edit permission.
                      if (isOwner && canEditReview)
                        Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(ref.t('learn.scenario.share')),
                            Switch(
                              value: !review.isPrivate,
                              onChanged: _togglePrivate,
                            ),
                          ],
                        ),
                    ],
                  ),
                ),
                if (!widget._isScribe)
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 24),
                    child: Text(
                      ref.t('transcription.accuracyDisclaimer'),
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ),
                // RN renders ReviewNote as a bare list-header element (no
                // padded wrapper of its own) — edge-to-edge, not inset to
                // match the avatar/name block above it.
                if (review.note.isNotEmpty)
                  ReviewNoteCallout(
                    note: review.note,
                    onEditNote: canEditNote ? () => _editNote(review) : null,
                  ),
                const Divider(height: 1),
                Expanded(
                  child: TabBarView(
                    children: [
                      _buildDiscussionTab(),
                      _ThreadsTab(
                        reviewId: widget.reviewId,
                        reviewType: widget.reviewType,
                      ),
                    ],
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _buildDiscussionTab() {
    final commentsAsync = widget._isScribe
        ? ref.watch(scribeGeneralCommentsProvider(widget.reviewId))
        : ref.watch(generalCommentsProvider(widget.reviewId));

    return Column(
      children: [
        Expanded(
          child: commentsAsync.when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (error, _) => Center(
              child: Text(
                '${ref.t('review.error.loadCommentsFailed')}: $error',
              ),
            ),
            data: (comments) => comments.isEmpty
                ? Center(child: Text(ref.t('review.details.noCommentsYet')))
                : ListView.builder(
                    padding: const EdgeInsets.all(16),
                    itemCount: comments.length,
                    itemBuilder: (context, index) {
                      final comment = comments[index];
                      // RN's shared ReviewComment component: name is
                      // IBM_PLEX_SERIF.MEDIUM (ListTile's default title
                      // style is IBMPlexSerif, but Regular weight);
                      // commentText is IBM_PLEX_SERIF.REGULAR, matching
                      // ListTile's subtitle default already.
                      return ListTile(
                        dense: true,
                        leading: SvgPicture.asset(
                          'assets/icons/chatBubble.svg',
                          width: 20,
                          height: 20,
                        ),
                        title: Text(
                          comment.authorName,
                          style: Theme.of(context).textTheme.titleMedium
                              ?.copyWith(
                                fontFamily: AppFonts.ibmPlexSerifMedium,
                              ),
                        ),
                        subtitle: Text(comment.content),
                      );
                    },
                  ),
          ),
        ),
        SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(8),
            child: AppChatInput(
              controller: _commentController,
              placeholder: ref.t('review.details.addCommentPlaceholder'),
              enabled: !_isSubmitting,
              onSend: _submitComment,
            ),
          ),
        ),
      ],
    );
  }
}

class _ThreadsTab extends ConsumerWidget {
  const _ThreadsTab({required this.reviewId, required this.reviewType});

  final String reviewId;
  final ReviewType reviewType;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final threadsAsync = reviewType == ReviewType.scribe
        ? ref.watch(scribeReviewThreadsProvider(reviewId))
        : ref.watch(reviewThreadsProvider(reviewId));

    return threadsAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, _) => Center(
        child: Text('${ref.t('review.error.loadThreadsFailed')}: $error'),
      ),
      data: (threads) => threads.isEmpty
          ? Center(child: Text(ref.t('threadsBottomSheet.noThreads')))
          : ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: threads.length,
              itemBuilder: (context, index) {
                final thread = threads[index];
                final rootComment = thread.comments.firstOrNull;
                return Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: AppCard(
                    variant: AppCardVariant.flat,
                    child: ListTile(
                      title: Text(
                        thread.message?.content ?? '(transcript moment)',
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontStyle: FontStyle.italic),
                      ),
                      subtitle: rootComment != null
                          ? Text(
                              '${rootComment.authorName}: ${rootComment.content}',
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                            )
                          : null,
                      trailing: Text('${thread.commentCount}'),
                      onTap: () => Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => ThreadDetailScreen(
                            reviewId: reviewId,
                            thread: thread,
                            reviewType: reviewType,
                          ),
                        ),
                      ),
                    ),
                  ),
                );
              },
            ),
    );
  }
}
