import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/widgets/tab_screen_header.dart';
import '../data/notifications_repository.dart';

/// Port of ally-mobile (React Native)'s `NotificationsScreen` — list, mark
/// read on tap, mark-all-read action. Not ported: pagination
/// (`onEndReached`/`hasMore` — the list endpoint here doesn't return a
/// total `count` yet to compute that from) and tap-to-navigate for
/// course-discussion-reply notifications (needs a `data` payload field on
/// `NotificationItem`, which doesn't exist yet).
class NotificationsScreen extends ConsumerWidget {
  const NotificationsScreen({super.key});

  /// Mirrors ally-mobile (React Native)'s own `timeAgo` helper exactly
  /// (including its un-translated "just now"/"Xm ago" literals — that
  /// screen doesn't use `useTranslate` at all, so neither does this).
  static String _timeAgo(String iso) {
    final seconds = DateTime.now().toUtc().difference(DateTime.parse(iso).toUtc()).inSeconds;
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

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final notificationsAsync = ref.watch(notificationsListProvider);
    final hasUnread = notificationsAsync.maybeWhen(
      data: (notifications) => notifications.any((n) => !n.isRead),
      orElse: () => false,
    );

    return Scaffold(
      body: Column(
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
                      await ref.read(notificationsRepositoryProvider).markAllRead();
                      ref.invalidate(notificationsListProvider);
                    },
                    child: Text(ref.t('notifications.markAllRead')),
                  )
                : null,
          ),
          Expanded(
            child: notificationsAsync.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (error, _) =>
                  Center(child: Text('${ref.t('notifications.loadError')}: $error')),
              data: (notifications) {
                if (notifications.isEmpty) {
                  return Center(child: Text(ref.t('notifications.empty')));
                }
                return RefreshIndicator(
                  onRefresh: () => ref.refresh(notificationsListProvider.future),
                  child: ListView.separated(
                    itemCount: notifications.length,
                    separatorBuilder: (_, _) => const Divider(height: 1),
                    itemBuilder: (context, index) {
                      final item = notifications[index];
                      return ListTile(
                        leading: Icon(
                          item.isRead
                              ? Icons.notifications_none
                              : Icons.notifications_active,
                          color: item.isRead ? null : Theme.of(context).colorScheme.primary,
                        ),
                        title: Text(
                          item.title,
                          style: TextStyle(
                            fontWeight: item.isRead ? FontWeight.normal : FontWeight.bold,
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
                        onTap: () async {
                          if (!item.isRead) {
                            await ref.read(notificationsRepositoryProvider).markRead(item.id);
                            ref.invalidate(notificationsListProvider);
                          }
                        },
                      );
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
}
