import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/widgets/tab_screen_header.dart';
import '../data/notification_item.dart';
import '../data/notifications_repository.dart';

/// Port of ally-mobile (React Native)'s `NotificationsScreen` — list, mark
/// read on tap, mark-all-read action, infinite-scroll pagination
/// (`onEndReached`/`hasMore`, now that the repository surfaces the real
/// total `count`), and tap-to-navigate for a course-discussion-reply
/// notification.
///
/// Scoped simplification on that last one: RN pushes straight into
/// `COURSE_ITEM_PLAYER` at the replied-to item with `highlightPostId` to
/// scroll to/highlight the specific reply. This app's course-item-player
/// route needs a full fetched `TrackDetailItem` (not just an id) and has
/// no discussion-thread UI yet to highlight a post within, so tapping
/// instead opens the track's own detail screen — close context, not the
/// exact item/post RN lands on.
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
      if (trackId != null && mounted) context.push('/courses/$trackId');
    }
  }

  @override
  Widget build(BuildContext context) {
    final pageAsync = ref.watch(notificationsControllerProvider);
    final hasUnread = pageAsync.maybeWhen(
      data: (page) => page.items.any((n) => !n.isRead),
      orElse: () => false,
    );

    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            TabScreenHeader(
              title: ref.t('notifications.title'),
              leading: IconButton(
                icon: const Icon(Icons.arrow_back),
                onPressed: () => context.pop(),
              ),
              // RN only shows "Mark all read" when there's something unread,
              // else a blank spacer — not unconditionally.
              trailing: hasUnread
                  ? TextButton(
                      onPressed: () async {
                        await ref
                            .read(notificationsRepositoryProvider)
                            .markAllRead();
                        ref.invalidate(notificationsControllerProvider);
                      },
                      child: Text(ref.t('notifications.markAllRead')),
                    )
                  : null,
            ),
            Expanded(
              child: pageAsync.when(
                loading: () => const Center(child: CircularProgressIndicator()),
                error: (error, _) => Center(
                  child: Text('${ref.t('notifications.loadError')}: $error'),
                ),
                data: (page) {
                  if (page.items.isEmpty) {
                    return Center(child: Text(ref.t('notifications.empty')));
                  }
                  return RefreshIndicator(
                    onRefresh: () =>
                        ref.refresh(notificationsControllerProvider.future),
                    child: ListView.separated(
                      controller: _scrollController,
                      itemCount:
                          page.items.length + (page.isLoadingMore ? 1 : 0),
                      separatorBuilder: (_, _) => const Divider(height: 1),
                      itemBuilder: (context, index) {
                        if (index >= page.items.length) {
                          return const Padding(
                            padding: EdgeInsets.symmetric(vertical: 16),
                            child: Center(child: CircularProgressIndicator()),
                          );
                        }
                        final item = page.items[index];
                        return ListTile(
                          leading: Icon(
                            item.isRead
                                ? Icons.notifications_none
                                : Icons.notifications_active,
                            color: item.isRead
                                ? null
                                : Theme.of(context).colorScheme.primary,
                          ),
                          title: Text(
                            item.title,
                            style: TextStyle(
                              fontWeight: item.isRead
                                  ? FontWeight.normal
                                  : FontWeight.bold,
                            ),
                          ),
                          subtitle: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(item.body),
                              Text(
                                _timeAgo(item.createdAt),
                                style: Theme.of(context).textTheme.bodySmall,
                              ),
                            ],
                          ),
                          isThreeLine: true,
                          onTap: () => _onItemTap(item),
                        );
                      },
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}
