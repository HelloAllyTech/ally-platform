import 'dart:async';

import 'package:flutter/foundation.dart' show listEquals;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/permissions/permissions_repository.dart';
import '../../../core/permissions/user_permissions.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/theme/rn_scale.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/ask_ai_chat/ask_ai_chat.dart';
import '../../../core/widgets/review_type_chip.dart';
import '../../../core/widgets/root_scaffold_messenger.dart';
import '../../account/presentation/profile_settings_screen.dart' show RnCustomSwitch;
import '../../reactions/data/reactions_repository.dart';
import '../../reviews/data/review_models.dart';
import '../../reviews/data/reviews_repository.dart';
import '../data/simulation_models.dart';
import '../data/simulations_repository.dart';
import 'simulation_transcript_tab.dart';
import 'widgets/feedback/debrief_tab.dart';
import 'widgets/feedback/feedback_popup.dart';
import 'widgets/feedback/feedback_widgets.dart';

/// RN `SimulationSummaryTabKey`.
enum FeedbackTab { summary, debrief, transcript }

/// Port of ally-mobile (React Native)'s `SimulationFeedbackScreen.tsx`.
///
/// Header: back arrow, "Simulation *Summary|End*" (Replay Pro, italic
/// subtitle by `fromLogs`) with a Share switch, and the learner's star
/// rating under it. Then, for CHECKLIST roleplays, the evaluation
/// checklist; then the tabs the roleplay turned on (`feedbackTabs`):
/// Debrief (Ally's note + the Ask-AI reply thread, see [DebriefTab]) and
/// Transcript ([SimulationTranscriptTab]); a short session (≤30s) only
/// gets "Session Review". Off the Debrief tab a floating review button
/// (when the review has something to see — RN `useHideReviewDetails`,
/// threads or reactions) and "Try another simulation" float at the bottom.
///
/// The session is polled every 3.5s (up to 7 retries) until Ally's
/// feedback lands, and again whenever the learner comes back from sharing.
/// A fresh session (not from Logs) without a rating opens the rating
/// popup straight away, and asks again on leaving.
class SimulationFeedbackScreen extends ConsumerStatefulWidget {
  const SimulationFeedbackScreen({
    super.key,
    required this.scenarioSessionId,
    this.fromLogs = false,
    this.pathId,
    this.caseId,
    this.languageId,
  });

  final String scenarioSessionId;

  /// RN `route.params.fromLogs`: reached from a historical Call Logs row,
  /// so the debrief is read-only and leaving never forces a rating.
  final bool fromLogs;

  /// RN `route.params.pathId` / `caseId`: the session belongs to a path or
  /// case, so back returns to its details and "Try another" is hidden.
  final String? pathId;
  final String? caseId;

  /// RN `route.params.languageId` (carried; the screen itself doesn't read it).
  final int? languageId;

  @override
  ConsumerState<SimulationFeedbackScreen> createState() => _SimulationFeedbackScreenState();
}

enum _PopupSource { auto, leave, manual }

