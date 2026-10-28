import 'package:dio/dio.dart';
import 'package:flutter/cupertino.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/localization/localization_controller.dart';
import '../../../../core/localization/translate_ref.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_fonts.dart';
import '../../../../core/theme/rn_scale.dart';
import '../../../../core/widgets/app_button.dart';
import '../../data/discussion_repository.dart';
import 'discussion_post_input.dart';
import 'discussion_post_tile.dart';

/// Direct port of ally-mobile (React Native)'s `src/components/
/// DiscussionThread/DiscussionThread.tsx` — the inline discussion panel
/// rendered beneath a Track 2.0 item's content when
/// `TrackDetailItem.hasDiscussion` is true (see
/// `CourseItemPlayerScreen`'s own wiring). Owns the thread fetch, the
/// top-level composer, and every post/reply mutation; per-post UI lives in
/// [DiscussionPostTile].
class DiscussionThread extends ConsumerStatefulWidget {
  const DiscussionThread({super.key, required this.itemId, this.highlightPostId});

  final String itemId;

  /// Deep-linked post to scroll to / highlight, best-effort (see RN's own
  /// notification-handling doc comment) — not wired from any Flutter call
  /// site yet (no deep-link infrastructure reaches this screen), but
  /// plumbed through so [DiscussionPostTile]'s highlight styling works the
  /// moment one does.
  final String? highlightPostId;

  @override
  ConsumerState<DiscussionThread> createState() => _DiscussionThreadState();
}

class _DiscussionThreadState extends ConsumerState<DiscussionThread> {
  final _draftController = TextEditingController();
  String? _mutationError;
  bool _isPosting = false;
  bool _isReplying = false;
  bool _isEditing = false;

  @override
  void dispose() {
    _draftController.dispose();
    super.dispose();
  }

  Future<bool> _runMutation(Future<void> Function() fn) async {
    setState(() => _mutationError = null);
    try {
      await fn();
      ref.invalidate(discussionProvider(widget.itemId));
      return true;
    } catch (e) {
      if (mounted) setState(() => _mutationError = discussionErrorMessage(e) ?? ref.tr('common.somethingWentWrong'));
      return false;
    }
  }

  Future<void> _handleSubmitPost() async {
    final content = _draftController.text.trim();
    setState(() => _isPosting = true);
    final ok = await _runMutation(
      () => ref.read(discussionRepositoryProvider).createPost(itemId: widget.itemId, content: content),
    );
    if (mounted) {
      setState(() => _isPosting = false);
      if (ok) _draftController.clear();
    }
  }

  Future<bool> _handleReply(String postId, String content) async {
    setState(() => _isReplying = true);
    final ok = await _runMutation(
      () => ref.read(discussionRepositoryProvider).replyToPost(postId: postId, content: content),
    );
    if (mounted) setState(() => _isReplying = false);
    return ok;
  }

  Future<bool> _handleEdit(String postId, String content) async {
    setState(() => _isEditing = true);
    final ok = await _runMutation(
      () => ref.read(discussionRepositoryProvider).editPost(postId: postId, content: content),
    );
    if (mounted) setState(() => _isEditing = false);
    return ok;
  }

  void _handleDelete(String postId) {
    _runMutation(() => ref.read(discussionRepositoryProvider).deletePost(postId));
  }

  void _handleToggleLock(String postId, bool locked) {
    _runMutation(() => ref.read(discussionRepositoryProvider).lockPost(postId: postId, locked: locked));
  }

  void _handleToggleDiscussionLock(bool currentlyLocked) {
    _runMutation(
      () => ref.read(discussionRepositoryProvider).lockDiscussion(itemId: widget.itemId, locked: !currentlyLocked),
    );
  }

