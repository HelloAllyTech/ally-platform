import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/back_title_header.dart';
import '../../courses/presentation/course_item_player_screen.dart';
import '../data/notification_item.dart';
import '../data/notifications_repository.dart';

/// Port of ally-mobile (React Native)'s `NotificationsScreen` — list, mark
/// read on tap, mark-all-read action, infinite-scroll pagination
/// (`onEndReached`/`hasMore`, now that the repository surfaces the real
/// total `count`), and tap-to-navigate for a course-discussion-reply
/// notification.
///
/// Like RN, a reply notification pushes the course item player at the
/// replied-to item with `highlightPostId`.
class NotificationsScreen extends ConsumerStatefulWidget {
  const NotificationsScreen({super.key});

  @override
  ConsumerState<NotificationsScreen> createState() =>
      _NotificationsScreenState();
}

class _NotificationsScreenState extends ConsumerState<NotificationsScreen> {
  final _scrollController = ScrollController();

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
  }

  @override
  void dispose() {
    _scrollController.removeListener(_onScroll);
    _scrollController.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (_scrollController.position.pixels >=
        _scrollController.position.maxScrollExtent - 200) {
      ref.read(notificationsControllerProvider.notifier).loadMore();
    }
  }

  /// Mirrors ally-mobile (React Native)'s own `timeAgo` helper exactly
  /// (including its un-translated "just now"/"Xm ago" literals — that
  /// screen doesn't use `useTranslate` at all, so neither does this).
  static String _timeAgo(String iso) {
    final seconds = DateTime.now()
        .toUtc()
        .difference(DateTime.parse(iso).toUtc())
        .inSeconds;
    if (seconds < 60) return 'just now';
    final minutes = seconds ~/ 60;
    if (minutes < 60) return '${minutes}m ago';
    final hours = minutes ~/ 60;
    if (hours < 24) return '${hours}h ago';
    final days = hours ~/ 24;
    if (days < 7) return '${days}d ago';
    final date = DateTime.parse(iso).toLocal();
    return '${date.month}/${date.day}/${date.year}';
  }

  Future<void> _onItemTap(NotificationItem item) async {
    if (!item.isRead) {
      await ref.read(notificationsRepositoryProvider).markRead(item.id);
      ref.invalidate(notificationsControllerProvider);
    }
    if (item.type == kCourseDiscussionReplyNotificationType) {
      final trackId = item.data?['trackId'] as String?;
      final itemId = item.data?['itemId'] as String?;
      final postId = item.data?['postId'] as String?;
      if (trackId != null && itemId != null && mounted) {
        context.push(
          '/courses/item/$itemId',
          extra: CourseItemPlayerArgs(trackId: trackId, highlightPostId: postId),
        );
      }
    }
  }

  // RN's NotificationsScreen sets no fontFamily: iOS system font.
  static const _system = 'CupertinoSystemText';
  static const _titleStyle = TextStyle(
    fontFamily: _system,
    fontSize: 14,
    height: 22 / 14,
    letterSpacing: 0.2,
    fontWeight: FontWeight.w600,
    color: AppColors.highEmphasis,
  );
  static const _bodyStyle = TextStyle(
    fontFamily: _system,
    fontSize: 12,
    height: 16 / 12,
    letterSpacing: 0.2,
    color: AppColors.mediumEmphasis,
  );
  static const _timeStyle = TextStyle(
    fontFamily: _system,
    fontSize: 10,
    height: 14 / 10,
    letterSpacing: 0.3,
    color: AppColors.lowEmphasis,
  );

  @override
  Widget build(BuildContext context) {
    final pageAsync = ref.watch(notificationsControllerProvider);
    final hasUnread = pageAsync.maybeWhen(
      data: (page) => page.items.any((n) => !n.isRead),
      orElse: () => false,
    );

    return Scaffold(
      backgroundColor: Colors.white,
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // RN's styles.header: padding 21/16, 0.5 rule, back arrow
          // marginRight 16, REPLAY_PRO display.small title, and "Mark all
          // read" only while something is unread (else a 24pt spacer).
          BackTitleHeader(
            key: const Key('notifications-header'),
            title: ref.t('notifications.title'),
            margin: EdgeInsets.zero,
            padding: const EdgeInsets.symmetric(horizontal: 21, vertical: 16),
            gap: 16,
            borderColor: AppColors.strokePrimary,
            trailing: hasUnread
                ? GestureDetector(
                    key: const Key('notifications-mark-all'),
                    onTap: () async {
                      await ref.read(notificationsRepositoryProvider).markAllRead();
                      ref.invalidate(notificationsControllerProvider);
                    },
                    child: Text(
                      ref.t('notifications.markAllRead'),
                      style: const TextStyle(
                        fontFamily: _system,
                        fontSize: 12,
                        height: 16 / 12,
                        letterSpacing: 0.2,
                        color: AppColors.primary,
                      ),
                    ),
                  )
                : const SizedBox(width: 24),
          ),
          Expanded(
            child: pageAsync.when(
              loading: () => const Center(child: CircularProgressIndicator(color: AppColors.primary)),
              error: (error, _) => _centered(ref.t('notifications.loadError')),
              data: (page) {
                if (page.items.isEmpty) return _centered(ref.t('notifications.empty'));
                return RefreshIndicator(
                  color: AppColors.primary,
                  onRefresh: () => ref.refresh(notificationsControllerProvider.future),
                  child: ListView.builder(
                    controller: _scrollController,
                    padding: EdgeInsets.only(bottom: MediaQuery.paddingOf(context).bottom),
                    itemCount: page.items.length + (page.isLoadingMore ? 1 : 0),
                    itemBuilder: (context, index) {
                      if (index >= page.items.length) {
                        return const Padding(
                          padding: EdgeInsets.symmetric(vertical: 16),
                          child: Center(child: CircularProgressIndicator(color: AppColors.primary)),
                        );
                      }
                      return _item(page.items[index]);
                    },
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  Widget _centered(String text) => Center(
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 24),
      child: Text(
        text,
        textAlign: TextAlign.center,
        style: const TextStyle(
          fontFamily: _system,
          fontSize: 14,
          height: 22 / 14,
          letterSpacing: 0.2,
          color: AppColors.mediumEmphasis,
        ),
      ),
    ),
  );

  /// RN's `renderItem`: unread rows on grey50 with an 8pt primary dot; a
  /// semibold title, up to three lines of body, then the time.
  Widget _item(NotificationItem item) {
    final isUnread = !item.isRead;
    return GestureDetector(
      key: const Key('notification-item'),
      behavior: HitTestBehavior.opaque,
      onTap: () => _onItemTap(item),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 21, vertical: 12),
        decoration: BoxDecoration(
          color: isUnread ? AppColors.grey50 : null,
          border: const Border(bottom: BorderSide(color: AppColors.strokePrimary, width: 0.5)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (isUnread)
              Container(
                key: const Key('unread-dot'),
                width: 8,
                height: 8,
                margin: const EdgeInsets.only(top: 6, right: 8),
                decoration: const BoxDecoration(color: AppColors.primary, shape: BoxShape.circle),
              ),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(item.title, style: _titleStyle),
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(item.body, maxLines: 3, overflow: TextOverflow.ellipsis, style: _bodyStyle),
                  ),
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(_timeAgo(item.createdAt), style: _timeStyle),
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