class _SimulationFeedbackScreenState extends ConsumerState<SimulationFeedbackScreen>
    with TickerProviderStateMixin {
  static const _maxRetryAttempts = 7;
  static const _retryDelay = Duration(milliseconds: 3500);

  SimulationSummary? _summary;
  bool _retryLimitReached = false;
  int _retryGeneration = 0;
  Timer? _retryTimer;

  ReviewItem? _review;
  String? _reviewFetchedFor;

  FeedbackTab _activeTab = FeedbackTab.debrief;
  List<FeedbackTab> _tabs = const [];
  TabController? _tabController;

  bool _popupVisible = false;
  _PopupSource _popupSource = _PopupSource.auto;
  bool _feedbackSubmitted = false;
  bool _handledFeedbackInit = false;
  FeedbackValue _existingFeedback = (rating: 0, tags: const <String>[], comment: '');

  TranscriptFocusRequest? _momentRequest;
  int _momentRequestCount = 0;

  /// RN `useHideReviewDetails`'s `hideReviewDetails` (starts `true`).
  bool _hideReviewDetails = true;
  String? _hideReviewDetailsCheckedFor;

  late final AskAiChatController _chat = AskAiChatController.lazy(
    api: () => ref.read(askAiChatApiProvider),
    // Read-only (from Logs): no thread — it's keyed by session, so an admin
    // would otherwise be typing into the learner's own conversation.
    sessionId: widget.fromLogs ? '' : widget.scenarioSessionId,
  );

  @override
  void initState() {
    super.initState();
    _restartPolling();
  }

  @override
  void dispose() {
    _retryGeneration++;
    _retryTimer?.cancel();
    _tabController?.dispose();
    _chat.dispose();
    super.dispose();
  }

  // ── Polling (RN fetchSimulationDetailsWithRetry) ─────────────────────

  void _restartPolling() {
    _retryGeneration++;
    _retryTimer?.cancel();
    if (_retryLimitReached) setState(() => _retryLimitReached = false);
    _fetchWithRetry(0, _retryGeneration);
  }

  Future<void> _fetchWithRetry(int retryCount, int generation) async {
    if (generation != _retryGeneration || !mounted) return;

    void scheduleRetry() {
      if (generation != _retryGeneration || !mounted) return;
      if (retryCount < _maxRetryAttempts) {
        _retryTimer = Timer(_retryDelay, () => _fetchWithRetry(retryCount + 1, generation));
      } else {
        setState(() => _retryLimitReached = true);
      }
    }

    try {
      final summary = await ref.read(simulationsRepositoryProvider).getSimulationDetails(widget.scenarioSessionId);
      if (generation != _retryGeneration || !mounted) return;
      setState(() => _summary = summary);
      _onSummary(summary);
      final tabsOff = (summary.scenario?.hasFeedbackTabs ?? false) && !summary.feedbackEnabled;
      if (tabsOff || summary.hasSummaryFeedback) return;
      scheduleRetry();
    } catch (_) {
      scheduleRetry();
    }
  }

  void _onSummary(SimulationSummary summary) {
    // First load: adopt an existing rating, or auto-open the popup.
    if (!_handledFeedbackInit) {
      _handledFeedbackInit = true;
      if (summary.hasFeedback) {
        _feedbackSubmitted = true;
        final inline = summary.sessionFeedback;
        final rating = inline?.rating ?? summary.feedbackRating;
        setState(() {
          _existingFeedback = (
            rating: rating ?? 0,
            tags: inline?.tags ?? const <String>[],
            comment: inline?.comment ?? '',
          );
        });
      } else if (!widget.fromLogs) {
        _popupSource = _PopupSource.auto;
        setState(() => _popupVisible = true);
      }
    }

    final reviewId = summary.reviewId;
    if (reviewId != null && reviewId != _reviewFetchedFor) {
      _reviewFetchedFor = reviewId;
      _loadReview(reviewId);
    }
    _checkHideReviewDetails(summary);
  }

  /// RN `useGetReviewByIdQuery({reviewId})` — the share switch reads the
  /// review's own status and creation time.
  Future<void> _loadReview(String reviewId) async {
    try {
      final review = await ref.read(reviewsRepositoryProvider).getReview(reviewId);
      if (!mounted) return;
      setState(() => _review = review);
      if (_summary != null) _checkHideReviewDetails(_summary!);
    } catch (_) {
      // RN shows nothing for a failed review fetch.
    }
  }

  bool get _isPrivate => (_review?.reviewStatus ?? _summary?.reviewStatus) == 'HIDDEN';

  /// RN `useHideReviewDetails`: a non-private review's button always shows;
  /// a private one only once it has a thread or a reaction.
  Future<void> _checkHideReviewDetails(SimulationSummary summary) async {
    final reviewId = summary.reviewId;
    if (reviewId == null) return;
    final isPrivate = _isPrivate;
    final key = '$reviewId|$isPrivate';
    if (_hideReviewDetailsCheckedFor == key) return;
    _hideReviewDetailsCheckedFor = key;
    if (!isPrivate) {
      if (mounted) setState(() => _hideReviewDetails = false);
      return;
    }
    try {
      final threads = await ref.read(reviewsRepositoryProvider).getThreads(reviewId, limit: 1);
      if (threads.threads.isNotEmpty) {
        if (mounted) setState(() => _hideReviewDetails = false);
        return;
      }
      final reactions = await ref.read(reactionsRepositoryProvider).getReactionsCount(reviewId);
      if (mounted) setState(() => _hideReviewDetails = reactions.isEmpty);
    } catch (_) {
      // RN only logs; the previous value stays.
    }
  }

  // ── Navigation ───────────────────────────────────────────────────────

  /// RN `handleBack`: a path/case session resets to that path/case's
  /// details; Logs go back; a fresh session returns to Learn.
  void _handleBack() {
    if (!mounted) return;
    final pathId = widget.pathId;
    final caseId = widget.caseId;
    if (pathId != null || caseId != null) {
      // RN `navigation.reset` to the details screen alone; here the shell
      // stays underneath so back from the details lands on Learn, which is
      // where RN's details screen sends a back with nothing to go back to.
      final router = GoRouter.of(context);
      final details = pathId != null ? '/simulation-paths/$pathId' : '/cases/$caseId';
      router.go('/home');
      // `push` builds on the delegate's current stack, which `go` only
      // replaces once the new location is parsed — push on the next frame.
      WidgetsBinding.instance.addPostFrameCallback((_) => router.push(details));
      return;
    }
    if (widget.fromLogs) {
      if (context.canPop()) context.pop();
      return;
    }
    context.go('/home');
  }

  bool get _feedbackEnabled => _summary?.feedbackEnabled ?? true;

  bool get _shouldAskOnLeave =>
      !widget.fromLogs && !_feedbackSubmitted && !(_summary?.hasFeedback ?? false);

  /// RN `handleFeedbackAndNavigate` (back arrow / hardware back).
  void _onBackPressed() {
    if (_popupVisible) {
      if (_popupSource == _PopupSource.leave) {
        _hidePopup();
      } else {
        setState(() => _popupVisible = false);
      }
      return;
    }
    if (_shouldAskOnLeave) {
      _popupSource = _PopupSource.leave;
      setState(() => _popupVisible = true);
      return;
    }
    _handleBack();
  }

  /// RN `hideFeedbackPopup`.
  void _hidePopup() {
    final source = _popupSource;
    setState(() {
      _popupVisible = false;
      if (!_feedbackSubmitted && source != _PopupSource.manual) {
        _existingFeedback = (rating: 0, tags: _existingFeedback.tags, comment: _existingFeedback.comment);
      }
    });
    if (source == _PopupSource.leave) _handleBack();
  }

  Future<void> _submitFeedback(FeedbackValue feedback) async {
    if (feedback.rating == 0) return;
    final source = _popupSource;
    setState(() {
      _popupVisible = false;
      _feedbackSubmitted = true;
      _existingFeedback = feedback;
    });
    try {
      await ref.read(simulationsRepositoryProvider).addSimulationFeedback(
        scenarioSessionId: widget.scenarioSessionId,
        rating: feedback.rating,
        comment: feedback.comment,
        tags: feedback.tags,
      );
      // RN toasts `callFeedback.submit` ("Submit") here — a copy slip for
      // the success message, which `callFeedback.submitted` is.
      rootScaffoldMessengerKey.currentState?.showSnackBar(
        SnackBar(content: Text(ref.tr('callFeedback.submitted'))),
      );
    } catch (_) {
      rootScaffoldMessengerKey.currentState?.showSnackBar(
        SnackBar(content: Text(ref.tr('callFeedback.failSubmitFeedback'))),
      );
    }
    // With feedback off the popup is the only surface, so submitting it
    // leaves the screen (mirrors the dismiss path).
    if (source == _PopupSource.leave || !_feedbackEnabled) _handleBack();
  }

  void _onRatingSelected(int rating) {
    _popupSource = _PopupSource.manual;
    setState(() {
      _existingFeedback = (rating: rating, tags: _existingFeedback.tags, comment: _existingFeedback.comment);
      _popupVisible = true;
    });
  }

  void _openMoment(String messageId) {
    _momentRequestCount++;
    setState(() {
      _momentRequest = (messageId: messageId, requestId: _momentRequestCount);
      _activeTab = FeedbackTab.transcript;
    });
    final index = _tabs.indexOf(FeedbackTab.transcript);
    if (index != -1) _tabController?.animateTo(index);
  }

  Future<void> _shareSimulation() async {
    final summary = _summary;
    final startedAt = summary?.startedAt;
    final endedAt = summary?.endedAt;
    String? duration;
    if (startedAt != null && endedAt != null) {
      final start = DateTime.tryParse(startedAt);
      final end = DateTime.tryParse(endedAt);
      if (start != null && end != null) duration = end.difference(start).inSeconds.toString();
    }
    await context.push(
      '/share-for-review/${widget.scenarioSessionId}',
      extra: (
        reviewId: summary?.reviewId,
        note: _review?.note,
        contextDateTime: summary?.createdAt ?? startedAt,
        contextDuration: duration,
        isScribe: false,
        contextTitle: summary?.scenario?.title,
      ),
    );
    // RN's focus effect: coming back restarts the poll (picks up the new
    // review) — and the review itself is refetched.
    if (!mounted) return;
    _reviewFetchedFor = null;
    _restartPolling();
  }

  /// RN `isMinutesPassed(createdAt, 10)`; a missing date counts as passed.
  static bool _minutesPassed(String? iso, [int minutes = 10]) {
    final date = iso == null ? null : DateTime.tryParse(iso);
    if (date == null) return true;
    return DateTime.now().difference(date).inMinutes >= minutes;
  }

  Future<void> _onShareToggled(bool enabled) async {
    final reviewId = _summary?.reviewId;
    if (enabled && (reviewId == null || (_review != null && !_minutesPassed(_review!.createdAt)))) {
      await _shareSimulation();
      return;
    }
    if (reviewId == null) return;
    // RN `useToggleReviewPrivacy`.
    try {
      await ref.read(reviewsRepositoryProvider).updateReviewStatus(
        reviewId: reviewId,
        status: enabled ? 'IN_REVIEW' : 'HIDDEN',
      );
      rootScaffoldMessengerKey.currentState?.showSnackBar(
        SnackBar(content: Text(ref.tr('simulationPage.privacyUpdated'))),
      );
      await _loadReview(reviewId);
    } catch (_) {
      rootScaffoldMessengerKey.currentState?.showSnackBar(
        SnackBar(content: Text(ref.tr('simulationPage.errorUpdatePrivacy'))),
      );
    }
  }

  // ── Tabs ─────────────────────────────────────────────────────────────

  /// RN `getSimulationSummaryTabs`.
  List<FeedbackTab> _computeTabs() {
    final summary = _summary;
    if (summary?.isShortSession ?? false) return const [FeedbackTab.summary];
    return [
      if (summary?.showDebriefTab ?? true) FeedbackTab.debrief,
      if (summary?.showTranscriptTab ?? true) FeedbackTab.transcript,
    ];
  }

  /// Rebuilds the [TabController] when the set of tabs changes, keeping
  /// the active tab when it's still there (else the first, as RN does).
  void _syncTabs() {
    final tabs = _computeTabs();
    if (listEquals(tabs, _tabs) && _tabController != null) return;
    if (!tabs.contains(_activeTab) && tabs.isNotEmpty) _activeTab = tabs.first;
    final old = _tabController;
    _tabs = tabs;
    if (tabs.isEmpty) {
      _tabController = null;
    } else {
      _tabController = TabController(
        length: tabs.length,
        initialIndex: tabs.indexOf(_activeTab).clamp(0, tabs.length - 1),
        vsync: this,
      )..addListener(_onTabChanged);
    }
    if (old != null) WidgetsBinding.instance.addPostFrameCallback((_) => old.dispose());
  }

  void _onTabChanged() {
    final controller = _tabController;
    if (controller == null || !mounted) return;
    final tab = _tabs[controller.index];
    if (tab != _activeTab) setState(() => _activeTab = tab);
  }

  @override
  Widget build(BuildContext context) {
    _syncTabs();
    final rn = RnSize.of(context);
    final permissions = ref.watch(userPermissionsProvider).value ?? const <String>[];
    final canSeeMessages = permissions.contains(UserPermissions.viewSessionScenarioMessages);
    final canSeeReview = permissions.contains(UserPermissions.viewSimulationReview);
    final summary = _summary;
    final reviewId = summary?.reviewId;
    final shortSession = summary?.isShortSession ?? false;

    final showChecklist = _feedbackEnabled && canSeeMessages && (summary?.isChecklistMode ?? false) && !shortSession;
    final showTabs = _feedbackEnabled && canSeeMessages && _tabController != null;
    final showReviewButton = _feedbackEnabled &&
        reviewId != null &&
        _activeTab != FeedbackTab.debrief &&
        !_hideReviewDetails &&
        canSeeReview;
    final showTryAnother =
        _feedbackEnabled &&
        _activeTab != FeedbackTab.debrief &&
        !widget.fromLogs &&
        widget.pathId == null &&
        widget.caseId == null &&
        summary != null;
    final bottomInset = MediaQuery.paddingOf(context).bottom;

    return PopScope(
      // A path/case session always goes through `_handleBack` (RN reset).
      canPop: !_popupVisible && !_shouldAskOnLeave && widget.pathId == null && widget.caseId == null,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _onBackPressed();
      },
      child: Scaffold(
        backgroundColor: Colors.white,
        body: Stack(
          children: [
            Padding(
              padding: EdgeInsets.only(top: MediaQuery.paddingOf(context).top, bottom: bottomInset),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Padding(
                    padding: EdgeInsets.only(top: rn.vs(8), bottom: rn.vs(8), left: 10, right: 20),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Semantics(
                          button: true,
                          label: MaterialLocalizations.of(context).backButtonTooltip,
                          child: GestureDetector(
                            key: const Key('simulation-feedback-back'),
                            behavior: HitTestBehavior.opaque,
                            onTap: _onBackPressed,
                            child: Padding(
                              padding: EdgeInsets.only(right: 1, top: rn.vs(3)),
                              child: SvgPicture.asset(
                                'assets/icons/leftArrowIcon.svg',
                                colorFilter: const ColorFilter.mode(Colors.black, BlendMode.srcIn),
                              ),
                            ),
                          ),
                        ),
                        Expanded(child: canSeeMessages ? _buildTitle(rn, shortSession) : const SizedBox.shrink()),
                      ],
                    ),
                  ),
                  if (showChecklist)
                    Padding(
                      padding: EdgeInsets.only(left: 10, right: 10, bottom: rn.vs(8)),
                      child: EventChecklist(scenarioSessionId: widget.scenarioSessionId),
                    ),
                  if (showTabs) ...[
                    _buildTabBar(),
                    Expanded(
                      child: TabBarView(
                        controller: _tabController,
                        children: [for (final tab in _tabs) _buildScene(tab)],
                      ),
                    ),
                  ],
                ],
              ),
            ),
            if (showTryAnother)
              Positioned(
                left: 0,
                right: 0,
                bottom: bottomInset + rn.vs(20),
                child: FractionallySizedBox(
                  widthFactor: 0.9,
                  child: AppButton(
                    key: const Key('simulation-feedback-try-another'),
                    label: ref.t('postSim.common.tryAnother'),
                    // RN wires this to `handleSubmit`, which only reopens
                    // the rating popup — kept as the label's intent: pick
                    // another simulation.
                    onPressed: () => context.push('/simulations'),
                  ),
                ),
              ),
            if (showReviewButton)
              Positioned(
                right: 20,
                bottom: bottomInset + rn.vs(20),
                child: _ReviewButton(
                  onTap: () => context.push(
                    '/reviews/$reviewId',
                    extra: ReviewType.simulation,
                  ),
                ),
              ),
            if (_popupVisible)
              Positioned.fill(
                child: FeedbackPopup(
                  title: ref.t('callFeedback.questionText'),
                  placeholder: ref.t('callFeedback.placeholderText'),
                  initialFeedback: _existingFeedback,
                  onClose: _feedbackEnabled ? _hidePopup : _handleBack,
                  onSubmit: _submitFeedback,
                ),
              ),
          ],
        ),
      ),
    );
  }

  /// RN `renderTitle`.
  Widget _buildTitle(RnSize rn, bool shortSession) {
    final reviewId = _summary?.reviewId;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Text.rich(
                key: const Key('simulation-feedback-title'),
                TextSpan(
                  text: '${ref.t('review.tabs.simulation')} ',
                  style: const TextStyle(
                    fontFamily: AppFonts.replayProHeadline,
                    fontSize: 18,
                    height: 24 / 18,
                    color: AppColors.highEmphasis,
                  ),
                  children: [
                    TextSpan(
                      text: widget.fromLogs
                          ? ref.t('callSummary.header.subtitle')
                          : ref.t('simulationPage.endDialog.titleNormal').trimRight(),
                      style: const TextStyle(
                        fontFamily: AppFonts.replayProBoldItalic,
                        fontStyle: FontStyle.italic,
                      ),
                    ),
                  ],
                ),
              ),
            ),
            if (_feedbackEnabled && !shortSession)
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    ref.t('learn.scenario.share'),
                    style: const TextStyle(
                      fontFamily: AppFonts.ibmPlexSerifRegular,
                      fontSize: 12,
                      height: 16 / 12,
                      letterSpacing: 0.2,
                      color: AppColors.lowEmphasis,
                    ),
                  ),
                  const SizedBox(width: 8),
                  RnCustomSwitch(
                    key: const Key('simulation-feedback-share-switch'),
                    value: reviewId != null && !_isPrivate,
                    onToggle: _onShareToggled,
                  ),
                ],
              ),
          ],
        ),
        SizedBox(height: rn.vs(4)),
        SessionRatingTrigger(value: _existingFeedback.rating, onSelect: _onRatingSelected),
      ],
    );
  }

  String _tabTitle(FeedbackTab tab) => switch (tab) {
    FeedbackTab.summary => ref.t('postSim.tabs.sessionReview'),
    FeedbackTab.debrief => ref.t('postSim.tabs.debrief'),
    FeedbackTab.transcript => ref.t('postSim.tabs.transcript'),
  };

  /// RN `renderTabBar`: scrollable, left-aligned, auto-width tabs (10
  /// either side), a 2pt primary indicator, IBM Plex Serif Medium 12/16 at
  /// weight 400, primary when active / low emphasis otherwise, on white
  /// with the tab bar's hairline shadow.
  Widget _buildTabBar() {
    const label = TextStyle(
      fontFamily: AppFonts.ibmPlexSerifMedium,
      fontSize: 12,
      height: 16 / 12,
      letterSpacing: 0.2,
      fontWeight: FontWeight.w400,
    );
    return DecoratedBox(
      decoration: const BoxDecoration(
        color: Colors.white,
        boxShadow: [BoxShadow(color: Color(0x1A000000), offset: Offset(0, 0.5), blurRadius: 0.5)],
      ),
      child: TabBar(
        controller: _tabController,
        isScrollable: true,
        tabAlignment: TabAlignment.start,
        padding: EdgeInsets.zero,
        labelPadding: const EdgeInsets.symmetric(horizontal: 10),
        indicatorColor: AppColors.primary,
        indicatorWeight: 2,
        indicatorSize: TabBarIndicatorSize.tab,
        dividerColor: Colors.transparent,
        labelColor: AppColors.primary,
        unselectedLabelColor: AppColors.lowEmphasis,
        labelStyle: label,
        unselectedLabelStyle: label,
        overlayColor: const WidgetStatePropertyAll(Colors.transparent),
        // Plain `Tab(text: ...)` hard-clips its label with no ellipsis under
        // a larger system font-scale setting, rendering "Debrief" as
        // "Debrie" with no visual indication it's truncated — `FittedBox`
        // shrinks the text to fit instead.
        tabs: [
          for (final tab in _tabs)
            Tab(
              height: 48,
              child: FittedBox(fit: BoxFit.scaleDown, child: Text(_tabTitle(tab))),
            ),
        ],
      ),
    );
  }

  Widget _buildScene(FeedbackTab tab) {
    switch (tab) {
      case FeedbackTab.summary:
        return ShortSessionSummary(summary: _summary, retryLimitReached: _retryLimitReached);
      case FeedbackTab.debrief:
        return DebriefTab(
          chat: _chat,
          summary: _summary,
          retryLimitReached: _retryLimitReached,
          readOnly: widget.fromLogs,
          // Anchors are chips only when there's a transcript to open.
          onOpenMoment: (_summary?.showTranscriptTab ?? true) ? _openMoment : null,
        );
      case FeedbackTab.transcript:
        return SimulationTranscriptTab(
          scenarioSessionId: widget.scenarioSessionId,
          agentName: _summary?.scenario?.clientName,
          focusMessage: _momentRequest,
        );
    }
  }
}

/// RN `reviewIconButton`: a 56pt white circle with a hairline border and a
/// soft shadow, holding the 20pt chat-bubble icon.
class _ReviewButton extends StatelessWidget {
  const _ReviewButton({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      key: const Key('simulation-feedback-view-review'),
      onTap: onTap,
      child: Container(
        width: 56,
        height: 56,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: Colors.white,
          shape: BoxShape.circle,
          border: Border.all(color: AppColors.strokePrimary, width: 0.5),
          boxShadow: [
            BoxShadow(
              color: const Color(0xFFA09E9E).withValues(alpha: 0.1),
              offset: const Offset(8.52, 11.36),
              blurRadius: 14.2,
            ),
          ],
        ),
        child: SvgPicture.asset(
          'assets/icons/chatBubble.svg',
          width: 20,
          height: 20,
          colorFilter: const ColorFilter.mode(Colors.black, BlendMode.srcIn),
        ),
      ),
    );
  }
}
