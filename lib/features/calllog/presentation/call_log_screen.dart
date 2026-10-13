import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../data/call_log_repository.dart';

/// Scoped port of ally-mobile (React Native)'s `CallLog` screen — list of
/// past sessions with archive action. Tag-based filtering not ported.
class CallLogScreen extends ConsumerWidget {
  const CallLogScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final callLogsAsync = ref.watch(callLogsProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Call log')),
      body: callLogsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) =>
            Center(child: Text('Failed to load call log: $error')),
        data: (logs) {
          if (logs.isEmpty) {
            return const Center(child: Text('No calls yet.'));
          }
          return ListView.separated(
            itemCount: logs.length,
            separatorBuilder: (_, _) => const Divider(height: 1),
            itemBuilder: (context, index) {
              final log = logs[index];
              return Dismissible(
                key: ValueKey(log.id),
                direction: DismissDirection.endToStart,
                background: Container(
                  color: Colors.red,
                  alignment: Alignment.centerRight,
                  padding: const EdgeInsets.only(right: 20),
                  child: const Icon(Icons.archive, color: Colors.white),
                ),
                onDismissed: (_) =>
                    ref.read(callLogRepositoryProvider).archiveCallLog(log.id),
                child: ListTile(
                  leading: const Icon(Icons.call),
                  title: Text(log.sessionName ?? 'Session #${log.id}'),
                  subtitle: Text('${log.status} · ${log.startedAt}'),
                  trailing: log.score != null
                      ? Text('${log.score!.round()}')
                      : null,
                  onTap: () => context.push('/call-log/${log.id}', extra: log),
                ),
              );
            },
          );
        },
      ),
    );
  }
}
