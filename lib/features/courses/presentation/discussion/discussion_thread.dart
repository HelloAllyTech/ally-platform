import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/localization/localization_controller.dart';
import '../../../../core/localization/translate_ref.dart';
import '../../../../core/theme/app_colors.dart';
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
      if (mounted) setState(() => _mutationError = '$e');
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
    // Watched unconditionally (not just lazily via `ref.t()` once data
    // arrives) so the bundled-asset load starts on the very first frame
    // regardless of `discussionProvider`'s own loading state — same
    // precedent as `main.dart`'s `AllyApp`/`ProfileSettingsScreen`/
    // `LanguageSelectorSheet`'s own eager pre-watch of this provider.
    ref.watch(localizationControllerProvider);
    final discussionAsync = ref.watch(discussionProvider(widget.itemId));

    return Container(
      key: const Key('discussion-thread'),
      constraints: const BoxConstraints(maxHeight: 320),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: const BoxDecoration(border: Border(top: BorderSide(color: AppColors.strokePrimary))),
      child: discussionAsync.when(
        loading: () => const Center(child: Padding(padding: EdgeInsets.all(20), child: CircularProgressIndicator())),
        error: (error, _) => Center(
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  ref.t('courses.discussion.loadFailed'),
                  style: const TextStyle(color: AppColors.mediumEmphasis),
                ),
                const SizedBox(height: 10),
                SizedBox(
                  width: 120,
                  child: AppButton(
                    key: const Key('discussion-retry'),
                    size: AppButtonSize.sm,
                    label: ref.t('courses.player.retry'),
                    onPressed: () => ref.invalidate(discussionProvider(widget.itemId)),
                  ),
                ),
              ],
            ),
          ),
        ),
        data: (data) => Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    '${ref.t('courses.discussion.heading')} (${data.postCount})',
                    style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16, color: AppColors.highEmphasis),
                  ),
                ),
                if (data.viewer.canModerate)
                  InkWell(
                    key: const Key('discussion-lock-toggle'),
                    onTap: () => _handleToggleDiscussionLock(data.isLocked),
                    child: Text(
                      data.isLocked
                          ? ref.t('courses.discussion.unlockDiscussion')
                          : ref.t('courses.discussion.lockDiscussion'),
                      style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.primary),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 8),
            Flexible(
              child: ListView(
                shrinkWrap: true,
                children: [
                  if (data.posts.isEmpty)
                    Padding(
                      key: const Key('discussion-empty-state'),
                      padding: const EdgeInsets.symmetric(vertical: 20),
                      child: Column(
                        children: [
                          Text(
                            ref.t('courses.discussion.emptyTitle'),
                            style: const TextStyle(fontWeight: FontWeight.w600, color: AppColors.highEmphasis),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            ref.t('courses.discussion.emptyBody'),
                            textAlign: TextAlign.center,
                            style: const TextStyle(fontSize: 13, color: AppColors.mediumEmphasis),
                          ),
                        ],
                      ),
                    )
                  else
                    for (final post in data.posts)
                      DiscussionPostTile(
                        key: ValueKey(post.id),
                        post: post,
                        maxLength: data.viewer.maxLength,
                        highlightPostId: widget.highlightPostId,
                        isSubmittingReply: _isReplying,
                        isSubmittingEdit: _isEditing,
                        onReply: _handleReply,
                        onEdit: _handleEdit,
                        onDelete: _handleDelete,
                        onToggleLock: _handleToggleLock,
                      ),
                  if (_mutationError != null)
                    Padding(
                      key: const Key('discussion-mutation-error'),
                      padding: const EdgeInsets.only(top: 8),
                      child: Text(_mutationError!, style: const TextStyle(fontSize: 12, color: AppColors.red400)),
                    ),
                  const SizedBox(height: 8),
                  if (data.isLocked)
                    Text(
                      key: const Key('discussion-locked-note'),
                      ref.t('courses.discussion.discussionLocked'),
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: AppColors.mediumEmphasis),
                    )
                  else if (data.viewer.canPost)
                    DiscussionPostInput(
                      key: const Key('discussion-composer'),
                      controller: _draftController,
                      onSubmit: _handleSubmitPost,
                      maxLength: data.viewer.maxLength,
                      isSubmitting: _isPosting,
                      submitLabel: ref.t('courses.discussion.post'),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