  @override
  Widget build(BuildContext context) {
    ref.watch(localizationControllerProvider);
    final discussionAsync = ref.watch(discussionProvider(widget.itemId));
    final data = discussionAsync.value;
    final size = RnSize.of(context);
    final isLoading = discussionAsync.isLoading && data == null;
    final isError = discussionAsync.hasError && data == null;
    final isFetching = discussionAsync.isLoading && data != null;
    final primarySpinner = const CupertinoActivityIndicator(color: AppColors.primary);

    final Widget body;
    if (isLoading) {
      body = Padding(
        padding: EdgeInsets.symmetric(vertical: size.mvs(20)),
        child: Center(child: primarySpinner),
      );
    } else if (isError) {
      // styles.centered: paddingVertical 20@mvs, gap 10@mvs.
      body = Padding(
        padding: EdgeInsets.symmetric(vertical: size.mvs(20)),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              ref.t('courses.discussion.loadFailed'),
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontFamily: AppFonts.ibmPlexSerifRegular,
                fontSize: 14,
                color: AppColors.mediumEmphasis,
              ),
            ),
            SizedBox(height: size.mvs(10)),
            AppButton(
              key: const Key('discussion-retry'),
              size: AppButtonSize.sm,
              label: ref.t('courses.player.retry'),
              onPressed: () => ref.invalidate(discussionProvider(widget.itemId)),
            ),
          ],
        ),
      );
    } else {
      final thread = data!;
      body = Flexible(
        child: SingleChildScrollView(
          key: const Key('keyboard-aware-scroll-view'),
          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.manual,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (thread.posts.isEmpty)
                Padding(
                  key: const Key('discussion-empty-state'),
                  padding: EdgeInsets.symmetric(vertical: size.mvs(20)),
                  child: Column(
                    children: [
                      Text(
                        ref.t('courses.discussion.emptyTitle'),
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          fontFamily: AppFonts.ibmPlexSerifMedium,
                          fontSize: 14,
                          color: AppColors.highEmphasis,
                        ),
                      ),
                      SizedBox(height: size.mvs(4)),
                      Text(
                        ref.t('courses.discussion.emptyBody'),
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          fontFamily: AppFonts.ibmPlexSerifRegular,
                          fontSize: 13,
                          color: AppColors.mediumEmphasis,
                        ),
                      ),
                    ],
                  ),
                )
              else
                for (final post in thread.posts)
                  DiscussionPostTile(
                    key: ValueKey(post.id),
                    post: post,
                    maxLength: thread.viewer.maxLength,
                    highlightPostId: widget.highlightPostId,
                    isSubmittingReply: _isReplying,
                    isSubmittingEdit: _isEditing,
                    onReply: _handleReply,
                    onEdit: _handleEdit,
                    onDelete: _handleDelete,
                    onToggleLock: _handleToggleLock,
                  ),
              if (isFetching)
                Padding(
                  key: const Key('discussion-refreshing'),
                  padding: EdgeInsets.symmetric(vertical: size.mvs(8)),
                  child: Center(child: primarySpinner),
                ),
              if (_mutationError != null)
                Text(
                  _mutationError!,
                  key: const Key('discussion-mutation-error'),
                  style: const TextStyle(fontFamily: AppFonts.ibmPlexSerifRegular, fontSize: 12, color: AppColors.red400),
                ),
              if (thread.isLocked)
                Padding(
                  padding: EdgeInsets.symmetric(vertical: size.mvs(8)),
                  child: Text(
                    ref.t('courses.discussion.discussionLocked'),
                    key: const Key('discussion-locked-note'),
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontFamily: AppFonts.ibmPlexSerifRegular,
                      fontSize: 13,
                      color: AppColors.mediumEmphasis,
                    ),
                  ),
                )
              else if (thread.viewer.canPost)
                DiscussionPostInput(
                  testId: 'discussion-composer',
                  controller: _draftController,
                  onSubmit: _handleSubmitPost,
                  maxLength: thread.viewer.maxLength,
                  isSubmitting: _isPosting,
                  submitLabel: ref.t('courses.discussion.post'),
                ),
            ],
          ),
        ),
      );
    }

    // styles.container: borderTop 1, paddingHorizontal 16, paddingVertical
    // 12@mvs, gap 8@mvs. RN gives the panel no fixed height (its scroll view
    // is flex 1 under the item player); here it is capped so the item above
    // keeps its room.
    return Container(
      key: const Key('discussion-thread'),
      constraints: const BoxConstraints(maxHeight: 320),
      padding: EdgeInsets.symmetric(horizontal: 16, vertical: size.mvs(12)),
      decoration: const BoxDecoration(border: Border(top: BorderSide(color: AppColors.strokePrimary))),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  '${ref.t('courses.discussion.heading')}${data != null ? ' (${data.postCount})' : ''}',
                  style: const TextStyle(
                    fontFamily: AppFonts.ibmPlexSerifMedium,
                    fontSize: 16,
                    color: AppColors.highEmphasis,
                  ),
                ),
              ),
              if (data?.viewer.canModerate ?? false)
                GestureDetector(
                  key: const Key('discussion-lock-toggle'),
                  behavior: HitTestBehavior.opaque,
                  onTap: () => _handleToggleDiscussionLock(data.isLocked),
                  child: Text(
                    data!.isLocked
                        ? ref.t('courses.discussion.unlockDiscussion')
                        : ref.t('courses.discussion.lockDiscussion'),
                    style: const TextStyle(fontFamily: AppFonts.ibmPlexSerifMedium, fontSize: 12, color: AppColors.primary),
                  ),
                ),
            ],
          ),
          SizedBox(height: size.mvs(8)),
          body,
        ],
      ),
    );
  }
}

/// RN `getErrorDetails(err).message`: the API's `message` (or `error`)
/// field; null when there is none so the caller falls back to
/// `common.somethingWentWrong`.
String? discussionErrorMessage(Object error) {
  if (error is DioException) {
    final data = error.response?.data;
    if (data is Map) {
      final message = data['message'];
      if (message is String && message.isNotEmpty) return message;
      if (message is List && message.isNotEmpty) return message.join(', ');
      final err = data['error'];
      if (err is String && err.isNotEmpty) return err;
    }
  }
  return null;
}
