import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/localization/translate_ref.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/widgets/app_button.dart';
import '../../../../core/widgets/confirmation_modal.dart';
import '../../data/discussion_models.dart';
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
  return '${date.day}/${date.month}/${date.year}';
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

  Future<void> _handleDelete() async {
    final confirmed = await ConfirmationModal.show(
      context,
      title: ref.t('courses.discussion.deleteConfirmTitle'),
      description: ref.t('courses.discussion.deleteConfirmBody'),
      confirmLabel: ref.t('courses.discussion.delete'),
      cancelLabel: ref.t('common.cancel'),
      confirmVariant: AppButtonVariant.destructive,
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
    final indent = (post.depth - 1).clamp(0, _maxIndentDepth - 1) * _indentStep;

    if (post.isDeletedByAuthor) {
      return Padding(
        padding: EdgeInsets.only(left: indent),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 10),
              child: Text(
                ref.t('courses.discussion.deletedByAuthor'),
                style: const TextStyle(fontStyle: FontStyle.italic, color: AppColors.lowEmphasis),
              ),
            ),
            for (final reply in post.replies) _buildReplyTile(reply),
          ],
        ),
      );
    }

    final isHighlighted = widget.highlightPostId != null && widget.highlightPostId == post.id;

    return Container(
      margin: EdgeInsets.only(left: indent),
      padding: const EdgeInsets.symmetric(vertical: 10),
      decoration: BoxDecoration(
        border: const Border(top: BorderSide(color: AppColors.strokePrimary)),
        color: isHighlighted ? AppColors.primaryLight.withValues(alpha: 0.1) : null,
      ),
      child: Column(
        key: Key('discussion-post-${post.id}'),
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(
                post.author?.name ?? '',
                style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13, color: AppColors.highEmphasis),
              ),
              const SizedBox(width: 6),
              Text(
                _timeAgo(post.createdAt) +
                    (post.isEdited
                        ? post.editedByModerator
                              ? ' · ${ref.t('courses.discussion.editedByModerator')}'
                              : ' · ${ref.t('courses.discussion.edited')}'
                        : ''),
                style: const TextStyle(fontSize: 11, color: AppColors.lowEmphasis),
              ),
              if (post.isLocked) ...[
                const SizedBox(width: 4),
                Icon(Icons.lock_outline, size: 12, color: AppColors.mediumEmphasis, key: Key('post-lock-badge-${post.id}')),
              ],
            ],
          ),
          const SizedBox(height: 4),
          if (_isEditing)
            DiscussionPostInput(
              key: Key('discussion-post-${post.id}-edit'),
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
            Text(post.content ?? '', style: const TextStyle(color: AppColors.highEmphasis)),
          if (post.isLocked)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                ref.t('courses.discussion.threadLocked'),
                style: const TextStyle(fontSize: 11, color: AppColors.mediumEmphasis),
              ),
            ),
          if (!_isEditing)
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Row(
                children: [
                  if (post.canReply)
                    _ActionText(
                      key: Key('discussion-post-${post.id}-reply-toggle'),
                      label: ref.t('courses.discussion.reply'),
                      onTap: () => setState(() => _isReplying = !_isReplying),
                    ),
                  if (post.canEdit)
                    Padding(
                      padding: const EdgeInsets.only(left: 16),
                      child: InkWell(
                        key: Key('discussion-post-${post.id}-edit-toggle'),
                        onTap: () => setState(() => _isEditing = true),
                        child: const Icon(Icons.edit_outlined, size: 14, color: AppColors.mediumEmphasis),
                      ),
                    ),
                  if (post.canDelete)
                    Padding(
                      padding: const EdgeInsets.only(left: 16),
                      child: InkWell(
                        key: Key('discussion-post-${post.id}-delete'),
                        onTap: _handleDelete,
                        child: const Icon(Icons.delete_outline, size: 14, color: AppColors.mediumEmphasis),
                      ),
                    ),
                  if (post.canLock)
                    Padding(
                      padding: const EdgeInsets.only(left: 16),
                      child: _ActionText(
                        key: Key('discussion-post-${post.id}-lock-toggle'),
                        label: post.isLocked
                            ? ref.t('courses.discussion.unlockThread')
                            : ref.t('courses.discussion.lockThread'),
                        onTap: () => widget.onToggleLock(post.id, !post.isLocked),
                      ),
                    ),
                ],
              ),
            ),
          if (_isReplying)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: DiscussionPostInput(
                key: Key('discussion-post-${post.id}-reply'),
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
        ],
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

class _ActionText extends StatelessWidget {
  const _ActionText({super.key, required this.label, required this.onTap});

  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Text(label, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.primary)),
    );
  }
}
