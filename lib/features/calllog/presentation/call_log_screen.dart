import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:permission_handler/permission_handler.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/permissions/permissions_repository.dart';
import '../../../core/permissions/user_permissions.dart';
import '../../../core/settings/settings_repository.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_tab_view.dart';
import '../../../core/widgets/confirmation_modal.dart';
import '../../../core/widgets/illustrated_modal.dart';
import '../../../core/widgets/root_scaffold_messenger.dart';
import '../../../core/widgets/status_badge.dart';
import '../../../core/widgets/tab_screen_header.dart';
import '../data/call_log_repository.dart';
import 'call_log_filter_sheet.dart';
import 'call_log_row.dart';

/// `formatDate`/`formatTime`/`calculateDuration` from ally-mobile (React
/// Native)'s `src/utils/date.ts`, ported exactly: local time, "MMM d" dates,
/// 12-hour clock times, and a plain "X mins Y secs" duration string (only
/// the "Duration:"/"Session points:" labels around it are translated, same
/// as the real component).
String _formatDate(String iso) => DateFormat('MMM d').format(DateTime.parse(iso).toLocal());

String _formatDateTimeLine(String iso) {
  final date = DateTime.parse(iso).toLocal();
  return '${DateFormat('MMM d').format(date)} • ${DateFormat('h:mm a').format(date)}';
}

