import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../../core/localization/translate_ref.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_fonts.dart';
import '../../../../core/theme/rn_scale.dart';
import '../../data/discussion_models.dart';
import '../course_styles.dart';
import 'discussion_post_input.dart';

/// Visual indent step per depth, capped — depth only ever goes to 3. Direct
/// port of ally-mobile (React Native)'s `DiscussionPost.tsx` constants.
const _indentStep = 16.0;
const _maxIndentDepth = 3;

String _timeAgo(String iso) {
  final date = DateTime.tryParse(iso);
  if (date == null) return '';
  final seconds = DateTime.now().difference(date).inSeconds;
  if (seconds < 60) return 'just now';
  final minutes = seconds ~/ 60;
  if (minutes < 60) return '${minutes}m ago';
  final hours = minutes ~/ 60;
  if (hours < 24) return '${hours}h ago';
  final days = hours ~/ 24;
  if (days < 7) return '${days}d ago';
  // `toLocaleDateString()` (en-US): M/D/YYYY.
  final local = date.toLocal();
  return '${local.month}/${local.day}/${local.year}';
}

/// Direct port of ally-mobile (React Native)'s `src/components/
/// DiscussionPost/DiscussionPost.tsx` — one post (and, recursively, its
/// replies). Every affordance (reply/edit/delete/lock) is gated purely on
/// the server-computed flags already on [post] (`canReply`/`canEdit`/
/// `canDelete`/`canLock`) — there is no client-side permission logic here,
/// matching RN exactly.
class DiscussionPostTile extends ConsumerStatefulWidget {
  const DiscussionPostTile({
    super.key,
    required this.post,
    required this.maxLength,
    this.highlightPostId,
    this.isSubmittingReply = false,
    this.isSubmittingEdit = false,
    required this.onReply,
    required this.onEdit,
    required this.onDelete,
    required this.onToggleLock,
  });

  final DiscussionPost post;
  final int maxLength;
  final String? highlightPostId;
  final bool isSubmittingReply;
  final bool isSubmittingEdit;
  final Future<bool> Function(String postId, String content) onReply;
  final Future<bool> Function(String postId, String content) onEdit;
  final void Function(String postId) onDelete;
  final void Function(String postId, bool locked) onToggleLock;

  @override
  ConsumerState<DiscussionPostTile> createState() => _DiscussionPostTileState();
}

class _DiscussionPostTileState extends ConsumerState<DiscussionPostTile> {
  bool _isReplying = false;
  late final _replyController = TextEditingController();
  bool _isEditing = false;
  late final _editController = TextEditingController(text: widget.post.content ?? '');

  @override
  void dispose() {
    _replyController.dispose();
    _editController.dispose();
    super.dispose();
  }

  /// RN `Alert.alert` with a Cancel and a destructive Delete — the native
  /// iOS alert, so a Cupertino dialog here.
  Future<void> _handleDelete() async {
    final confirmed = await showCupertinoDialog<bool>(
      context: context,
      builder: (dialogContext) => CupertinoAlertDialog(
        title: Text(ref.t('courses.discussion.deleteConfirmTitle')),
        content: Text(ref.t('courses.discussion.deleteConfirmBody')),
        actions: [
          CupertinoDialogAction(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(ref.t('common.cancel')),
          ),
          CupertinoDialogAction(
            key: const Key('discussion-delete-confirm'),
            isDestructiveAction: true,
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(ref.t('courses.discussion.delete')),
          ),
        ],
      ),
    );
    if (confirmed == true) widget.onDelete(widget.post.id);
  }

  Future<void> _submitReply() async {
    final ok = await widget.onReply(widget.post.id, _replyController.text.trim());
    if (ok && mounted) {
      _replyController.clear();
      setState(() => _isReplying = false);
    }
  }

  Future<void> _submitEdit() async {
    final ok = await widget.onEdit(widget.post.id, _editController.text.trim());
    if (ok && mounted) setState(() => _isEditing = false);
  }

  @override
  Widget build(BuildContext context) {
    final post = widget.post;
    final size = RnSize.of(context);
    final indent = (post.depth - 1).clamp(0, _maxIndentDepth - 1) * _indentStep;
    // styles.container: paddingVertical 10@mvs, borderTop 1, gap 4@mvs.
    final gap = size.mvs(4);

    if (post.isDeletedByAuthor) {
      return Container(
        margin: EdgeInsets.only(left: indent),
        padding: EdgeInsets.symmetric(vertical: size.mvs(10)),
        decoration: const BoxDecoration(border: Border(top: BorderSide(color: AppColors.strokePrimary))),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: withGap<Widget>([
            Padding(
              padding: EdgeInsets.symmetric(vertical: size.mvs(10)),
              child: Text(
                ref.t('courses.discussion.deletedByAuthor'),
                style: CourseText.serif(
                  CourseType.bodyMedium,
                  AppColors.lowEmphasis,
                ).copyWith(fontStyle: FontStyle.italic),
              ),
            ),
            for (final reply in post.replies) _buildReplyTile(reply),
          ], () => SizedBox(height: gap)),
        ),
      );
    }

    final isHighlighted = widget.highlightPostId != null && widget.highlightPostId == post.id;
    const actionStyle = TextStyle(fontFamily: AppFonts.ibmPlexSerifMedium, fontSize: 12, color: AppColors.primary);

