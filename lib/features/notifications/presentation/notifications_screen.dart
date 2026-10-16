import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/widgets/tab_screen_header.dart';
import '../data/notifications_repository.dart';

/// Port of ally-mobile (React Native)'s `NotificationsScreen` — list, mark
/// read on tap, mark-all-read action.
class NotificationsScreen extends ConsumerWidget {
  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final notificationsAsync = ref.watch(notificationsListProvider);

    return Scaffold(
      body: Column(
        children: [
          TabScreenHeader(
            title: ref.t('notifications.title'),
            trailing: TextButton(
              onPressed: () async {
                await ref.read(notificationsRepositoryProvider).markAllRead();
                ref.invalidate(notificationsListProvider);
              },
              child: Text(ref.t('notifications.markAllRead')),
            ),
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
                        subtitle: Text(item.body),
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
