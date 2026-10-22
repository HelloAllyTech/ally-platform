import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';
import 'package:permission_handler/permission_handler.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/permissions/permissions_repository.dart';
import '../../../core/permissions/user_permissions.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_tab_view.dart';
import '../../../core/widgets/confirmation_modal.dart';
import '../../../core/widgets/illustrated_modal.dart';
import '../../../core/widgets/status_badge.dart';
import '../../../core/widgets/tab_screen_header.dart';
import '../data/call_log_repository.dart';
import 'call_log_filter_sheet.dart';
import 'call_tag_chip.dart';

enum _LogTab { real, simulation }

/// Port of ally-mobile (React Native)'s `CallLogScreen` — one screen, not
/// two tabs/routes. A pill `AppTabView` switches between real call logs and
/// simulation/role-play session logs only when the signed-in user holds
/// *both* `VIEW_CALL_LOGS` and `VIEW_SCENARIO_SESSION`; with only one, that
/// permission's list renders directly with no switcher at all — same
/// behavior as the real `availableLogTypes`/`activeTab` logic. A header
/// menu action (gated on `ARCHIVE_CALL_LOG`) swaps the whole screen into a
/// dedicated "Archives" view (real calls only, `archive: true`), not a
/// third tab. The floating action button for starting a new Scribe
/// recording is gated on `START_MICROPHONE_CHAT`/`START_CLOUD_TELEPHONY_CHAT`.
/// Tapping it shows the real `StartSessionModal` consent copy (reusing the
/// shared `IllustratedModal` shell, since this port has only the one
/// action it needs); confirming requests the microphone permission — with
/// RN's own 30s bound so a native permission call that never settles can't
/// silently freeze the tap forever — and only then pushes into Scribe
/// recording. A denial opens the same microphone-settings alert the
/// simulation screens already use.
///
/// Not ported: the real `StartSessionModal`'s "Create Note" manual-note
/// path (no note-creation flow — the `createNote` mutation, and a
/// CallSummaryScreen mode for a session with no existing call-log entry
/// yet — exists in this app). The filter sheet
/// (`CallLogFilterSheet`) is ported for the built-in filters only — RN's
/// dynamic, tenant-configured custom-field filters need a
/// `CustomFieldDefinition` catalog client this app doesn't have yet.
class CallLogScreen extends ConsumerStatefulWidget {
  const CallLogScreen({super.key});

  @override
  ConsumerState<CallLogScreen> createState() => _CallLogScreenState();
}

class _CallLogScreenState extends ConsumerState<CallLogScreen> {
  _LogTab? _activeTab;
  bool _isViewingArchive = false;
  bool _isStartingScribe = false;

  void _showStartSessionModal() {
    IllustratedModal.show(
      context,
      titleMain: ref.t('calls.dialog.startSession.titleNormal'),
      titleItalic: ref.t('calls.dialog.startSession.titleItalic'),
      description: ref.t('calls.dialog.startSession.footer'),
      actionButtonText: ref.t('calls.dialog.startSession.startScribeMode'),
      actionButtonVariant: AppButtonVariant.primary,
      onActionPressed: _startScribeSession,
    );
  }

