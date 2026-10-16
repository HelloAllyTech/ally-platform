import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/widgets/tab_screen_header.dart';
import '../data/call_log_repository.dart';

/// Scoped port of ally-mobile (React Native)'s `CallLog` screen — list of
/// past sessions with archive action. Tag-based filtering not ported.
class CallLogScreen extends ConsumerWidget {
  const CallLogScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final callLogsAsync = ref.watch(callLogsProvider);

    return Scaffold(
      body: Column(
        children: [
          TabScreenHeader(title: ref.t('calls.title'), subtitle: ref.t('nav.tabs.sessions')),
          Expanded(
            child: callLogsAsync.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (error, _) =>
                  Center(child: Text('${ref.t('common.somethingWentWrong')} $error')),
              data: (logs) {
                if (logs.isEmpty) {
                  return Center(child: Text(ref.t('calls.fallback.callEmptyTitle')));
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
                        child: SvgPicture.asset(
                          'assets/icons/archive.svg',
                          width: 20,
                          height: 20,
                          colorFilter: const ColorFilter.mode(Colors.white, BlendMode.srcIn),
                        ),
                      ),
                      onDismissed: (_) =>
                          ref.read(callLogRepositoryProvider).archiveCallLog(log.id),
                      child: ListTile(
                        leading: SvgPicture.asset('assets/icons/call.svg', width: 24, height: 24),
                        title: Text(
                          log.sessionName ?? ref.t('calls.sessionNumber', {'id': log.id}),
                        ),
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
          ),
        ],
      ),
    );
  }
}