String? _durationText(WidgetRef ref, String startedAt, String endedAt) {
  if (endedAt.isEmpty) return null;
  final start = DateTime.tryParse(startedAt);
  final end = DateTime.tryParse(endedAt);
  if (start == null || end == null) return null;
  final ms = end.difference(start).inMilliseconds;
  if (ms < 0) return null;
  final minutes = ms ~/ 60000;
  final seconds = (ms % 60000) ~/ 1000;
  return '${ref.t('common.duration')}: $minutes mins $seconds secs';
}

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
/// simulation screens already use. Each of the three lists (real,
/// archived, and simulation logs) paginates exactly like RN's own
/// `handleLoadMore`/`ITEMS_PER_PAGE` (`CallLogScreen.tsx`): a page of
/// [kCallLogPageSize], infinite-scroll-loaded as the list nears its bottom,
/// `hasMore` inferred from a page coming back shorter than that size (no
/// separate total-count endpoint), plus pull-to-refresh resetting back to
/// page 0 — see `call_log_repository.dart`'s `PaginatedCallLogsController`/
/// `SimulationLogsController`.
///
/// The "Create Note" manual-note option (`canCreateNote` in RN: counsellor
/// permission + the per-tenant `scribe-note-creation-enabled` toggle) sits
/// alongside Start Scribe Mode in the same sheet when offered, reusing
/// `IllustratedModal`'s secondary-button slot — RN's own `StartSessionModal`
/// renders it as a second `Button` in the same sheet, so this does too
/// rather than inventing a separate dialog. Creating a note is a plain
/// `POST /chats/note` (empty, no fields) that the backend immediately marks
/// `summaryStatus: SUCCESS` with no AI summary (a manual note has nothing to
/// generate), which `CallSummaryScreen`'s existing `isManualNote` check
/// already renders as an editable form rather than a "processing" screen —
/// so opening it after creation needs no new screen, only the navigation.
/// The filter sheet
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

  /// Mirrors RN's `StartSessionModal`: Start Scribe Mode is offered as the
  /// primary button whenever `canStartCall`, and Create Note is offered as a
  /// secondary button whenever `canCreateNote` — RN renders both, either, or
  /// (if neither) nothing at all in the same sheet, never two sheets.
  ///
  /// The create-note case needs "close the sheet, then navigate" (matching
  /// RN's `handleCreateNote`, and `_startScribeSession`'s own documented
  /// load-bearing ordering for the same reason) — but navigating with this
  /// screen's own `context` while the dialog route (always pushed on the
  /// root navigator by `showDialog`, regardless of any nested shell
  /// navigator this screen itself may live under) is still closing is the
  /// wrong order and the wrong navigator to assume are the same one. So the
  /// push below waits on `IllustratedModal.show`'s own returned future,
  /// which only completes once the dialog has actually popped *itself* (via
  /// its own context, always on the right navigator) — not on `_createNote`
  /// finishing, which only decides whether that pop should happen at all.
  Future<void> _showStartSessionModal({required bool canStartCall, required bool canCreateNote}) async {
    CallLogItem? createdNote;
    await IllustratedModal.show(
      context,
      titleMain: ref.t('calls.dialog.startSession.titleNormal'),
      titleItalic: ref.t('calls.dialog.startSession.titleItalic'),
      description: ref.t('calls.dialog.startSession.footer'),
      actionButtonText: canStartCall ? ref.t('calls.dialog.startSession.startScribeMode') : null,
      actionButtonVariant: AppButtonVariant.primary,
      onActionPressed: canStartCall ? _startScribeSession : null,
      secondaryButtonText: canCreateNote ? ref.t('calls.dialog.startSession.startDictationMode') : null,
      onSecondaryPressed: canCreateNote
          ? () async {
              createdNote = await _createNote();
              return createdNote != null;
            }
          : null,
    );
    if (createdNote != null && mounted) {
      context.push('/call-log/${createdNote!.id}', extra: createdNote);
    }
  }

  /// Mirrors RN's `handleCreateNote`'s `createNote().unwrap()` call: creates
  /// an empty manual note and returns a stand-in `CallLogItem` for it (the
  /// `/call-log/:id` route needs the row's own data as `extra`, since it
  /// isn't fetched by id alone) using the exact `startedAt`/`endedAt`/
  /// `status` the backend's `createNote` sets on the chat itself
  /// (`ChatStatus.ENDED`, both timestamps equal to the creation instant —
  /// see `ally-be`'s `ChatService.createNote`), so what's shown matches what
  /// a subsequent call-log list refresh would show for the same row. `null`
  /// means the sheet should stay open; a toast already explains why, same as
  /// RN never calling `setShowStartSession(false)` in `handleCreateNote`'s
  /// catch.
  Future<CallLogItem?> _createNote() async {
    try {
      final result = await ref.read(callLogRepositoryProvider).createNote();
      final now = DateTime.now().toUtc().toIso8601String();
      return CallLogItem(
        id: result.chatId,
        startedAt: now,
        endedAt: now,
        status: 'ENDED',
        sessionName: result.name,
        score: null,
      );
    } catch (_) {
      rootScaffoldMessengerKey.currentState?.showSnackBar(
        SnackBar(content: Text(ref.t('calls.createNote.error'))),
      );
      return null;
    }
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
    // Mirrors RN's `canOfferAnySessionType` (`CallLogScreen.tsx`) exactly:
    // tapping "Start Session" only ever starts Scribe's microphone
    // recording (`handleVoiceRecording`) — a cloud-telephony conference call
    // is never user-initiated (it's the counsellor's real phone ringing),
    // so `startCloudTelephonyChat` was never part of RN's own gate here.
    // (RN's own `hasMicrophoneChatType`/tenant `enabledChatTypes` gate is a
    // separate, not-yet-ported backlog item — see
    // flutter-whole-app-status-2026-10-26.md item 6 — so this is permission
    // only for now, same as before.)
    final canStartCall = permissions.contains(UserPermissions.startMicrophoneChat);
    // Manual scribe notes: counsellor permission + the per-tenant toggle —
    // mirrors RN's `canCreateNote` (`useScribeNoteCreationEnabled`), which
    // skips the settings request entirely for a non-counsellor rather than
    // firing one the backend would reject; watching the provider only in
    // that branch reproduces the same skip here.
    final isCounselor = permissions.contains(UserPermissions.counselorAccess);
    final canCreateNote = isCounselor && (ref.watch(scribeNoteCreationEnabledProvider).value ?? false);
    final canOfferAnySessionType = canStartCall || canCreateNote;

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
                title: _isViewingArchive
                    ? ref.t('calls.menu.archives')
                    : ref.t('calls.header.title'),
                subtitle: _isViewingArchive ? null : ref.t('calls.header.subtitle'),
                italicSubtitle: true,
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
                            provider: archivedCallLogsControllerProvider,
                            canViewDetails: hasChatDetails,
                            canArchive: false,
                          )
                        : _activeTab == _LogTab.real
                            ? _RealLogsList(
                                provider: realCallLogsControllerProvider,
                                canViewDetails: hasChatDetails,
                                canArchive: hasArchive,
                              )
                            : _SimulationLogsList(canViewDetails: hasScenarioDetails),
              ),
            ],
          ),
          if (canOfferAnySessionType)
            Positioned(
              right: 20,
              bottom: 30,
              child: _StartSessionFab(
                onPressed: () => _showStartSessionModal(
                  canStartCall: canStartCall,
                  canCreateNote: canCreateNote,
                ),
              ),
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

/// Infinite-scroll + pull-to-refresh mechanics shared by [_RealLogsList] and
/// [_SimulationLogsList] — mirrors ally-mobile (React Native)'s `FlatList`
/// `onEndReached`/`onEndReachedThreshold={0.5}` (approximated here as "within
/// 200 logical pixels of the bottom", the same threshold
/// `leaderboard_screen.dart`'s own port of the same RN pattern uses) plus its
/// `ListFooterComponent` spinner while a next page is loading.
class _InfiniteScrollListView<T> extends StatefulWidget {
  const _InfiniteScrollListView({
    required this.page,
    required this.onLoadMore,
    required this.onRefresh,
    required this.itemBuilder,
  });

  final PaginatedLogs<T> page;
  final VoidCallback onLoadMore;
  final Future<void> Function() onRefresh;
  final Widget Function(BuildContext context, T item) itemBuilder;

  @override
  State<_InfiniteScrollListView<T>> createState() => _InfiniteScrollListViewState<T>();
}

class _InfiniteScrollListViewState<T> extends State<_InfiniteScrollListView<T>> {
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
    if (_scrollController.position.pixels >= _scrollController.position.maxScrollExtent - 200) {
      widget.onLoadMore();
    }
  }

  @override
  Widget build(BuildContext context) {
    final items = widget.page.items;
    return RefreshIndicator(
      onRefresh: widget.onRefresh,
      child: ListView.separated(
        controller: _scrollController,
        itemCount: items.length + (widget.page.isLoadingMore ? 1 : 0),
        separatorBuilder: (_, _) => const Divider(height: 1),
        itemBuilder: (context, index) {
          if (index >= items.length) {
            return const Padding(
              padding: EdgeInsets.symmetric(vertical: 16),
              child: Center(child: CircularProgressIndicator()),
            );
          }
          return widget.itemBuilder(context, items[index]);
        },
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

  final AsyncNotifierProvider<PaginatedCallLogsController, PaginatedLogs<CallLogItem>> provider;
  final bool canViewDetails;
  final bool canArchive;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final pageAsync = ref.watch(provider);

    return pageAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, _) => Center(child: Text('${ref.t('common.somethingWentWrong')} $error')),
      data: (page) {
        if (page.items.isEmpty) {
          return Center(child: Text(ref.t('calls.fallback.callEmptyTitle')));
        }
        return _InfiniteScrollListView<CallLogItem>(
          page: page,
          onLoadMore: () => ref.read(provider.notifier).loadMore(),
          onRefresh: () => ref.refresh(provider.future),
          itemBuilder: (context, log) {
            final row = CallLogRow(
              title: log.sessionName ?? ref.t('calls.sessionNumber', {'id': log.id}),
              status: chatSummaryStatusFromString(log.status),
              dateLine: _formatDateTimeLine(log.startedAt),
              durationText: _durationText(ref, log.startedAt, log.endedAt),
              scoreText: log.score != null
                  ? '${ref.t('calls.table.sessionScore')}: ${log.score!.round()}'
                  : null,
              tags: log.tags,
              enabled: canViewDetails,
              onTap: () => context.push('/call-log/${log.id}', extra: log),
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
              // own 3-dot menu (now also ported there, but this swipe
              // predates and is independent of it — the backend's archive
              // call has no problem running twice). A bare swipe reaching
              // the dismiss threshold used to archive immediately and
              // irreversibly with no confirmation — a real accidental-
              // data-loss risk (a stray diagonal scroll touch silently
              // archives a call log). Reusing the same confirmation copy
              // keeps this swipe entry point working without the silent
              // part.
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
    final pageAsync = ref.watch(simulationLogsControllerProvider);

    return pageAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, _) => Center(child: Text('${ref.t('common.somethingWentWrong')} $error')),
      data: (page) {
        if (page.items.isEmpty) {
          return Center(child: Text(ref.t('calls.fallback.simEmptyTitle')));
        }
        return _InfiniteScrollListView<SimulationLogItem>(
          page: page,
          onLoadMore: () => ref.read(simulationLogsControllerProvider.notifier).loadMore(),
          onRefresh: () => ref.refresh(simulationLogsControllerProvider.future),
          itemBuilder: (context, log) {
            // RN's `logTitle` fallback chain (summaryName/sessionName/chatId)
            // never resolves for a simulation row — none of those fields
            // exist on a scenario session — so the title row always falls
            // through to the bare `ID-{id}` label; the scenario's own title
            // shows in the *subtitle* line instead (`{title} • {date}`),
            // confirmed directly from `CallLogItem.tsx`.
            return CallLogRow(
              title: ref.t('calls.sessionNumber', {'id': log.id}),
              status: chatSummaryStatusFromString(log.status),
              dateLine: '${log.scenarioTitle ?? ''} • ${_formatDate(log.startedAt)}',
              durationText: _durationText(ref, log.startedAt, log.endedAt),
              scoreText: log.score != null
                  ? '${ref.t('calls.table.sessionScore')}: ${log.score!.round()}'
                  : null,
              enabled: canViewDetails,
              onTap: () => context.push('/simulations/feedback/${log.id}?fromLogs=true'),
            );
          },
        );
      },
    );
  }
}