  /// A second tap while the first is still resolving must not start a
  /// parallel flow — matches RN's own `isStartingScribe` guard, which was
  /// added after a real incident where two sessions got created seconds
  /// apart. The microphone request is bounded to 30s (RN's own
  /// `PERMISSION_TIMEOUT_MS`) so a native permission call that never
  /// settles can't leave a counsellor staring at a screen that looks frozen
  /// with no recourse but force-quitting the app.
  Future<void> _startScribeSession() async {
    if (_isStartingScribe) return;
    setState(() => _isStartingScribe = true);
    try {
      var status = await Permission.microphone.status.timeout(const Duration(seconds: 30));
      if (!status.isGranted) {
        status = await Permission.microphone.request().timeout(const Duration(seconds: 30));
      }
      if (!mounted) return;
      if (status.isGranted) {
        context.push('/scribe');
        return;
      }
      await _showMicrophoneSettingsAlert();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(ref.t('common.somethingWentWrong'))),
        );
      }
    } finally {
      if (mounted) setState(() => _isStartingScribe = false);
    }
  }

  Future<void> _showMicrophoneSettingsAlert() {
    return showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(ref.t('simulationPage.allowMicrophone')),
        content: Text(ref.t('simulationPage.microphonePrompt')),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: Text(ref.t('common.cancel')),
          ),
          TextButton(
            onPressed: () {
              Navigator.of(context).pop();
              openAppSettings();
            },
            child: Text(ref.t('common.openSettings')),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final permissionsAsync = ref.watch(userPermissionsProvider);

    return permissionsAsync.when(
      loading: () => const Scaffold(body: Center(child: CircularProgressIndicator())),
      error: (error, _) => Scaffold(body: Center(child: Text('$error'))),
      data: (permissions) => _buildScreen(context, permissions),
    );
  }

  Widget _buildScreen(BuildContext context, List<String> permissions) {
    final hasReal = permissions.contains(UserPermissions.viewCallLogs);
    final hasSimulation = permissions.contains(UserPermissions.viewScenarioSession);
    final hasArchive = permissions.contains(UserPermissions.archiveCallLog);
    final hasChatDetails = permissions.contains(UserPermissions.viewChatDetails);
    final hasScenarioDetails = permissions.contains(UserPermissions.viewScenarioSessionDetails);
    final hasTags = permissions.contains(UserPermissions.viewTags);
    final canStartCall = permissions.contains(UserPermissions.startMicrophoneChat) ||
        permissions.contains(UserPermissions.startCloudTelephonyChat);

    if (hasReal && hasSimulation) {
      _activeTab ??= _LogTab.real;
    } else if (hasReal) {
      _activeTab = _LogTab.real;
    } else if (hasSimulation) {
      _activeTab = _LogTab.simulation;
    } else {
      _activeTab = null;
    }

    final showTabs = hasReal && hasSimulation && !_isViewingArchive;
    final showArchiveAction =
        hasArchive && !_isViewingArchive && _activeTab == _LogTab.real;
    final showFilterAction = hasReal && _activeTab == _LogTab.real;

    return Scaffold(
      body: Stack(
        children: [
          Column(
            children: [
              TabScreenHeader(
                title: _isViewingArchive ? ref.t('calls.menu.archives') : ref.t('calls.title'),
                subtitle: _isViewingArchive ? null : ref.t('nav.tabs.sessions'),
                leading: _isViewingArchive
                    ? IconButton(
                        icon: const Icon(Icons.arrow_back),
                        onPressed: () => setState(() => _isViewingArchive = false),
                      )
                    : null,
                trailing: (showFilterAction || showArchiveAction)
                    ? Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          if (showFilterAction)
                            _FilterButton(hasTagsPermission: hasTags),
                          if (showArchiveAction)
                            PopupMenuButton<void>(
                              icon: const Icon(Icons.more_vert),
                              itemBuilder: (context) => [
                                PopupMenuItem(
                                  onTap: () => setState(() => _isViewingArchive = true),
                                  child: Text(ref.t('calls.menu.archives')),
                                ),
                              ],
                            ),
                        ],
                      )
                    : null,
              ),
              if (showTabs)
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
                  child: AppTabView<_LogTab>(
                    tabs: [
                      AppTabViewItem(key: _LogTab.real, label: ref.t('analytics.types.callLogs')),
                      AppTabViewItem(
                        key: _LogTab.simulation,
                        label: ref.t('analytics.types.rolePlay'),
                      ),
                    ],
                    activeTab: _activeTab!,
                    onTabChange: (tab) => setState(() => _activeTab = tab),
                  ),
                ),
              Expanded(
                child: _activeTab == null
                    ? Center(child: Text(ref.t('calls.fallback.callEmptyTitle')))
                    : _isViewingArchive
                        ? _RealLogsList(
                            provider: archivedCallLogsProvider,
                            canViewDetails: hasChatDetails,
                            canArchive: false,
                          )
                        : _activeTab == _LogTab.real
                            ? _RealLogsList(
                                provider: realCallLogsProvider,
                                canViewDetails: hasChatDetails,
                                canArchive: hasArchive,
                              )
                            : _SimulationLogsList(canViewDetails: hasScenarioDetails),
              ),
            ],
          ),
          if (canStartCall)
            Positioned(
              right: 20,
              bottom: 30,
              child: _StartSessionFab(onPressed: _showStartSessionModal),
            ),
        ],
      ),
    );
  }
}

class _FilterButton extends ConsumerWidget {
  const _FilterButton({required this.hasTagsPermission});

  final bool hasTagsPermission;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final activeCount = ref.watch(callLogFilterProvider).activeCount;
    return Stack(
      clipBehavior: Clip.none,
      children: [
        IconButton(
          icon: const Icon(Icons.filter_list),
          onPressed: () =>
              CallLogFilterSheet.show(context, hasTagsPermission: hasTagsPermission),
        ),
        if (activeCount > 0)
          Positioned(
            right: 4,
            top: 4,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
              decoration: const BoxDecoration(
                color: AppColors.primary,
                shape: BoxShape.circle,
              ),
              child: Text(
                '$activeCount',
                style: const TextStyle(color: Colors.white, fontSize: 10),
              ),
            ),
          ),
      ],
    );
  }
}

