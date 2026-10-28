import 'package:flutter/foundation.dart';

import '../../account/data/user_profile.dart';
import '../../reactions/data/reactions_repository.dart';
import '../data/review_api.dart';
import '../data/review_models.dart';

/// RN's `ThreadCommentChange` — what changed in a comment list, so the
/// screen holding the transcript can mirror it (`handleThreadCommentChange`).
sealed class CommentChange {
  const CommentChange();
}

class CommentAdded extends CommentChange {
  const CommentAdded(this.comment);
  final ThreadComment comment;
}

class CommentEdited extends CommentChange {
  const CommentEdited(this.commentId, this.content);
  final String commentId;
  final String content;
}

class CommentDeleted extends CommentChange {
  const CommentDeleted(this.commentId);
  final String commentId;
}

class CommentHidden extends CommentChange {
  const CommentHidden(this.commentId, this.hidden);
  final String commentId;
  final bool hidden;
}

/// Mirrors ally-mobile (React Native)'s `EDIT_COMMENT_TIME_LIMIT_MINUTES`.
const editCommentTimeLimitMinutes = 10;

/// RN's `isMinutesPassed` — true for an empty/unparseable date too.
bool isMinutesPassed(String? dateString, {int minutes = editCommentTimeLimitMinutes}) {
  final parsed = dateString == null ? null : DateTime.tryParse(dateString);
  if (parsed == null) return true;
  return DateTime.now().toUtc().difference(parsed.toUtc()).inSeconds / 60 >= minutes;
}

/// RN's `useCommentActions` + `usePaginatedComments` pair, which every
/// comment list on the review screens shares (`GeneralCommentsSection`, the
/// threads sheet's General tab, `CommentThreadBottomSheet`,
/// `ReplyBottomSheet`): a paged list (20 at a time), add/edit (one input,
/// `editingCommentId` switches it to an update), delete, hide/unhide and
/// emoji reactions, each applied locally after the request succeeds rather
/// than refetching — the same optimistic-after-success updates RN makes.
class CommentListController extends ChangeNotifier {
  CommentListController({
    required this.api,
    required this.fetchPage,
    required this.addComment,
    this.currentUser,
    this.onChanged,
    this.pageSize = 20,
  });

  final ReviewApi api;
  final Future<CommentPage> Function(int offset, int limit) fetchPage;

  /// Posts a new comment; returns its id + createdAt, or null if the
  /// backend didn't create one.
  final Future<({String id, String? createdAt})?> Function(String content) addComment;
  final UserProfile? currentUser;
  final void Function(CommentChange change)? onChanged;
  final int pageSize;

  List<ThreadComment> comments = [];
  int count = 0;
  bool isLoading = false;
  bool hasLoadedOnce = false;
  bool isSubmitting = false;
  bool hasError = false;
  String? editingCommentId;
  bool _disposed = false;

  bool get hasMore => comments.length < count;

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }

  Future<void> refresh() async {
    comments = [];
    count = 0;
    hasLoadedOnce = false;
    await _load(0);
  }

  Future<void> loadMore() async {
    if (isLoading || !hasMore) return;
    await _load(comments.length);
  }

  Future<void> _load(int offset) async {
    isLoading = true;
    hasError = false;
    _notify();
    try {
      final page = await fetchPage(offset, pageSize);
      final seen = comments.map((c) => c.id).toSet();
      comments = [...comments, ...page.comments.where((c) => !seen.contains(c.id))];
      count = page.count;
    } catch (_) {
      hasError = true;
    } finally {
      isLoading = false;
      hasLoadedOnce = true;
      _notify();
    }
  }

  void startEdit(String commentId) {
    editingCommentId = commentId;
    _notify();
  }

  void cancelEdit() {
    editingCommentId = null;
    _notify();
  }

  /// RN's `onSubmitComment`: an update while [editingCommentId] is set,
  /// otherwise a new comment prepended to the list.
  Future<void> submit(String text) async {
    final content = text.trim();
    if (content.isEmpty || isSubmitting) return;
    isSubmitting = true;
    _notify();
    final editingId = editingCommentId;
    try {
      if (editingId != null) {
        await api.updateComment(commentId: editingId, content: content);
        comments = [for (final c in comments) c.id == editingId ? c.copyWith(content: content) : c];
        onChanged?.call(CommentEdited(editingId, content));
      } else {
        final created = await addComment(content);
        if (created != null) {
          final comment = ThreadComment(
            id: created.id,
            content: content,
            createdAt: created.createdAt,
            authorName: currentUser?.name ?? '',
            authorId: currentUser?.id,
            authorProfileImage: currentUser?.profileImageUrl,
            reactions: const {},
            myReaction: null,
          );
          comments = [comment, ...comments];
          count += 1;
          onChanged?.call(CommentAdded(comment));
        }
      }
    } catch (_) {
      // RN only logs (console.error) and leaves the list as it was.
    } finally {
      editingCommentId = null;
      isSubmitting = false;
      _notify();
    }
  }

  Future<void> delete(String commentId) async {
    try {
      await api.deleteComment(commentId);
      comments = comments.where((c) => c.id != commentId).toList();
      count = count > 0 ? count - 1 : 0;
      onChanged?.call(CommentDeleted(commentId));
      _notify();
    } catch (_) {
      // RN only logs this.
    }
  }

  Future<void> setHidden(String commentId, bool hidden) async {
    try {
      await api.updateCommentVisibility(commentId: commentId, hidden: hidden);
      comments = [for (final c in comments) c.id == commentId ? c.copyWith(hidden: hidden) : c];
      onChanged?.call(CommentHidden(commentId, hidden));
      _notify();
    } catch (_) {
      // RN only logs this.
    }
  }

  /// RN's `handleEmojiSelect`, including its local reaction-count update.
  Future<void> react(String commentId, String? currentEmoji, String unicode) async {
    final action = reactionActionFor(currentEmoji, unicode);
    try {
      await api.addReactionToComment(commentId: commentId, reaction: unicode, action: action);
      comments = [
        for (final c in comments)
          c.id == commentId ? applyReaction(c, currentEmoji, unicode, action) : c,
      ];
      _notify();
    } catch (_) {
      // RN only logs this.
    }
  }

  /// RN's per-action reaction-count bookkeeping in `handleEmojiSelect`.
  static ThreadComment applyReaction(
    ThreadComment comment,
    String? currentEmoji,
    String unicode,
    ReactionAction action,
  ) {
    final reactions = Map<String, int>.of(comment.reactions);
    void decrement(String key) {
      final current = reactions[key] ?? 0;
      if (current > 1) {
        reactions[key] = current - 1;
      } else {
        reactions.remove(key);
      }
    }

    switch (action) {
      case ReactionAction.add:
        reactions[unicode] = (reactions[unicode] ?? 0) + 1;
        if (currentEmoji != null && currentEmoji != unicode) decrement(currentEmoji);
      case ReactionAction.update:
        if (currentEmoji != null) decrement(currentEmoji);
        reactions[unicode] = (reactions[unicode] ?? 0) + 1;
      case ReactionAction.remove:
        decrement(unicode);
    }
    return comment.copyWith(
      reactions: reactions,
      myReaction: () => action == ReactionAction.remove ? null : unicode,
    );
  }
}