    return Container(
      margin: EdgeInsets.only(left: indent),
      padding: EdgeInsets.symmetric(vertical: size.mvs(10)),
      decoration: BoxDecoration(
        border: const Border(top: BorderSide(color: AppColors.strokePrimary)),
        // styles.highlighted: ds.theme.onSecondary (white).
        color: isHighlighted ? Colors.white : null,
      ),
      child: Column(
        key: Key('discussion-post-${post.id}'),
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: withGap<Widget>([
          Row(
            children: [
              Flexible(
                child: Text(
                  post.author?.name ?? '',
                  style: const TextStyle(
                    fontFamily: AppFonts.ibmPlexSerifMedium,
                    fontSize: 13,
                    color: AppColors.highEmphasis,
                  ),
                ),
              ),
              const SizedBox(width: 6),
              Text(
                _timeAgo(post.createdAt) +
                    (post.isEdited
                        ? post.editedByModerator
                              ? ' · ${ref.t('courses.discussion.editedByModerator')}'
                              : ' · ${ref.t('courses.discussion.edited')}'
                        : ''),
                style: const TextStyle(fontFamily: AppFonts.ibmPlexSerifRegular, fontSize: 11, color: AppColors.lowEmphasis),
              ),
              if (post.isLocked) ...[
                const SizedBox(width: 6 + 2),
                SvgPicture.asset(
                  'assets/icons/lock.svg',
                  key: Key('post-lock-badge-${post.id}'),
                  width: size.raw(12),
                  height: size.raw(12),
                ),
              ],
            ],
          ),
          if (_isEditing)
            DiscussionPostInput(
              testId: 'discussion-post-${post.id}-edit',
              controller: _editController,
              onSubmit: _submitEdit,
              maxLength: widget.maxLength,
              isSubmitting: widget.isSubmittingEdit,
              submitLabel: ref.t('courses.discussion.save'),
              autoFocus: true,
              onCancel: () {
                _editController.text = post.content ?? '';
                setState(() => _isEditing = false);
              },
            )
          else
            Text(post.content ?? '', style: CourseText.serif(CourseType.bodyMedium, AppColors.highEmphasis)),
          if (post.isLocked)
            Text(
              ref.t('courses.discussion.threadLocked'),
              style: const TextStyle(fontFamily: AppFonts.ibmPlexSerifRegular, fontSize: 11, color: AppColors.mediumEmphasis),
            ),
          if (!_isEditing)
            Padding(
              padding: EdgeInsets.only(top: size.mvs(2)),
              child: Row(
                children: withGap<Widget>([
                  if (post.canReply)
                    _Tap(
                      key: Key('discussion-post-${post.id}-reply-toggle'),
                      onTap: () => setState(() => _isReplying = !_isReplying),
                      child: Text(ref.t('courses.discussion.reply'), style: actionStyle),
                    ),
                  if (post.canEdit)
                    _Tap(
                      key: Key('discussion-post-${post.id}-edit-toggle'),
                      onTap: () => setState(() => _isEditing = true),
                      child: SvgPicture.asset('assets/icons/edit.svg', width: size.raw(14), height: size.raw(14)),
                    ),
                  if (post.canDelete)
                    _Tap(
                      key: Key('discussion-post-${post.id}-delete'),
                      onTap: _handleDelete,
                      child: SvgPicture.asset('assets/icons/delete.svg', width: size.raw(14), height: size.raw(14)),
                    ),
                  if (post.canLock)
                    _Tap(
                      key: Key('discussion-post-${post.id}-lock-toggle'),
                      onTap: () => widget.onToggleLock(post.id, !post.isLocked),
                      child: Text(
                        post.isLocked
                            ? ref.t('courses.discussion.unlockThread')
                            : ref.t('courses.discussion.lockThread'),
                        style: actionStyle,
                      ),
                    ),
                ], () => const SizedBox(width: 16)),
              ),
            ),
          if (_isReplying)
            Padding(
              padding: EdgeInsets.only(top: size.mvs(8)),
              child: DiscussionPostInput(
                testId: 'discussion-post-${post.id}-reply',
                controller: _replyController,
                onSubmit: _submitReply,
                maxLength: widget.maxLength,
                isSubmitting: widget.isSubmittingReply,
                submitLabel: ref.t('courses.discussion.reply'),
                autoFocus: true,
                onCancel: () {
                  _replyController.clear();
                  setState(() => _isReplying = false);
                },
              ),
            ),
          for (final reply in post.replies) _buildReplyTile(reply),
        ], () => SizedBox(height: gap)),
      ),
    );
  }

  Widget _buildReplyTile(DiscussionPost reply) => DiscussionPostTile(
    key: ValueKey(reply.id),
    post: reply,
    maxLength: widget.maxLength,
    highlightPostId: widget.highlightPostId,
    isSubmittingReply: widget.isSubmittingReply,
    isSubmittingEdit: widget.isSubmittingEdit,
    onReply: widget.onReply,
    onEdit: widget.onEdit,
    onDelete: widget.onDelete,
    onToggleLock: widget.onToggleLock,
  );
}

class _Tap extends StatelessWidget {
  const _Tap({super.key, required this.onTap, required this.child});

  final VoidCallback onTap;
  final Widget child;

  @override
  Widget build(BuildContext context) =>
      GestureDetector(behavior: HitTestBehavior.opaque, onTap: onTap, child: child);
}