class _StartSessionFab extends StatelessWidget {
  const _StartSessionFab({required this.onPressed});

  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.primary,
      shape: const CircleBorder(),
      elevation: 6,
      child: InkWell(
        key: const Key('start-session-fab'),
        customBorder: const CircleBorder(),
        onTap: onPressed,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: SvgPicture.asset(
            'assets/icons/transcribe.svg',
            width: 28,
            height: 28,
            colorFilter: const ColorFilter.mode(Colors.white, BlendMode.srcIn),
          ),
        ),
      ),
    );
  }
}

class _RealLogsList extends ConsumerWidget {
  const _RealLogsList({
    required this.provider,
    required this.canViewDetails,
    required this.canArchive,
  });

  final FutureProvider<List<CallLogItem>> provider;
  final bool canViewDetails;
  final bool canArchive;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final logsAsync = ref.watch(provider);

    return logsAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, _) => Center(child: Text('${ref.t('common.somethingWentWrong')} $error')),
      data: (logs) {
        if (logs.isEmpty) {
          return Center(child: Text(ref.t('calls.fallback.callEmptyTitle')));
        }
        return ListView.separated(
          itemCount: logs.length,
          separatorBuilder: (_, _) => const Divider(height: 1),
          itemBuilder: (context, index) {
            final log = logs[index];
            final row = ListTile(
              leading: SvgPicture.asset('assets/icons/call.svg', width: 24, height: 24),
              title: Text(log.sessionName ?? ref.t('calls.sessionNumber', {'id': log.id})),
              subtitle: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(log.startedAt),
                  if (log.tags.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Wrap(
                        children: [for (final tag in log.tags) CallTagChip(tag: tag)],
                      ),
                    ),
                ],
              ),
              isThreeLine: log.tags.isNotEmpty,
              trailing: StatusBadge(
                status: chatSummaryStatusFromString(log.status),
                noAudioLabel: ref.t('calls.status.noAudio'),
              ),
              enabled: canViewDetails,
              onTap: canViewDetails ? () => context.push('/call-log/${log.id}', extra: log) : null,
            );

            if (!canArchive) return row;

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
              // RN has no swipe-to-archive gesture at all here — archiving
              // only happens deliberately from inside CallSummaryScreen's
              // own ArchiveActionModal (not yet ported). A bare swipe
              // reaching the dismiss threshold used to archive immediately
              // and irreversibly with no confirmation — a real accidental-
              // data-loss risk (a stray diagonal scroll touch silently
              // archives a call log). Reusing that real modal's own copy
              // keeps this swipe entry point working without the silent
              // part, until the full menu this normally lives behind is
              // built.
              confirmDismiss: (_) => ConfirmationModal.show(
                context,
                title: ref.t('callSummary.archiveActionModal.archive.header.title'),
                subtitle: ref.t('callSummary.archiveActionModal.archive.header.subtitle'),
                description: ref.t('callSummary.archiveActionModal.archive.description'),
                confirmLabel: ref.t('callSummary.archiveActionModal.archive.confirm'),
                cancelLabel: ref.t('callSummary.archiveActionModal.archive.cancel'),
                confirmVariant: AppButtonVariant.destructive,
              ).then((confirmed) => confirmed ?? false),
              onDismissed: (_) => ref.read(callLogRepositoryProvider).archiveCallLog(log.id),
              child: row,
            );
          },
        );
      },
    );
  }
}

class _SimulationLogsList extends ConsumerWidget {
  const _SimulationLogsList({required this.canViewDetails});

  final bool canViewDetails;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final logsAsync = ref.watch(simulationLogsProvider);

    return logsAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, _) => Center(child: Text('${ref.t('common.somethingWentWrong')} $error')),
      data: (logs) {
        if (logs.isEmpty) {
          return Center(child: Text(ref.t('calls.fallback.simEmptyTitle')));
        }
        return ListView.separated(
          itemCount: logs.length,
          separatorBuilder: (_, _) => const Divider(height: 1),
          itemBuilder: (context, index) {
            final log = logs[index];
            return ListTile(
              leading: SvgPicture.asset('assets/icons/call.svg', width: 24, height: 24),
              title: Text(log.scenarioTitle ?? ref.t('calls.sessionNumber', {'id': log.id})),
              subtitle: Text(log.startedAt),
              trailing: StatusBadge(
                status: chatSummaryStatusFromString(log.status),
                noAudioLabel: ref.t('calls.status.noAudio'),
              ),
              enabled: canViewDetails,
              onTap: canViewDetails
                  ? () => context.push('/simulations/feedback/${log.id}')
                  : null,
            );
          },
        );
      },
    );
  }
}
