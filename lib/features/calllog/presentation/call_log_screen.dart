import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';
import 'package:permission_handler/permission_handler.dart';

import '../../../core/chat/current_chat_provider.dart';
import '../../../core/localization/translate_ref.dart';
import '../../../core/navigation/screen_focus_listener.dart';
import '../../../core/permissions/permissions_repository.dart';
import '../../../core/permissions/user_permissions.dart';
import '../../../core/settings/settings_repository.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_empty_state.dart';
import '../../../core/widgets/app_tab_view.dart';
import '../../../core/widgets/illustrated_modal.dart';
import '../../../core/widgets/root_scaffold_messenger.dart';
import '../../../core/widgets/status_badge.dart';
import '../../../core/widgets/tab_screen_header.dart';
import '../data/call_log_repository.dart';
import 'call_log_filter_sheet.dart';
import 'call_log_row.dart';
import '../../../core/localization/cached_date_format.dart';

/// `formatDate`/`formatTime`/`calculateDuration` from ally-mobile (React
/// Native)'s `src/utils/date.ts`, ported exactly: local time, "MMM d" dates,
/// 12-hour clock times, and a plain "X mins Y secs" duration string (only
/// the "Duration:"/"Session points:" labels around it are translated, same
/// as the real component).
String _formatDate(String iso) => cachedDateFormat('MMM d').format(DateTime.parse(iso).toLocal());

String _formatDateTimeLine(String iso) {
  final date = DateTime.parse(iso).toLocal();
  return '${cachedDateFormat('MMM d').format(date)} • ${cachedDateFormat('h:mm a').format(date)}';
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

/// RN prints `item.score` as-is (a falsy 0 hides it): whole numbers without
/// a trailing `.0`.
String _formatScore(double score) =>
    score == score.roundToDouble() ? score.toInt().toString() : score.toString();

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
/// recording is gated on the `START_MICROPHONE_CHAT` permission (RN's
/// `canStartCall`) AND the tenant's `/settings/chat-types` enabled set
/// actually including microphone chat (RN's `hasMicrophoneChatType`) — a
/// tenant that has disabled microphone-chat sessions hides the Start Scribe
/// Mode option even for a permitted counsellor, same as RN.
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
  /// primary button whenever `hasMicrophoneChatType` (the tenant's enabled
  /// chat types include microphone chat — not RN's permission-only
  /// `canStartCall`, which only ever gates whether the FAB appears at all),
  /// and Create Note is offered as a secondary button whenever
  /// `canCreateNote` — RN renders both, either, or (if neither) nothing at
  /// all in the same sheet, never two sheets.
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
  Future<void> _showStartSessionModal({required bool hasMicrophoneChatType, required bool canCreateNote}) async {
    CallLogItem? createdNote;
    await IllustratedModal.show(
      context,
      titleMain: ref.t('calls.dialog.startSession.titleNormal'),
      titleItalic: ref.t('calls.dialog.startSession.titleItalic'),
      description: ref.t('calls.dialog.startSession.footer'),
      actionButtonText: hasMicrophoneChatType ? ref.t('calls.dialog.startSession.startScribeMode') : null,
      actionButtonVariant: AppButtonVariant.primary,
      onActionPressed: hasMicrophoneChatType ? _startScribeSession : null,
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
    // RN's own permission-only gate (`START_CALL_PERMISSIONS`): tapping
    // "Start Session" only ever starts Scribe's microphone recording
    // (`handleVoiceRecording`) — a cloud-telephony conference call is never
    // user-initiated (it's the counsellor's real phone ringing), so
    // `startCloudTelephonyChat` was never part of RN's own gate here either
    // (confirmed: `StartSessionModal.tsx` has no cloud-telephony button at
    // all, only Scribe Mode and Create Note).
    final canStartCall = permissions.contains(UserPermissions.startMicrophoneChat);
    // Manual scribe notes: counsellor permission + the per-tenant toggle —
    // mirrors RN's `canCreateNote` (`useScribeNoteCreationEnabled`), which
    // skips the settings request entirely for a non-counsellor rather than
    // firing one the backend would reject; watching the provider only in
    // that branch reproduces the same skip here.
    final isCounselor = permissions.contains(UserPermissions.counselorAccess);
    final canCreateNote = isCounselor && (ref.watch(scribeNoteCreationEnabledProvider).value ?? false);
    // The tenant's enabled chat types (`hasMicrophoneChatType` in RN) — only
    // watched when the user could start anything at all, mirroring RN's own
    // `useFocusEffect(() => { if (canStartCall) getVisibleChatTypes(); })`
    // guard against firing a pointless request.
    final enabledChatTypes = canStartCall ? ref.watch(visibleChatTypesProvider).value : null;
    final hasMicrophoneChatType = enabledChatTypes?.contains('MICROPHONE_CHAT') ?? false;
    // Mirrors RN's `canOfferAnySessionType` exactly: tenant-setting-gated
    // (not permission-gated) — a tenant that disabled microphone chat
    // entirely must not offer Start Scribe Mode even to a permitted user.
    final canOfferAnySessionType = hasMicrophoneChatType || canCreateNote;
    // RN's `isSessionTypeUnknown`: the settings answer is missing (usually a
    // failed request), which must not present as a disabled control.
    final isSessionTypeUnknown = enabledChatTypes == null;
    // RN hides the FAB while a call is ongoing (`!currentChat?.chatId`).
    final hasCurrentChat = ref.watch(currentChatProvider) != null;
    final showFab = (canStartCall || canCreateNote) && !hasCurrentChat;

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
    final showFilterAction = hasReal && (_isViewingArchive || _activeTab == _LogTab.real);

    // The list the header's refresh button (RN's `handleRefresh`) reloads,
    // and whether it's fetching (RN spins the icon while it is).
    VoidCallback? onRefresh;
    var isFetching = false;
    if (_activeTab != null) {
      if (_isViewingArchive || _activeTab == _LogTab.real) {
        final provider = _isViewingArchive ? archivedCallLogsControllerProvider : realCallLogsControllerProvider;
        isFetching = ref.watch(provider).isLoading;
        onRefresh = () => ref.invalidate(provider);
      } else {
        isFetching = ref.watch(simulationLogsControllerProvider).isLoading;
        onRefresh = () => ref.invalidate(simulationLogsControllerProvider);
      }
    }

    // RN `useFocusEffect`s: coming back to Call Logs reloads every log
    // list from page 0 and (for call starters) re-asks the chat types.
    return ScreenFocusListener(
      onFocus: () {
        ref.invalidate(realCallLogsControllerProvider);
        ref.invalidate(archivedCallLogsControllerProvider);
        ref.invalidate(simulationLogsControllerProvider);
        if (canStartCall) ref.invalidate(visibleChatTypesProvider);
      },
      child: Scaffold(
        backgroundColor: Colors.white,
        body: Stack(
          children: [
            Column(
              children: [
                // RN `CallLogHeader`: filter, refresh and (when allowed) the
                // archive actions menu, `gap: 12`, all 16pt icons.
                TabScreenHeader(
                  title: _isViewingArchive
                      ? ref.t('calls.menu.archives')
                      : ref.t('calls.header.title'),
                  subtitle: _isViewingArchive ? null : ref.t('calls.header.subtitle'),
                  italicSubtitle: true,
                  leading: _isViewingArchive
                      ? GestureDetector(
                          key: const Key('call-log-archive-back'),
                          behavior: HitTestBehavior.opaque,
                          onTap: () => setState(() => _isViewingArchive = false),
                          child: Padding(
                            padding: const EdgeInsets.symmetric(vertical: 12),
                            child: SvgPicture.asset(
                              'assets/icons/leftArrow.svg',
                              width: 14,
                              height: 14,
                              colorFilter: const ColorFilter.mode(AppColors.iconDefault, BlendMode.srcIn),
                            ),
                          ),
                        )
                      : null,
                  trailing: onRefresh == null
                      ? null
                      : Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            if (showFilterAction) ...[
                              _FilterButton(hasTagsPermission: hasTags),
                              const SizedBox(width: 12),
                            ],
                            _RefreshButton(
                              isFetching: isFetching,
                              onRefresh: onRefresh,
                            ),
                            if (showArchiveAction) ...[
                              const SizedBox(width: 12),
                              _ActionsMenu(
                                label: ref.t('callSummary.header.actionsMenu.archive'),
                                onArchivePress: () => setState(() => _isViewingArchive = true),
                              ),
                            ],
                          ],
                        ),
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
                            )
                          : _activeTab == _LogTab.real
                              ? _RealLogsList(
                                  provider: realCallLogsControllerProvider,
                                  canViewDetails: hasChatDetails,
                                )
                              : _SimulationLogsList(canViewDetails: hasScenarioDetails),
                ),
              ],
            ),
            if (showFab)
              Positioned(
                right: 20,
                bottom: MediaQuery.paddingOf(context).bottom + 100,
                child: _StartSessionFab(
                  // Only inert when we actually KNOW there is nothing to offer;
                  // while the chat-types answer is missing the press re-asks.
                  enabled: canOfferAnySessionType || isSessionTypeUnknown,
                  hasOptions: canOfferAnySessionType,
                  onPressed: () {
                    if (isSessionTypeUnknown) {
                      if (canStartCall) ref.invalidate(visibleChatTypesProvider);
                      if (!canOfferAnySessionType) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(content: Text(ref.t('common.somethingWentWrong'))),
                        );
                        return;
                      }
                    }
                    _showStartSessionModal(
                      hasMicrophoneChatType: hasMicrophoneChatType,
                      canCreateNote: canCreateNote,
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

/// RN `CallLogHeader`'s filter button: a 16pt `FilterIcon` with a blue
/// count badge (`styles.filterBadge`) when filters are applied.
class _FilterButton extends ConsumerWidget {
  const _FilterButton({required this.hasTagsPermission});

  final bool hasTagsPermission;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final activeCount = ref.watch(callLogFilterProvider).activeCount;
    return Semantics(
      button: true,
      label: 'Filter',
      child: GestureDetector(
        key: const Key('call-log-filter'),
        behavior: HitTestBehavior.opaque,
        onTap: () => CallLogFilterSheet.show(context, hasTagsPermission: hasTagsPermission),
        child: SizedBox(
          width: 16,
          height: 16,
          child: Stack(
            clipBehavior: Clip.none,
            alignment: Alignment.center,
            children: [
              SvgPicture.asset('assets/icons/filter.svg', width: 16, height: 16),
              if (activeCount > 0)
                Positioned(
                  top: -6,
                  right: -8,
                  child: Container(
                    constraints: const BoxConstraints(minWidth: 14),
                    height: 14,
                    padding: const EdgeInsets.symmetric(horizontal: 3),
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: AppColors.primary,
                      borderRadius: BorderRadius.circular(7),
                    ),
                    // typography.body.nano + ROBOTO.REGULAR, white.
                    child: Text(
                      '$activeCount',
                      style: const TextStyle(
                        fontFamily: AppFonts.robotoRegular,
                        fontSize: 8,
                        height: 10 / 8,
                        letterSpacing: 0.08,
                        color: Colors.white,
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// RN `CallLogHeader`'s refresh button: a 16pt `ReplayIcon` that spins one
/// full turn over 600ms when a fetch starts.
class _RefreshButton extends StatefulWidget {
  const _RefreshButton({required this.isFetching, required this.onRefresh});

  final bool isFetching;
  final VoidCallback onRefresh;

  @override
  State<_RefreshButton> createState() => _RefreshButtonState();
}

class _RefreshButtonState extends State<_RefreshButton> with SingleTickerProviderStateMixin {
  late final _controller = AnimationController(vsync: this, duration: const Duration(milliseconds: 600));

  @override
  void didUpdateWidget(covariant _RefreshButton oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.isFetching && !oldWidget.isFetching) _controller.forward(from: 0);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: 'Refresh',
      child: GestureDetector(
        key: const Key('call-log-refresh'),
        behavior: HitTestBehavior.opaque,
        onTap: widget.onRefresh,
        child: RotationTransition(
          turns: _controller,
          child: SvgPicture.asset('assets/icons/replay.svg', width: 16, height: 16),
        ),
      ),
    );
  }
}

/// RN's shared `ActionsMenu` as `CallLogHeader` uses it: a 16pt
/// `ThreeDotsIcon` opening a white, 8pt-radius, 160pt-min-wide menu whose
/// one option is the archive icon + "Archives".
class _ActionsMenu extends StatelessWidget {
  const _ActionsMenu({required this.label, required this.onArchivePress});

  final String label;
  final VoidCallback onArchivePress;

  @override
  Widget build(BuildContext context) {
    return PopupMenuButton<void>(
      key: const Key('call-log-actions-menu'),
      padding: EdgeInsets.zero,
      tooltip: '',
      color: Colors.white,
      elevation: 6,
      shadowColor: const Color(0xFF6C6C6C),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      constraints: const BoxConstraints(minWidth: 160),
      menuPadding: const EdgeInsets.symmetric(vertical: 8),
      position: PopupMenuPosition.under,
      offset: const Offset(0, 4),
      itemBuilder: (context) => [
        PopupMenuItem<void>(
          height: 0,
          padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 16),
          onTap: onArchivePress,
          child: Row(
            children: [
              SvgPicture.asset('assets/icons/archive.svg', width: 16, height: 16),
              const SizedBox(width: 8),
              // IBM_PLEX_SERIF.REGULAR + typography.body.small, medium weight.
              Text(
                label,
                style: const TextStyle(
                  fontFamily: AppFonts.ibmPlexSerifRegular,
                  fontSize: 12,
                  height: 16 / 12,
                  letterSpacing: 0.2,
                  fontWeight: FontWeight.w500,
                  color: Colors.black,
                ),
              ),
            ],
          ),
        ),
      ],
      child: SvgPicture.asset('assets/icons/threeDots.svg', width: 16, height: 16),
    );
  }
}

/// RN's start-session FAB: `padding: 20` around the 24pt white
/// `TranscribeIcon`, `borderRadius: '30%'`, azure blue (ash grey when there
/// is nothing to offer), with a soft drop shadow.
class _StartSessionFab extends StatelessWidget {
  const _StartSessionFab({required this.onPressed, required this.enabled, required this.hasOptions});

  final VoidCallback onPressed;
  final bool enabled;
  final bool hasOptions;

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(64 * 0.3);
    return GestureDetector(
      key: const Key('start-session-fab'),
      behavior: HitTestBehavior.opaque,
      onTap: enabled ? onPressed : null,
      child: Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: hasOptions ? AppColors.primary : AppColors.ashGray,
          borderRadius: radius,
          boxShadow: const [
            BoxShadow(color: Color(0x33000000), offset: Offset(0, 4), blurRadius: 8),
          ],
        ),
        child: SvgPicture.asset('assets/icons/transcribe.svg', width: 24, height: 24),
      ),
    );
  }
}

/// Static port of RN's `CallLogSkeleton` (the first-page loading state):
/// the same row frame as [CallLogRow] with grey placeholder blocks.
class _CallLogSkeleton extends StatelessWidget {
  const _CallLogSkeleton();

  static const count = 10;

  static Widget _block(double width, double height, {double radius = 4, Color color = AppColors.lightGray8}) =>
      Container(
        width: width,
        height: height,
        decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(radius)),
      );

  @override
  Widget build(BuildContext context) {
    return ListView.builder(
      key: const Key('call-log-skeleton'),
      physics: const NeverScrollableScrollPhysics(),
      itemCount: count,
      itemBuilder: (context, _) => Container(
        margin: const EdgeInsets.symmetric(horizontal: 14),
        padding: const EdgeInsets.all(10),
        decoration: const BoxDecoration(
          border: Border(bottom: BorderSide(color: AppColors.lightGray2)),
        ),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(8, 6, 18, 10),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    width: 24,
                    height: 24,
                    margin: const EdgeInsets.only(right: 4),
                    alignment: Alignment.center,
                    child: _block(16, 16, radius: 2),
                  ),
                  Expanded(
                    child: LayoutBuilder(
                      builder: (context, constraints) => Row(
                        children: [
                          _block(constraints.maxWidth * 0.6, 14),
                          const Spacer(),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                            decoration: BoxDecoration(
                              color: AppColors.lightGray8,
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: Row(
                              children: [
                                _block(4, 4, radius: 2, color: AppColors.lightGray6),
                                const SizedBox(width: 4),
                                _block(30, 8, radius: 2, color: AppColors.lightGray6),
                              ],
                            ),
                          ),
                          const SizedBox(width: 10),
                          _block(16, 16, radius: 2),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
              Padding(
                padding: const EdgeInsets.only(left: 30, top: 4),
                child: _block(120, 12),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// RN's `EmptyState` with `NoCallLogsIcon`, centred in the remaining space.
/// RN also lands here when the fetch fails (`result.data` is undefined, so
/// the list is reset to `[]`).
class _CallLogEmptyState extends ConsumerWidget {
  const _CallLogEmptyState({required this.isSimulation});

  final bool isSimulation;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Center(
      child: SingleChildScrollView(
        child: AppEmptyState(
          iconAsset: 'assets/icons/noCallRecords.svg',
          title: ref.t(isSimulation ? 'calls.fallback.simEmptyTitle' : 'calls.fallback.callEmptyTitle'),
          description: ref.t('audioCall.fallback.noActiveCallDesc'),
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
      // RN's rows draw their own bottom border (no separators), and the
      // list reserves `paddingBottom: 100` to clear the floating tab bar.
      child: ListView.builder(
        controller: _scrollController,
        padding: const EdgeInsets.only(bottom: 100),
        itemCount: items.length + (widget.page.isLoadingMore ? 1 : 0),
        itemBuilder: (context, index) {
          if (index >= items.length) {
            // RN's footer: a small darkSlate ActivityIndicator.
            return const Padding(
              padding: EdgeInsets.symmetric(vertical: 16),
              child: Center(
                child: SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFF292929)),
                ),
              ),
            );
          }
          return widget.itemBuilder(context, items[index]);
        },
      ),
    );
  }
}

class _RealLogsList extends ConsumerWidget {
  const _RealLogsList({required this.provider, required this.canViewDetails});

  final AsyncNotifierProvider<PaginatedCallLogsController, PaginatedLogs<CallLogItem>> provider;
  final bool canViewDetails;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final pageAsync = ref.watch(provider);

    return pageAsync.when(
      loading: () => const _CallLogSkeleton(),
      error: (_, _) => const _CallLogEmptyState(isSimulation: false),
      data: (page) {
        if (page.items.isEmpty) return const _CallLogEmptyState(isSimulation: false);
        return _InfiniteScrollListView<CallLogItem>(
          page: page,
          onLoadMore: () => ref.read(provider.notifier).loadMore(),
          onRefresh: () => ref.refresh(provider.future),
          itemBuilder: (context, log) {
            final isUpload = log.provider == 'AUDIO_UPLOAD';
            // RN has no swipe-to-archive on this list; archiving lives in
            // CallSummaryScreen's own menu.
            return CallLogRow(
              key: ValueKey(log.id),
              title: log.logTitle,
              status: chatSummaryStatusFromString(log.displayStatus),
              noAudioLabel: ref.t('calls.status.noAudio'),
              dateLine: _formatDateTimeLine(log.startedAt),
              durationText: _durationText(ref, log.startedAt, log.endedAt),
              scoreText: log.score != null && log.score != 0
                  ? '${ref.t('calls.table.sessionScore')}: ${_formatScore(log.score!)}'
                  : null,
              modeText: (log.mode?.isNotEmpty ?? false)
                  ? '${ref.t('calls.table.mode')}: ${ref.t(log.mode!.toUpperCase() == 'DICTATION' ? 'calls.mode.dictation' : 'calls.mode.scribe')}'
                  : null,
              sourceLabel: log.provider == null
                  ? null
                  : ref.t(isUpload ? 'calls.source.uploaded' : 'calls.source.liveSession'),
              sourceColor: isUpload ? AppColors.primary : AppColors.deepPurple500,
              tags: log.tags,
              enabled: canViewDetails,
              onTap: () => context.push('/call-log/${log.id}', extra: log),
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
      loading: () => const _CallLogSkeleton(),
      error: (_, _) => const _CallLogEmptyState(isSimulation: true),
      data: (page) {
        if (page.items.isEmpty) return const _CallLogEmptyState(isSimulation: true);
        return _InfiniteScrollListView<SimulationLogItem>(
          page: page,
          onLoadMore: () => ref.read(simulationLogsControllerProvider.notifier).loadMore(),
          onRefresh: () => ref.refresh(simulationLogsControllerProvider.future),
          itemBuilder: (context, log) {
            // RN's `logTitle` fallback chain for a scenario session can only
            // resolve `metadata.sessionName`, else the bare `ID-{id}`; the
            // scenario's own title shows in the *subtitle* line instead
            // (`{title} • {date}`), confirmed directly from `CallLogItem.tsx`.
            return CallLogRow(
              title: log.logTitle,
              isSimulation: true,
              status: chatSummaryStatusFromString(log.status),
              dateLine: '${log.scenarioTitle ?? ''} • ${_formatDate(log.startedAt)}',
              durationText: _durationText(ref, log.startedAt, log.endedAt),
              scoreText: log.score != null && log.score != 0
                  ? '${ref.t('calls.table.sessionScore')}: ${_formatScore(log.score!)}'
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
