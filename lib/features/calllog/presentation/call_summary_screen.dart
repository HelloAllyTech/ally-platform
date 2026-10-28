import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/localization/localization_controller.dart';
import '../../../core/localization/translate_ref.dart';
import '../../../core/permissions/permissions_repository.dart';
import '../../../core/permissions/user_permissions.dart';
import '../../../core/settings/settings_repository.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/confirmation_modal.dart';
import '../../../core/widgets/review_type_chip.dart';
import '../../account/data/account_repository.dart';
import '../../reactions/data/reactions_repository.dart';
import '../../reviews/data/scribe_reviews_repository.dart';
import '../data/call_log_repository.dart';
import '../data/call_summary_fields.dart';
import '../data/custom_fields_repository.dart';
import '../data/summary_display_format.dart';
import '../data/summary_form_state.dart';
import '../../../core/chat/current_chat_provider.dart';
import '../../../core/navigation/home_tab_navigation.dart';
import '../../../core/navigation/tab_config.dart';
import '../../reviews/presentation/review_formatting.dart';
import '../../simulations/presentation/widgets/feedback/feedback_popup.dart';
import 'call_summary_actions.dart';
import 'call_summary_menu.dart';
import 'call_transcript_tab.dart';
import 'searchable_location_dropdown.dart';
import 'summary_generation_progress.dart';
import 'voice_note_section.dart';

/// Mirrors ally-mobile (React Native)'s `PRIVACY_POLICY_URL`.
const _privacyPolicyUrl = 'https://app.helloally.ai/privacy';

/// Mirrors ally-mobile (React Native)'s `isMinutesPassed` — same private
/// helper this codebase already duplicates per-file rather than factoring
/// out (see `review_details_screen.dart`'s own copy).
bool _isMinutesPassed(String dateString, {int minutes = 10}) {
  if (dateString.trim().isEmpty) return true;
  final diff = DateTime.now().toUtc().difference(
    DateTime.parse(dateString).toUtc(),
  );
  return diff.inSeconds / 60 >= minutes;
}

/// Maps each [SummarySection] to its real translation key, taken from
/// ally-mobile (React Native)'s `src/constants/summary.ts` `SECTION_LIST`
/// (`labelKey` property) — the authoritative key for every section title in
/// this form.
const _sectionLabelKeys = <SummarySection, String>{
  SummarySection.featuresAndDemographics:
      'summary.sections.featuresAndDemographics',
  SummarySection.sessionSummary: 'summary.sections.sessionSummary',
  SummarySection.flow: 'summary.sections.flow',
  SummarySection.keyConcern: 'summary.sections.keyConcerns',
  SummarySection.objectiveObservations:
      'summary.sections.objectiveObservations',
  SummarySection.subjectiveObservations:
      'summary.sections.subjectiveObservations',
  SummarySection.assessment: 'summary.sections.assessment',
  SummarySection.dominantFeelings: 'summary.sections.dominantFeelings',
  SummarySection.issuesWorkedOn: 'summary.sections.issuesWorkedOn',
  SummarySection.keyTherapeuticTechniques:
      'summary.sections.keyTherapeuticTechniques',
  SummarySection.referralsProvided: 'summary.sections.referralsProvided',
  SummarySection.homeworkRecommended: 'summary.sections.homeworkRecommended',
  SummarySection.planForNextCall: 'summary.sections.plansForNextCall',
  SummarySection.tags: 'summary.sections.tags',
  SummarySection.metrics: 'summary.sections.metrics',
  SummarySection.intake: 'summary.sections.intake',
  SummarySection.ongoingRisks: 'summary.sections.ongoingRisks',
  SummarySection.additionalNotes: 'summary.sections.additionalNotes',
};

/// Closest-matching Material icon per section, standing in for RN's
/// `SECTION_LIST`'s custom per-section SVGs (`CallDetailsIcon`,
/// `SessionSummaryIcon`, `FlowIcon`, ... — `src/constants/summary.ts`).
const _sectionIcons = <SummarySection, IconData>{
  SummarySection.featuresAndDemographics: Icons.call_outlined,
  SummarySection.sessionSummary: Icons.auto_awesome_outlined,
  SummarySection.flow: Icons.waves,
  SummarySection.keyConcern: Icons.sentiment_dissatisfied_outlined,
  SummarySection.objectiveObservations: Icons.visibility_outlined,
  SummarySection.subjectiveObservations: Icons.search,
  SummarySection.assessment: Icons.assignment_outlined,
  SummarySection.dominantFeelings: Icons.sentiment_satisfied_outlined,
  SummarySection.issuesWorkedOn: Icons.warning_amber_outlined,
  SummarySection.keyTherapeuticTechniques: Icons.healing_outlined,
  SummarySection.referralsProvided: Icons.volunteer_activism_outlined,
  SummarySection.homeworkRecommended: Icons.library_books_outlined,
  SummarySection.planForNextCall: Icons.headset_mic_outlined,
  SummarySection.tags: Icons.label_outline,
  SummarySection.metrics: Icons.storage_outlined,
  SummarySection.intake: Icons.assignment_ind_outlined,
  SummarySection.ongoingRisks: Icons.report_problem_outlined,
  SummarySection.additionalNotes: Icons.note_add_outlined,
};

/// Maps each [SummaryFieldDef.key] to its real translation key, taken from
/// ally-mobile (React Native)'s `src/constants/summary.ts` `FIELD_LABEL_KEYS`
/// map — the authoritative key for every field label in this form. The
/// field keys themselves (`callId`, `clientId`, `homework`, ...) are ported
/// 1:1 from `SUMMARY_FIELDS` there, so this map's left-hand side lines up
/// exactly with `call_summary_fields.dart`'s `SummaryFieldDef.key` values.
const _fieldLabelKeys = <String, String>{
  'callId': 'summary.fields.callId',
  'callDuration': 'summary.fields.callDuration',
  'callDate': 'summary.fields.callDate',
  'callTime': 'summary.fields.callTime',
  'clientId': 'summary.fields.callerId',
  'callType': 'summary.fields.callerType',
  'mode': 'summary.fields.mode',
  'age': 'summary.fields.age',
  'gender': 'summary.fields.gender',
  'profession': 'summary.fields.profession',
  'relationshipStatus': 'summary.fields.relationshipStatus',
  'languages': 'summary.fields.languages',
  'location': 'summary.fields.location',
  'codeOfConcern': 'summary.fields.concernCode',
  'counsellor': 'summary.fields.counsellor',
  'newCallFollowUp': 'summary.fields.newCallFollowUp',
  'sessionSummary': 'summary.fields.sessionSummary',
  'counselingProcessFlow': 'summary.fields.flow',
  'keyConcerns': 'summary.fields.keyConcerns',
  'objectiveObservations': 'summary.fields.objectiveObservations',
  'subjectiveObservations': 'summary.fields.subjectiveObservations',
  'assessment': 'summary.fields.assessment',
  'dominantFeelings': 'summary.fields.dominantFeelings',
  'issuesWorkedOn': 'summary.fields.issuesWorkedOn',
  'keyTherapeuticTechniques': 'summary.fields.keyTherapeuticTechniques',
  'referralsProvided': 'summary.fields.referralsProvided',
  'homework': 'summary.fields.homeworkRecommended',
  'planForNextCall': 'summary.fields.plansForNextCall',
  'tags': 'summary.fields.tags',
  'listeningShare': 'summary.fields.listeningRatio',
  'reflectiveQuestionsAsked': 'summary.fields.reflectiveQuestions',
  'emotionalLift': 'summary.fields.emotionsLift',
  'openEndedQuestionsAsked': 'summary.fields.openEndedQuestions',
  'intakeNotes': 'summary.fields.intakeNotes',
  'riskSelfHarm': 'summary.fields.riskSelfHarm',
  'riskSelfHarmNotes': 'summary.fields.riskSelfHarmNotes',
  'riskSuicidalThoughts': 'summary.fields.riskSuicidalThoughts',
  'riskSuicidalThoughtsNotes': 'summary.fields.riskSuicidalThoughtsNotes',
  'riskSuicidalPlan': 'summary.fields.riskSuicidalPlan',
  'riskSuicidalAction': 'summary.fields.riskSuicidalAction',
  'riskRunningAway': 'summary.fields.riskRunningAway',
  'riskRunningAwayNotes': 'summary.fields.riskRunningAwayNotes',
  'traumaPhysicalAbuse': 'summary.fields.traumaPhysicalAbuse',
  'traumaSexualAbuse': 'summary.fields.traumaSexualAbuse',
  'traumaVerbalAbuse': 'summary.fields.traumaVerbalAbuse',
  'traumaNeglect': 'summary.fields.traumaNeglect',
  'traumaSeparationFromCaregiverParent': 'summary.fields.traumaSeparation',
  'traumaWitnessedDomesticViolence': 'summary.fields.traumaDomesticViolence',
  'traumaNotes': 'summary.fields.traumaNotes',
  'assessmentPsychologicalDiagnosis': 'summary.fields.assessmentPsychDiagnosis',
  'assessmentPsychologicalDiagnosisNotes':
      'summary.fields.assessmentPsychDiagnosisNotes',
  'assessmentUseOfPsychotropicMedications':
      'summary.fields.assessmentPsychotropicMeds',
  'assessmentUseOfPsychotropicMedicationsNotes':
      'summary.fields.assessmentPsychotropicMedsNotes',
  'assessmentHallucinations': 'summary.fields.assessmentHallucinations',
  'assessmentHallucinationsNotes':
      'summary.fields.assessmentHallucinationsNotes',
  'assessmentAffect': 'summary.fields.assessmentAffect',
  'assessmentSpeech': 'summary.fields.assessmentSpeech',
  'ongoingRiskSelfHarm': 'summary.fields.ongoingRiskSelfHarm',
  'ongoingRiskSelfHarmNotes': 'summary.fields.ongoingRiskSelfHarmNotes',
  'ongoingRiskSuicidalThoughts': 'summary.fields.ongoingRiskSuicidalThoughts',
  'ongoingRiskSuicidalPlan': 'summary.fields.ongoingRiskSuicidalPlan',
  'ongoingRiskSuicidalAction': 'summary.fields.ongoingRiskSuicidalAction',
  'ongoingRiskSuicidalThoughtsNotes':
      'summary.fields.ongoingRiskSuicidalThoughtsNotes',
  'additionalNotes': 'summary.fields.additionalNotes',
};

/// Maps each hardcoded dropdown option literal (the data value stored in
/// the form, e.g. `'Male'`/`'Yes'`) to its real translation key, taken from
/// ally-mobile (React Native)'s `summary.options` locale namespace. The
/// stored/submitted option value is left exactly as-is (same wire contract);
/// only the on-screen label is translated. Age-range options (`'0-5'`, ...)
/// aren't in this map — they're numeric codes with no RN translation
/// precedent, same as upstream.
const _fieldOptionLabelKeys = <String, String>{
  'Male': 'summary.options.gender.male',
  'Female': 'summary.options.gender.female',
  'Non-binary': 'summary.options.gender.nonBinary',
  'Client Prefers Not to Say': 'summary.options.gender.preferNotToSay',
  'Yes': 'summary.options.risk.yes',
  'No': 'summary.options.risk.no',
  'Congruent': 'summary.options.affect.congruent',
  'Incongruent': 'summary.options.affect.incongruent',
  'Flat': 'summary.options.affect.flat',
  'Blunted': 'summary.options.affect.blunted',
  'Clear & Coherent': 'summary.options.speech.clearCoherent',
  'Sluttering': 'summary.options.speech.sluttering',
  'Fast': 'summary.options.speech.fast',
  'Slow': 'summary.options.speech.slow',
  'Difficult to Understand': 'summary.options.speech.difficultToUnderstand',
};

/// Port of ally-mobile (React Native)'s `CallSummaryScreen` — the
/// structured clinical documentation form (`summaryFieldDefs`, ported from
/// `src/constants/summary.ts`), editable and saved back via
/// `updateCallSummary`, plus the call's transcript.
///
/// Opened two ways, like RN: from the call log ([fromLogs], RN's `callId`
/// param) or right after a live call from Box Breathing (RN navigates with
/// no params; [chatId] then comes from the current chat). The live flow
/// holds the "Setting up" state for 3s once the summary lands, prompts for
/// summary feedback on back at once, and leaves by resetting to the Call
/// Log tab (`useCallSummaryActions.handleGoBack`).
///
/// The 3-dot menu ports RN's `SummaryModals` (`CustomMenuModal`: rename,
/// export, data policy, archive/unarchive). The header share toggle, the
/// floating "view review" button (`useHideReviewDetails`), generation
/// progress with notes (`SummaryGenerationProgress`/`AddNotesSection`) and
/// the summary-feedback popup are wired as in RN.
class CallSummaryScreen extends ConsumerStatefulWidget {
  const CallSummaryScreen({
    super.key,
    this.log,
    this.chatId,
    this.fromLogs = true,
    this.now = DateTime.now,
  });

  /// The call-log row this was opened from, when there is one.
  final CallLogItem? log;

  /// The chat to show; falls back to [log]'s id. Null only when the live
  /// flow has no current chat (RN then shows the generating state forever).
  final int? chatId;

  /// RN `isCallLogSummaryFlow` (`Boolean(callId)`).
  final bool fromLogs;

  /// Injectable clock, so tests can fast-forward past the 30s
  /// back-press-feedback-prompt threshold without a real wall-clock wait.
  final DateTime Function() now;

  int? get resolvedChatId => chatId ?? log?.id;

  @override
  ConsumerState<CallSummaryScreen> createState() => _CallSummaryScreenState();
}

class _CallSummaryScreenState extends ConsumerState<CallSummaryScreen> {
  late final DateTime _mountTime;
  bool _showFeedbackPopup = false;

  /// RN `useSummaryState.canShowSummary`: true from the start when opened
  /// from the logs; in the live flow it flips 3s after the summary arrives.
  late bool _canShowSummary = widget.fromLogs;
  Timer? _canShowSummaryTimer;

  /// RN latches these for the screen's lifetime (`setIsSummaryAvailable`
  /// never resets; `isManualNoteRef`), so the first save of a manual note
  /// doesn't turn it into an AI summary that prompts for feedback.
  bool _isSummaryAvailable = false;
  bool _isManualNote = false;

  /// RN `useCallSummaryActions.summaryName` — kept locally so a rename
  /// shows at once.
  String? _summaryName;

  /// Mirrors RN's `useHideReviewDetails`'s `hideReviewDetails` state
  /// (initial value `true`, same as there) — whether the floating "view
  /// review" button should stay hidden because the review is private AND
  /// has no threads/reactions worth surfacing yet.
  bool _hideReviewDetails = true;

  /// Guards the async visibility check so it only re-runs when the
  /// review's identity or privacy actually changes, not on every rebuild.
  String? _hideReviewDetailsCheckedFor;

  int get _chatId => widget.resolvedChatId!;

  CallSummaryActions get _actions => CallSummaryActions(ref, _chatId);

  @override
  void initState() {
    super.initState();
    // Captured eagerly here, not via a lazy `late` initializer — this must
    // be the real mount moment, not whenever `_mountTime` happens to be
    // first read (which is only on back-press, long after mount).
    _mountTime = widget.now();
    _summaryName = widget.log?.sessionName;
  }

  @override
  void dispose() {
    _canShowSummaryTimer?.cancel();
    super.dispose();
  }

  void _onSummary(CallSummaryDetails summary) {
    if (summary.summaryName != null) _summaryName = summary.summaryName;
    if (summary.isSummaryAvailable) _isSummaryAvailable = true;
    if (summary.isManualNote) _isManualNote = true;
    if (_isSummaryAvailable && !_canShowSummary && _canShowSummaryTimer == null) {
      _canShowSummaryTimer = Timer(const Duration(seconds: 3), () {
        if (mounted) setState(() => _canShowSummary = true);
      });
    }
  }

  /// Mirrors RN's `useHideReviewDetails`: a non-private review's button is
  /// always shown; a private one is hidden unless it already has a thread
  /// or a reaction (otherwise there's nothing behind the button to see).
  Future<void> _checkHideReviewDetails(String reviewId, bool isPrivate) async {
    if (!isPrivate) {
      if (mounted) setState(() => _hideReviewDetails = false);
      return;
    }
    try {
      final threads = await ref.read(scribeReviewsRepositoryProvider).getThreads(reviewId, limit: 1);
      if (threads.threads.isNotEmpty) {
        if (mounted) setState(() => _hideReviewDetails = false);
        return;
      }
      final reactions = await ref.read(scribeReactionsRepositoryProvider).getReactionsCount(reviewId);
      if (mounted) setState(() => _hideReviewDetails = reactions.isEmpty);
    } catch (_) {
      // RN only logs this (console.error) and leaves the prior value in
      // place — matched by simply not updating state here.
    }
  }

  /// RN `handleRefresh` on every re-focus after the first (back from the
  /// share or review screens).
  Future<void> _pushAndRefresh(Future<void> navigation) async {
    await navigation;
    if (mounted) ref.invalidate(callSummaryProvider(_chatId));
  }

  /// Mirrors RN's `handleShareToggle`: turning the switch ON when there's
  /// no review yet, or one was created within the last 10 minutes, opens
  /// the share/edit-note screen (RN `handleShareForReview`) instead of
  /// silently flipping a status. Any other toggle — ON for an older review,
  /// or OFF at all — just flips the review's visibility directly.
  Future<void> _handleShareToggle(bool isEnabled, CallSummaryDetails summary) async {
    final reviewId = summary.reviewId;
    final createdAt = summary.reviewCreatedAt;
    final recentlyCreated = createdAt != null && !_isMinutesPassed(createdAt);
    if (isEnabled && (reviewId == null || recentlyCreated)) {
      final title = _summaryName?.isNotEmpty ?? false
          ? _summaryName
          : ref.tr('review.feedCard.sharedSimulationForReview');
      await _pushAndRefresh(
        context.push<void>(
          '/share-for-review/$_chatId',
          extra: (
            reviewId: reviewId,
            note: summary.reviewNote,
            contextDateTime: summary.startTime ?? summary.createdAt,
            contextDuration: formatReviewDuration('${summary.callDuration ?? 0}'),
            isScribe: true,
            contextTitle: title,
          ),
        ),
      );
      return;
    }
    if (reviewId == null) return;
    try {
      await ref
          .read(scribeReviewsRepositoryProvider)
          .updateReviewStatus(reviewId: reviewId, status: isEnabled ? 'IN_REVIEW' : 'HIDDEN');
      if (mounted) showCallSummaryToast(ref.tr('simulationPage.privacyUpdated'));
    } catch (_) {
      if (mounted) showCallSummaryToast(ref.tr('simulationPage.errorUpdatePrivacy'));
    } finally {
      ref.invalidate(callSummaryProvider(_chatId));
    }
  }

  /// RN `DeleteRenameModal` 'rename' (`CustomModal` with an input) →
  /// `handleSummaryNameChange`.
  Future<void> _showRenameModal() async {
    final newName = await CallSummaryTextModal.show(
      context,
      title: ref.tr('callSummary.info.rename'),
      primaryLabel: ref.tr('callSummary.info.confirm'),
      secondaryLabel: ref.tr('callSummary.info.cancel'),
      initialValue: _summaryName ?? '',
      showInput: true,
    );
    if (newName == null) return;
    final renamed = await _actions.rename(newName);
    if (!mounted) return;
    if (renamed) setState(() => _summaryName = newName);
    ref.invalidate(callSummaryProvider(_chatId));
  }

  /// RN `ArchiveActionModal` → `handleArchive`.
  Future<void> _handleArchiveToggle(bool currentlyArchived) async {
    final action = currentlyArchived ? 'unarchive' : 'archive';
    final confirmed = await ConfirmationModal.show(
      context,
      title: ref.tr('callSummary.archiveActionModal.$action.header.title'),
      subtitle: ref.tr('callSummary.archiveActionModal.$action.header.subtitle'),
      description: ref.tr('callSummary.archiveActionModal.$action.description'),
      confirmLabel: ref.tr('callSummary.archiveActionModal.$action.confirm'),
      cancelLabel: ref.tr('callSummary.archiveActionModal.$action.cancel'),
      confirmVariant: currentlyArchived ? AppButtonVariant.primary : AppButtonVariant.destructive,
    );
    if (confirmed != true) return;
    await _actions.archive(archive: !currentlyArchived);
    ref.invalidate(callSummaryProvider(_chatId));
  }

  /// RN `DeleteRenameModal` 'delete' → `handleDelete` (back after 2s).
  /// RN's menu has no entry that opens it; kept for parity of behaviour.
  // ignore: unused_element
  Future<void> _showDeleteModal() async {
    final confirmed = await CallSummaryTextModal.show(
      context,
      title: ref.tr('callSummary.customMenu.delete'),
      primaryLabel: ref.tr('callSummary.customMenu.delete'),
      secondaryLabel: ref.tr('callSummary.info.cancel'),
      primaryTextColor: AppColors.brightRed,
      description: ref.tr('callSummary.customMenu.deleteConfirmation'),
    );
    if (confirmed == null) return;
    if (await _actions.delete()) {
      await Future<void>.delayed(const Duration(seconds: 2));
      if (mounted) context.pop();
    }
  }

  /// RN `SummaryModals`' `customMenuOptions`.
  void _showMenu(CallSummaryDetails? summary) {
    final isArchived = summary?.isArchived ?? false;
    CallSummaryMenu.show(context, [
      CallSummaryMenuOption(
        key: const Key('call-summary-menu-rename'),
        label: ref.tr('callSummary.info.rename'),
        iconAsset: 'assets/icons/edit.svg',
        onPress: _showRenameModal,
      ),
      if (_isSummaryAvailable)
        CallSummaryMenuOption(
          key: const Key('call-summary-menu-export'),
          label: ref.tr('callSummary.customMenu.export'),
          iconAsset: 'assets/icons/export.svg',
          onPress: _actions.export,
        ),
      CallSummaryMenuOption(
        key: const Key('call-summary-menu-data-policy'),
        label: ref.tr('callSummary.customMenu.dataPolicy'),
        iconAsset: 'assets/icons/contract.svg',
        onPress: () => launchUrl(Uri.parse(_privacyPolicyUrl), mode: LaunchMode.externalApplication),
      ),
      CallSummaryMenuOption(
        key: const Key('call-summary-menu-archive'),
        label: ref.tr(isArchived ? 'callSummary.customMenu.unarchive' : 'callSummary.customMenu.archive'),
        iconAsset: isArchived ? 'assets/icons/unarchive.svg' : 'assets/icons/archive.svg',
        onPress: () => _handleArchiveToggle(isArchived),
      ),
    ]);
  }

  /// RN `useCallSummaryActions.handleGoBack`: back from the logs; the live
  /// flow resets to the Call Log tab and clears the current chat.
  void _handleGoBack() {
    if (!mounted) return;
    if (widget.fromLogs) {
      context.pop();
    } else {
      _goToCallLog();
    }
  }

  /// RN `onViewCallLogs` ("I'll check later") and the live-flow go-back.
  void _goToCallLog() {
    ref.read(currentChatProvider.notifier).set(null);
    goToHomeTab(GoRouter.of(context), kTabCallLog);
  }

  bool get _hasEditFeedbackPermission =>
      (ref.read(userPermissionsProvider).value ?? const <String>[]).contains(UserPermissions.editSummaryFeedback);

  bool get _hasFeedbackAlready => ref.read(callSummaryProvider(_chatId)).value?.isSummaryFeedbackAdded ?? false;

  /// Mirrors RN's `onBackNavigation`: an AI summary that's on screen, not
  /// rated yet, with EDIT_SUMMARY_FEEDBACK, prompts for feedback when the
  /// counsellor has spent 30s on it or came straight from the call.
  /// Manual notes never prompt.
  Future<void> _handleBackPress() async {
    if (widget.resolvedChatId == null) return _handleGoBack();
    final summaryGenerated = _isSummaryAvailable && _canShowSummary;
    if (!summaryGenerated || _isManualNote) return _handleGoBack();
    final elapsed = widget.now().difference(_mountTime);
    if ((elapsed >= const Duration(seconds: 30) || !widget.fromLogs) &&
        !_hasFeedbackAlready &&
        _hasEditFeedbackPermission) {
      setState(() => _showFeedbackPopup = true);
      return;
    }
    _handleGoBack();
  }

  /// RN `onSaveButtonPress`: after the global Save, ask for feedback on an
  /// AI summary that hasn't been rated.
  void _onSaveButtonPress() {
    if (!_hasFeedbackAlready && _hasEditFeedbackPermission && !_isManualNote) {
      setState(() => _showFeedbackPopup = true);
    }
  }

  /// RN `onSubmitSummaryFeedback`: toast either way, close, go back.
  Future<void> _submitFeedback(FeedbackValue value, List<String> issues) async {
    try {
      await ref
          .read(callLogRepositoryProvider)
          .addSummaryFeedback(
            chatId: _chatId,
            rating: value.rating,
            comment: value.comment,
            issues: issues,
            tags: value.tags,
          );
      showCallSummaryToast(ref.tr('callFeedback.submitted'));
    } catch (_) {
      showCallSummaryToast(ref.tr('summaryLoading.summaryFeedbackSubmittedFailed'));
    }
    if (!mounted) return;
    setState(() => _showFeedbackPopup = false);
    _handleGoBack();
  }

  Widget _buildHeaderTitle(BuildContext context) {
    // "Session" (regular) + "Summary" (bold italic), then `#summaryName`
    // or `-` (RN `Header.tsx`).
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        RichText(
          text: TextSpan(
            style: Theme.of(context).textTheme.titleLarge?.copyWith(color: AppColors.highEmphasis),
            children: [
              TextSpan(text: '${ref.t('callSummary.header.title')} '),
              TextSpan(
                text: ref.t('callSummary.header.subtitle'),
                style: const TextStyle(fontStyle: FontStyle.italic, fontWeight: FontWeight.w600),
              ),
            ],
          ),
        ),
        Text(
          (_summaryName?.isNotEmpty ?? false) ? '#$_summaryName' : '-',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppColors.mediumEmphasis),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final chatId = widget.resolvedChatId;
    // Warms the cache so `_handleBackPress`'s `ref.read` (fired once, on
    // back-press) sees an already-resolved value instead of the still-
    // loading state a cold first `read` of a `FutureProvider` returns.
    final permissions = ref.watch(userPermissionsProvider).value ?? const <String>[];
    final AsyncValue<CallSummaryDetails?> summaryAsync = chatId == null
        ? const AsyncData<CallSummaryDetails?>(null)
        : ref.watch(callSummaryProvider(chatId));

    if (chatId != null) {
      // One-time-per-identity visibility check for the floating "view
      // review" button — RN's `useEffect([reviewId, isPrivate, ...])`.
      ref.listen(callSummaryProvider(chatId), (previous, next) {
        final summary = next.value;
        final reviewId = summary?.reviewId;
        if (reviewId == null) return;
        final isPrivate = summary!.reviewStatus == 'HIDDEN';
        final key = '$reviewId|$isPrivate';
        if (_hideReviewDetailsCheckedFor == key) return;
        _hideReviewDetailsCheckedFor = key;
        _checkHideReviewDetails(reviewId, isPrivate);
      });
    }

    final summary = summaryAsync.value;
    if (summary != null) _onSummary(summary);
    final error = summaryAsync.error;
    final isUnauthorized = error is DioException && error.response?.statusCode == 403;
    // RN `showTranscriptTab`: a chat, not a 403, and VIEW_MESSAGES.
    final showTranscriptTab =
        chatId != null && !isUnauthorized && permissions.contains(UserPermissions.viewMessages);
    final showShareSwitch =
        _isSummaryAvailable &&
        summary != null &&
        summary.summaryStatus == 'SUCCESS' &&
        summary.hasTranscript &&
        !summary.isArchived;
    final hasScribeReviewPermission = permissions.contains(UserPermissions.viewScribeReview);
    final showReviewButton =
        summary?.reviewId != null && !_hideReviewDetails && hasScribeReviewPermission && !(summary?.isArchived ?? false);

    final summaryTab = _SummaryTab(
      chatId: chatId,
      summaryAsync: summaryAsync,
      isLiveFlow: !widget.fromLogs || ref.watch(currentChatProvider) != null,
      canShowSummary: _canShowSummary,
      isSummaryAvailable: _isSummaryAvailable,
      isManualNote: _isManualNote,
      alwaysShowSave: !widget.fromLogs,
      isFeedbackPopupVisible: _showFeedbackPopup,
      onSaveButtonPress: _onSaveButtonPress,
      onCheckLater: _goToCallLog,
      onGoBack: _handleGoBack,
    );

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) {
        if (!didPop) _handleBackPress();
      },
      child: DefaultTabController(
        key: ValueKey(showTranscriptTab),
        length: showTranscriptTab ? 2 : 1,
        child: Scaffold(
          appBar: AppBar(
            // RN `Header.tsx`: a plain white header.
            backgroundColor: Colors.white,
            foregroundColor: AppColors.highEmphasis,
            elevation: 0,
            // `PopScope(canPop: false)` hides the implied back button, so
            // an explicit one routes through the same interception.
            leading: IconButton(
              icon: const BackButtonIcon(),
              tooltip: MaterialLocalizations.of(context).backButtonTooltip,
              onPressed: _handleBackPress,
            ),
            title: _buildHeaderTitle(context),
            actions: [
              if (showShareSwitch)
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(ref.t('learn.scenario.share')),
                    Switch(
                      value: summary.isSharedForReview,
                      onChanged: (value) => _handleShareToggle(value, summary),
                    ),
                  ],
                ),
              if (chatId != null)
                IconButton(
                  key: const Key('call-summary-menu'),
                  icon: SvgPicture.asset('assets/icons/threeDots.svg'),
                  onPressed: () => _showMenu(summary),
                ),
            ],
            bottom: TabBar(
              tabs: [
                Tab(text: ref.t('postCallSummary.header.summary')),
                if (showTranscriptTab) Tab(text: ref.t('summary.tabs.transcript')),
              ],
            ),
          ),
          floatingActionButton: showReviewButton
              ? FloatingActionButton(
                  key: const Key('call-summary-view-review'),
                  onPressed: () => _pushAndRefresh(
                    context.push(
                      '/reviews/${summary!.reviewId}',
                      extra: ReviewType.scribe,
                    ),
                  ),
                  child: const Icon(Icons.comment_outlined),
                )
              : null,
          body: Stack(
            children: [
              TabBarView(
                children: [
                  summaryTab,
                  if (showTranscriptTab)
                    CallTranscriptTab(
                      messagesAsync: ref.watch(chatMessagesProvider(chatId)),
                      summary: summary,
                    ),
                ],
              ),
              if (_showFeedbackPopup)
                Positioned.fill(
                  child: FeedbackPopup(
                    title: ref.t('callFeedback.rateTitle'),
                    placeholder: ref.t('callFeedback.suggestionPlaceholder'),
                    note: ref.t('callFeedback.rateSubtitle'),
                    showChips: true,
                    // RN `hideSummaryFeedbackPopup`: just closes.
                    onClose: () => setState(() => _showFeedbackPopup = false),
                    onSubmit: (value) => _submitFeedback(value, const []),
                    onSubmitWithIssues: _submitFeedback,
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SummaryTab extends ConsumerStatefulWidget {
  const _SummaryTab({
    required this.chatId,
    required this.summaryAsync,
    required this.isLiveFlow,
    required this.canShowSummary,
    required this.isSummaryAvailable,
    required this.isManualNote,
    required this.alwaysShowSave,
    required this.isFeedbackPopupVisible,
    required this.onSaveButtonPress,
    required this.onCheckLater,
    required this.onGoBack,
  });

  final int? chatId;
  final AsyncValue<CallSummaryDetails?> summaryAsync;

  /// RN `currentChat` in `SummaryGenerationProgress`: all steps vs the tail.
  final bool isLiveFlow;

  /// RN `canShowSummary` / latched `isSummaryAvailable` / `isManualNote`.
  final bool canShowSummary;
  final bool isSummaryAvailable;
  final bool isManualNote;

  /// RN `shouldShowSaveButton = (!callId || hasChanges) && !popupVisible`.
  final bool alwaysShowSave;
  final bool isFeedbackPopupVisible;
  final VoidCallback onSaveButtonPress;
  final VoidCallback onCheckLater;
  final VoidCallback onGoBack;

  @override
  ConsumerState<_SummaryTab> createState() => _SummaryTabState();
}

class _SummaryTabState extends ConsumerState<_SummaryTab> {
  /// Built-in field values + last-saved baseline (RN `formData` /
  /// `savedFormData`); dirty = differs from the baseline. See
  /// [SummaryFormState] for why that, not a touched-set, keeps edits made
  /// during a save and across a reseed.
  final SummaryFormState _form = SummaryFormState();
  CallSummaryDetails? _seededFrom;
  bool _isSaving = false;
  bool _isRetrying = false;
  Timer? _notesDebounce;

  int get _chatId => widget.chatId!;

  @override
  void dispose() {
    _notesDebounce?.cancel();
    super.dispose();
  }

  /// RN `useSummaryState.handleNoteChange`: `POST /chats/:id/notes`, 1s
  /// after the last keystroke; failures are only logged.
  void _onNoteChange(String text) {
    _notesDebounce?.cancel();
    final chatId = widget.chatId;
    if (chatId == null) return;
    _notesDebounce = Timer(const Duration(seconds: 1), () {
      ref.read(callLogRepositoryProvider).updateNotes(chatId, text).catchError((Object error) {
        debugPrint('Error updating notes: $error');
      });
    });
  }
  String? _error;

  // Per-section accordion/edit-mode state — mirrors RN's
  // `CallSummaryDetails.tsx` `expanded`/`isEditing` state maps. Absence
  // means false/collapsed/not-editing, same default RN seeds every section
  // to.
  final Map<SummarySection, bool> _expandedSections = {};
  final Map<SummarySection, bool> _editingSections = {};
  final Set<SummarySection> _enhancingSections = {};

  // Tenant-configured custom fields (see custom_fields_repository.dart) —
  // kept in their own map/dirty-set rather than merged into _form above: they save through a different endpoint
  // (upsertValues, not updateCallSummary) and are keyed by field-definition
  // id, a different id space from the built-in SummaryFieldDef.key values.
  final Map<String, String?> _customFieldValues = {};
  final Set<String> _dirtyCustomFieldIds = {};
  List<CustomFieldDefinition> _customFieldDefs = const [];
  String? _customFieldsSeededForChatId;

  /// RN `useCallSummaryForm`'s seed effect: reseeds on every new server
  /// copy (an AI fill or regeneration landing, a refetch), keeping unsaved
  /// edits for the same chat — not only once per chat.
  @override
  void initState() {
    super.initState();
    // RN CallSummaryScreen refetches `getSummaryFields` whenever it opens;
    // the previous list keeps showing meanwhile. Not built yet means the
    // first watch fetches it anyway.
    if (ref.exists(summaryVisibleFieldsProvider)) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) ref.invalidate(summaryVisibleFieldsProvider);
      });
    }
  }

  void _seedIfNeeded(CallSummaryDetails summary) {
    if (identical(_seededFrom, summary)) return;
    _form.seed(summary.fields, chatId: _chatId);
    _seededFrom = summary;
  }

  void _onFieldChanged(String fieldKey, dynamic value) {
    setState(() => _form.set(fieldKey, value));
  }

  /// Mirrors RN's `SectionHeader`/`toggleSection` (`CallSummaryDetails.tsx`):
  /// the accordion is exclusive (opening one section closes every other),
  /// and toggling is blocked entirely while a DIFFERENT section is mid-edit
  /// — only the section currently being edited may be collapsed (which also
  /// exits its edit mode).
  void _toggleSection(SummarySection section) {
    final isAnyEditing = _editingSections.values.any((editing) => editing);
    final isCurrentEditing = _editingSections[section] ?? false;
    if (isAnyEditing && !isCurrentEditing) return;
    setState(() {
      if (isCurrentEditing) _editingSections[section] = false;
      final wasExpanded = _expandedSections[section] ?? false;
      _expandedSections.clear();
      if (!wasExpanded) _expandedSections[section] = true;
    });
  }

  void _onEditPress(SummarySection section) {
    setState(() => _editingSections[section] = true);
  }

  /// RN's `handleSectionFieldsReset` — resets only this section's editable
  /// built-in fields back to their last-saved values. Custom field edits
  /// are deliberately left untouched: RN's own `onClosePress` never resets
  /// them either (only `handleSectionFieldsReset`, built-in fields only),
  /// so a closed-without-saving custom field edit stays dirty until the
  /// section is reopened and actually saved — a faithfully-ported quirk,
  /// not something to silently "fix" here.
  void _resetSectionFields(SummarySection section) {
    _form.reset(summaryFieldDefs.where((f) => f.section == section && f.editable).map((f) => f.key));
  }

  void _onClosePress(SummarySection section) {
    setState(() {
      _editingSections[section] = false;
      _resetSectionFields(section);
    });
  }

  /// RN's `onTickPress`: exits edit mode immediately (optimistic, before the
  /// saves resolve — same as RN), then saves all dirty built-in fields
  /// (shared `handleSubmit`, not scoped to this section — RN's tick calls
  /// the exact same submit the global bottom button does) plus this
  /// section's own dirty custom fields specifically.
  Future<void> _onTickPress(SummarySection section) async {
    setState(() => _editingSections[section] = false);
    await _saveBuiltinFields();
    await _saveCustomFieldsForSection(section);
  }

  /// RN's `onWandPress` (`SectionWrapper.tsx`): AI-rewrites the section's
  /// one editable text field in place. Guards exactly as RN does: no
  /// matching/editable field, or empty content, is a silent no-op.
  Future<void> _onWandPress(SummarySection section) async {
    SummaryFieldDef? field;
    for (final f in summaryFieldDefs) {
      if (f.section == section) {
        field = f;
        break;
      }
    }
    if (field == null || !field.editable) return;
    final content = _form[field.key];
    if (content is! String || content.trim().isEmpty) return;

    setState(() => _enhancingSections.add(section));
    String? enhanced;
    try {
      enhanced = await ref.read(callLogRepositoryProvider).enhanceCallSummary(content);
    } catch (_) {
      enhanced = null;
    }
    if (!mounted) return;
    if (enhanced == null) {
      // Guard on the CONTENT, not the call succeeding — RN's own comment on
      // this exact check: a failed enhance can arrive as a truthy empty
      // response, which must not silently wipe the counsellor's text.
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(ref.tr('summary.enhanceFailed'))),
      );
    } else {
      _onFieldChanged(field.key, enhanced);
    }
    if (mounted) setState(() => _enhancingSections.remove(section));
  }

  /// Mirrors RN's `CallSummaryDetails.tsx` seed effect: seeds local edit
  /// state once per chat from the live values query, so a background
  /// refetch (the query has `refetchOnMountOrArgChange: true` upstream)
  /// never clobbers an in-progress edit.
  void _seedCustomFieldsIfNeeded(List<CustomFieldValue> values) {
    final pending = _customValuesBeforeReseed;
    if (pending != null && !identical(values, pending)) {
      _customFieldsSeededForChatId = null;
      _customValuesBeforeReseed = null;
    }
    final key = '$_chatId';
    if (_customFieldsSeededForChatId == key) return;
    _customFieldValues
      ..clear()
      ..addEntries(values.map((v) => MapEntry(v.fieldDefinitionId, v.value)));
    _dirtyCustomFieldIds.clear();
    _customFieldsSeededForChatId = key;
  }

  /// RN `onCustomValuesApplied` (remount + re-seed): voice dictation wrote
  /// custom values server-side, so seed again from the refetched list.
  List<CustomFieldValue>? _customValuesBeforeReseed;
  void _reseedCustomFields() {
    _customValuesBeforeReseed = ref.read(customFieldValuesProvider(_chatId)).value ?? const [];
    ref.invalidate(customFieldValuesProvider(_chatId));
  }

  void _onCustomFieldChanged(String fieldDefinitionId, String? value) {
    setState(() {
      _customFieldValues[fieldDefinitionId] = value;
      _dirtyCustomFieldIds.add(fieldDefinitionId);
    });
  }

  /// Applies voice-dictated field values: merges them into the form
  /// optimistically (mirrors RN's `dispatch(setFormData(builtinUpdates))`,
  /// which updates redux before the save call even starts), then persists
  /// immediately — RN's `applyGeneratedValues` awaits its own
  /// `updateCallSummary(...).unwrap()` rather than waiting for this screen's
  /// explicit Save button, since a dictated note should be saved as soon as
  /// it's filled in. Rethrows on failure: `VoiceNoteSection._handleGenerate`
  /// relies on that to know not to close its panel/reset the recorder.
  Future<void> _applyVoiceValues(Map<String, dynamic> updates) async {
    setState(() {
      for (final entry in updates.entries) {
        _form.set(entry.key, entry.value);
      }
    });
    await ref.read(callLogRepositoryProvider).updateCallSummary(_chatId, updates);
    if (mounted) setState(() => _form.markSaved(updates));
  }

  // RN's global bottom Save button only ever shows/acts on built-in-field
  // changes (`useCallSummaryForm`'s `hasChanges`) — custom fields have no
  // global save path in RN at all, only the per-section tick
  // (`handleCustomFieldSave(sectionKey)`). Before per-section edit mode
  // existed, this app's one Save button covered both as the only way to
  // persist a custom field; now that the real per-section tick exists,
  // custom fields are only ever editable inside a section's edit mode
  // (gated the same way built-in fields are), so this reverts to RN's
  // actual scope.
  bool get _hasDirtyChanges => _form.hasChanges;

  /// RN's `handleSubmit` — saves every dirty built-in field across the
  /// whole form (not scoped to one section), shared by both the global
  /// Save button and each section's own tick/checkmark.
  Future<bool> _saveBuiltinFields() async {
    if (!_form.hasChanges) return true;
    // Snapshot what is sent: only these values become the new baseline, so
    // anything typed while the request is in flight stays unsaved (RN
    // `markFormDataSaved` of the written keys only).
    final patch = _form.pendingPatch();
    try {
      await ref.read(callLogRepositoryProvider).updateCallSummary(_chatId, patch);
      if (mounted) setState(() => _form.markSaved(patch));
      ref.invalidate(callSummaryProvider(_chatId));
      return true;
    } catch (e) {
      if (mounted) {
        setState(() => _error = '${ref.tr('callSummary.info.summaryUpdateFailed')}: $e');
      }
      return false;
    }
  }

  /// RN's `handleCustomFieldSave(sectionKey)` — saves only the dirty custom
  /// fields belonging to [section], independent of the built-in save's
  /// outcome. On failure the dirty set is NOT cleared, or the edit would
  /// look saved with no way to detect or retry it even though the write
  /// never reached the backend.
  Future<bool> _saveCustomFieldsForSection(SummarySection section) async {
    final sectionDefIds = _customFieldDefs
        .where((d) => d.sectionKey == section.name)
        .map((d) => d.id)
        .toSet();
    final changed = _dirtyCustomFieldIds.where(sectionDefIds.contains).toList();
    if (changed.isEmpty) return true;
    try {
      await ref.read(customFieldsRepositoryProvider).upsertValues(
        _chatId,
        [for (final id in changed) (fieldDefinitionId: id, value: _customFieldValues[id])],
      );
      if (mounted) setState(() => _dirtyCustomFieldIds.removeAll(changed));
      return true;
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(ref.tr('summary.customFieldSaveFailed'))),
        );
      }
      return false;
    }
  }

  /// RN `onSubmitButtonPress`: `handleSubmit` (a no-op without changes —
  /// the live flow shows Save regardless), then `onSaveButtonPress`.
  Future<void> _save() async {
    setState(() {
      _isSaving = true;
      _error = null;
    });
    await _saveBuiltinFields();
    if (mounted) {
      setState(() => _isSaving = false);
      widget.onSaveButtonPress();
    }
  }

  Future<void> _retrySummary() async {
    setState(() => _isRetrying = true);
    try {
      final result = await ref
          .read(callLogRepositoryProvider)
          .retrySummary(_chatId);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              result.success
                  ? ref.tr('summaryLoading.retryStarted')
                  : result.message ?? ref.tr('summaryLoading.retryFailed'),
            ),
          ),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(ref.tr('summaryLoading.retryFailed'))),
        );
      }
    }
    ref.invalidate(callSummaryProvider(_chatId));
    try {
      await ref.read(callSummaryProvider(_chatId).future);
    } catch (_) {
      // Surfaced via the provider's own AsyncError state.
    }
    if (mounted) setState(() => _isRetrying = false);
  }

  /// RN's generating layout: `SummaryGenerationProgress` + `AddNotesSection`
  /// in a scroll view, and the footer buttons (hidden while the feedback
  /// popup is up).
  Widget _buildGenerating(CallSummaryDetails? summary) {
    final status = summary?.summaryStatus;
    final hasFailed = status == 'FAILED';
    final settingUp = widget.isSummaryAvailable && !widget.canShowSummary;
    final busy = settingUp || _isRetrying || widget.summaryAsync.isLoading;
    return Column(
      children: [
        Expanded(
          child: SingleChildScrollView(
            keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.manual,
            child: Column(
              children: [
                SummaryGenerationProgress(
                  summaryStatus: status,
                  isLiveFlow: widget.isLiveFlow,
                  callDurationSeconds: summary?.callDuration ?? 0,
                ),
                AddNotesSection(savedNotes: summary?.notes ?? '', onNoteChange: _onNoteChange),
              ],
            ),
          ),
        ),
        if (!widget.isFeedbackPopupVisible)
          SummaryProgressButtons(
            summaryStatus: status,
            isBusy: busy,
            label: settingUp
                ? ref.t('summaryLoading.settingUp')
                : hasFailed
                ? ref.t('common.retry')
                : ref.t('summaryLoading.seeIfReady'),
            onPrimary: hasFailed ? _retrySummary : _refresh,
            onCheckLater: widget.onCheckLater,
          ),
      ],
    );
  }

  Future<void> _refresh() async {
    if (widget.chatId == null) return;
    setState(() => _isRetrying = true);
    ref.invalidate(callSummaryProvider(_chatId));
    // Mirrors RN's own `handleRefresh`: the loading flag just covers the
    // refetch's own round trip, not a fixed delay.
    try {
      await ref.read(callSummaryProvider(_chatId).future);
    } catch (_) {
      // Surfaced via the provider's own AsyncError state, nothing more to do here.
    }
    if (mounted) setState(() => _isRetrying = false);
  }

  @override
  Widget build(BuildContext context) {
    return widget.summaryAsync.when(
      skipLoadingOnRefresh: true,
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, _) {
        // RN's `isUnauthorized`: any 403 on the summary fetch (viewing a
        // call not owned/assigned to you) gets its own view instead of the
        // generic error text, and suppresses the transcript tab too — see
        // `CallSummaryScreen`'s own `showTranscriptTab` check.
        if (error is DioException && error.response?.statusCode == 403) {
          return _SummaryUnauthorizedView(onGoBack: widget.onGoBack);
        }
        return Center(
          child: Text('${ref.t('common.somethingWentWrong')} $error'),
        );
      },
      data: (summary) {
        if (summary == null || !((widget.isSummaryAvailable || widget.isManualNote) && widget.canShowSummary)) {
          return _buildGenerating(summary);
        }
        _seedIfNeeded(summary);

        // RN `selectSummaryVisibleFields` (tenant `/settings/summary-fields`).
        // RN has it in redux before this screen opens; here the first load
        // waits for it rather than flashing sections that then vanish. An
        // error is RN's untouched initial `[]`.
        final visibleFieldsAsync = ref.watch(summaryVisibleFieldsProvider);
        if (!visibleFieldsAsync.hasValue && visibleFieldsAsync.isLoading) {
          return const Center(child: CircularProgressIndicator());
        }
        final visibleFields = visibleFieldsAsync.value ?? const <String>[];

        // Custom fields: fetched/seeded only once the tenant toggle resolves
        // true — mirrors RN's `skip: !customFieldsActive` on both the
        // definitions and values queries, rather than firing either request
        // unconditionally on every summary open.
        final customFieldsEnabled = ref.watch(customFieldsEnabledProvider).value ?? false;
        if (customFieldsEnabled) {
          _customFieldDefs = ref.watch(customFieldDefinitionsProvider).value ?? _customFieldDefs;
          final valuesAsync = ref.watch(customFieldValuesProvider(_chatId));
          final values = valuesAsync.value;
          if (values != null) _seedCustomFieldsIfNeeded(values);
        } else {
          _customFieldDefs = const [];
        }
        final permissions = ref.watch(userPermissionsProvider).value ?? const <String>[];
        final isAdmin = permissions.contains(UserPermissions.manageCustomFieldDefinitions);
        final currentUserId = ref.watch(currentUserProvider).value?.id;
        final isCounsellorForCall = summary.counselorId != null && summary.counselorId == currentUserId;

        return Column(
          children: [
            if (widget.isManualNote)
              VoiceNoteSection(
                chatId: _chatId,
                onValuesApplied: _applyVoiceValues,
                onCustomValuesApplied: _reseedCustomFields,
              ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  // RN's `CallSummaryDetails.tsx` never shows raw
                  // status/started/ended/score fields on this screen at all
                  // — those were this app's own Phase 0 scaffold text,
                  // leftover from before the real screen was built out, and
                  // they never got cleaned up. What RN actually shows here
                  // first is this AI-generated disclaimer banner
                  // (`styles.alertContainer`/`alertIconContainer`/
                  // `alertText`), always visible above the section list.
                  Container(
                    margin: const EdgeInsets.only(bottom: 16),
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: AppColors.amber50,
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: AppColors.orange400, width: 0.5),
                    ),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: [
                        Container(
                          width: 32,
                          height: 32,
                          margin: const EdgeInsets.only(right: 10),
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            border: Border.all(color: AppColors.orange400, width: 0.5),
                          ),
                          child: const Icon(
                            Icons.shield_outlined,
                            size: 18,
                            color: AppColors.orange400,
                          ),
                        ),
                        Expanded(
                          child: Text(
                            ref.t('callSummary.aiGeneratedWarning'),
                            style: const TextStyle(color: AppColors.red700, fontSize: 12),
                          ),
                        ),
                      ],
                    ),
                  ),
                  for (final section in SummarySection.values)
                    if (isSummarySectionVisible(section, visibleFields))
                      _SectionCard(
                        section: section,
                        visibleFields: visibleFields,
                        formValues: _form.values,
                        onFieldChanged: _onFieldChanged,
                        customFieldDefs: _customFieldDefs,
                        customFieldValues: _customFieldValues,
                        onCustomFieldChanged: _onCustomFieldChanged,
                        isAdmin: isAdmin,
                        isCounsellorForCall: isCounsellorForCall,
                        isExpanded: _expandedSections[section] ?? false,
                        isEditing: _editingSections[section] ?? false,
                        isEnhancing: _enhancingSections.contains(section),
                        onToggle: () => _toggleSection(section),
                        onEditPress: () => _onEditPress(section),
                        onWandPress: () => _onWandPress(section),
                        onTickPress: () => _onTickPress(section),
                        onClosePress: () => _onClosePress(section),
                      ),
                ],
              ),
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Text(
                  _error!,
                  style: const TextStyle(color: AppColors.red400),
                ),
              ),
            // RN's `CallSummaryDetails.tsx` renders `showSaveButton && (...)`
            // — the button is absent with nothing to save, not present and
            // disabled with a relabeled "No changes" state (which was never
            // RN's actual behaviour here).
            if ((widget.alwaysShowSave || _hasDirtyChanges) && !widget.isFeedbackPopupVisible)
              SafeArea(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: AppButton(
                    label: ref.t('common.save'),
                    isLoading: _isSaving,
                    onPressed: _save,
                  ),
                ),
              ),
          ],
        );
      },
    );
  }
}

/// Mirrors RN's `SectionWrapper`'s `canEditField` callback.
bool _canEditCustomField(CustomFieldDefinition def, {required bool isAdmin, required bool isCounsellorForCall}) {
  switch (def.editPermission) {
    case CustomFieldEditPermission.both:
      return true;
    case CustomFieldEditPermission.adminOnly:
      return isAdmin;
    case CustomFieldEditPermission.counsellorOnly:
      return isCounsellorForCall;
  }
}

/// Mirrors RN's `SectionWrapper` + `SectionHeader` — a custom accordion
/// header (not Flutter's `ExpansionTile`, whose own expand/collapse state
/// can't be driven externally the way RN's exclusive, edit-aware accordion
/// needs: one section open at a time, and toggling blocked while another
/// section is mid-edit). The header's right side is a pencil ("edit this
/// section") that swaps for a wand ("AI-enhance", only when [canEnhance])
/// plus a checkmark ("save") and a close icon ("cancel, reset this
/// section's fields") once editing — RN's `editSquare.svg`/`wandStars.svg`/
/// `check.svg`/`closeCircle.svg`, same assets this app already has.
class _SectionCard extends ConsumerWidget {
  const _SectionCard({
    required this.section,
    required this.formValues,
    required this.onFieldChanged,
    required this.isExpanded,
    required this.isEditing,
    required this.isEnhancing,
    required this.onToggle,
    required this.onEditPress,
    required this.onWandPress,
    required this.onTickPress,
    required this.onClosePress,
    this.customFieldDefs = const [],
    this.customFieldValues = const {},
    this.onCustomFieldChanged,
    this.isAdmin = false,
    this.isCounsellorForCall = false,
    this.visibleFields,
  });

  final SummarySection section;

  /// Tenant visible field keys (RN `SectionWrapper`'s field filter).
  final List<String>? visibleFields;
  final Map<String, dynamic> formValues;
  final void Function(String fieldKey, dynamic value) onFieldChanged;
  final bool isExpanded;
  final bool isEditing;
  final bool isEnhancing;
  final VoidCallback onToggle;
  final VoidCallback onEditPress;
  final VoidCallback onWandPress;
  final VoidCallback onTickPress;
  final VoidCallback onClosePress;

  /// All of the tenant's custom fields (unfiltered) — this widget filters to
  /// its own [section] internally, mirroring RN's `CustomFieldsSection`'s own
  /// `definitions.filter(d => d.sectionKey === sectionKey)`. `sectionKey` is
  /// matched against [SummarySection.name], which lines up 1:1 with RN's
  /// `SectionKey` string values (e.g. `ongoingRisks`, `keyConcern`).
  final List<CustomFieldDefinition> customFieldDefs;
  final Map<String, String?> customFieldValues;
  final void Function(String fieldDefinitionId, String? value)? onCustomFieldChanged;
  final bool isAdmin;
  final bool isCounsellorForCall;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final fields = summaryFieldDefs
        .where((f) => f.section == section && isSummaryFieldVisible(f, visibleFields))
        .toList();
    final sectionCustomFields = customFieldDefs.where((d) => d.sectionKey == section.name).toList();
    // RN's `canEdit={sectionConfig.canEdit && (isAdmin || isCounsellorForCall)}`.
    final canEdit = section.canEdit && (isAdmin || isCounsellorForCall);
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: AppCard(
        variant: AppCardVariant.flat,
        child: Column(
          children: [
            InkWell(
              key: ValueKey('section-header-${section.name}'),
              onTap: onToggle,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
                child: Row(
                  children: [
                    Icon(_sectionIcons[section] ?? Icons.article_outlined, size: 20),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        ref.t(_sectionLabelKeys[section] ?? section.label),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    if (isExpanded && canEdit)
                      if (!isEditing)
                        IconButton(
                          key: ValueKey('section-edit-${section.name}'),
                          icon: SvgPicture.asset('assets/icons/editSquare.svg', width: 20, height: 20),
                          onPressed: onEditPress,
                        )
                      else ...[
                        if (section.canEnhance)
                          isEnhancing
                              ? const Padding(
                                  padding: EdgeInsets.all(8),
                                  child: SizedBox(
                                    width: 16,
                                    height: 16,
                                    child: CircularProgressIndicator(strokeWidth: 2),
                                  ),
                                )
                              : IconButton(
                                  key: ValueKey('section-wand-${section.name}'),
                                  icon: SvgPicture.asset('assets/icons/wandStars.svg', width: 20, height: 20),
                                  onPressed: onWandPress,
                                ),
                        IconButton(
                          key: ValueKey('section-tick-${section.name}'),
                          icon: SvgPicture.asset('assets/icons/check.svg', width: 20, height: 20),
                          onPressed: onTickPress,
                        ),
                        IconButton(
                          key: ValueKey('section-close-${section.name}'),
                          icon: SvgPicture.asset('assets/icons/closeCircle.svg', width: 20, height: 20),
                          onPressed: onClosePress,
                        ),
                      ]
                    else
                      Icon(isExpanded ? Icons.expand_less : Icons.expand_more),
                  ],
                ),
              ),
            ),
            if (isExpanded)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    for (final field in fields)
                      _FieldEditor(
                        field: field,
                        formValues: formValues,
                        onChanged: onFieldChanged,
                        isEditing: isEditing,
                      ),
                    for (final def in sectionCustomFields)
                      _CustomFieldEditor(
                        definition: def,
                        value: customFieldValues[def.id],
                        onChanged: onCustomFieldChanged,
                        canEdit: isEditing &&
                            _canEditCustomField(def, isAdmin: isAdmin, isCounsellorForCall: isCounsellorForCall),
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

/// RN `formatDisplay` for the computed Call Duration / Date / Time fields;
/// null for every other field (shown as stored).
String? _computedDisplay(WidgetRef ref, String key, Object? value) {
  switch (key) {
    case 'callDuration':
      return formatSummaryCallDuration(value, ref.t);
    case 'callDate':
      final months =
          (ref.watch(localizationControllerProvider).value?.raw('months.full') as List<dynamic>?)
              ?.map((e) => '$e')
              .toList();
      if (months == null || months.length != 12) return null;
      final language = ref.read(localizationControllerProvider.notifier).currentLanguage;
      return formatSummaryCallDate(value, months: months, isEnglish: language.startsWith('en'));
    case 'callTime':
      final parts = value is String ? value.split(' - ') : const <String>[];
      return parts.length == 2 ? formatSummaryCallTime(parts[0], parts[1]) : '-';
  }
  return null;
}

class _FieldEditor extends ConsumerWidget {
  const _FieldEditor({
    required this.field,
    required this.formValues,
    required this.onChanged,
    required this.isEditing,
  });

  final SummaryFieldDef field;
  final Map<String, dynamic> formValues;
  final void Function(String fieldKey, dynamic value) onChanged;

  /// RN's `renderField`: a field only gets its editable control
  /// (`isEditing && field.isEditable` for an inline input,
  /// `isEditing` alone for a dropdown) while the section is in edit mode —
  /// otherwise it's always plain read-only text, same as a genuinely
  /// non-editable field like Call ID.
  final bool isEditing;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final value = formValues[field.key];
    final label = ref.t(_fieldLabelKeys[field.key] ?? field.label);

    if (!field.editable || !isEditing) {
      final display = _computedDisplay(ref, field.key, value) ??
          (value == null || value.toString().trim().isEmpty ? '—' : value.toString());
      return Padding(
        padding: const EdgeInsets.only(top: 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // RN's FieldRow styles.label: IBM_PLEX_SERIF.REGULAR +
            // typography.body.medium — bodyMedium already matches both
            // exactly; labelMedium would wrongly render it in Roboto.
            Text(label, style: Theme.of(context).textTheme.bodyMedium),
            Text(display),
          ],
        ),
      );
    }

    if (field.type == SummaryFieldType.searchableDropdown) {
      // RN `fieldRenderer` SearchableDropdown: the label, then the places
      // picker capped at 200 wide (`dropdownContainer`).
      return Padding(
        padding: const EdgeInsets.only(top: 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label, style: Theme.of(context).textTheme.bodyMedium),
            ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 200),
              child: SearchableLocationDropdown(
                key: ValueKey('location-${field.key}'),
                value: value?.toString() ?? '',
                onSelect: (selected) => onChanged(field.key, selected),
              ),
            ),
          ],
        ),
      );
    }

    if (field.type == SummaryFieldType.dropdown) {
      final options = field.options ?? const [];
      final currentValue = options.contains(value) ? value as String : null;
      return Padding(
        padding: const EdgeInsets.only(top: 8),
        child: DropdownButtonFormField<String>(
          initialValue: currentValue,
          // `labelText`, not `decorationFor`'s `placeholder`/hint — unlike a
          // one-shot input, this field's label must stay visible once a
          // value is picked, same as every other field in this long form.
          decoration: InputDecoration(
            labelText: label,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(8),
              borderSide: const BorderSide(color: AppColors.strokePrimary),
            ),
          ),
          items: [
            for (final option in options)
              DropdownMenuItem(
                value: option,
                child: Text(ref.t(_fieldOptionLabelKeys[option] ?? option)),
              ),
          ],
          onChanged: (selected) => onChanged(field.key, selected),
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: TextFormField(
        key: ValueKey(field.key),
        initialValue: value?.toString() ?? '',
        maxLines: field.type == SummaryFieldType.multilineText ? 4 : 1,
        decoration: InputDecoration(
          labelText: label,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(8),
            borderSide: const BorderSide(color: AppColors.strokePrimary),
          ),
        ),
        onChanged: (text) => onChanged(field.key, text),
      ),
    );
  }
}

/// Mirrors RN's `CustomFieldsSection` — one tenant-defined extra field,
/// rendered per its [CustomFieldDefinition.fieldType]. [value] is always the
/// raw stored string (see [CustomFieldValue]'s own doc comment on the
/// select-types' label-vs-id quirk this faithfully reproduces).
class _CustomFieldEditor extends ConsumerStatefulWidget {
  const _CustomFieldEditor({required this.definition, required this.value, required this.onChanged, required this.canEdit});

  final CustomFieldDefinition definition;
  final String? value;
  final void Function(String fieldDefinitionId, String? value)? onChanged;
  final bool canEdit;

  @override
  ConsumerState<_CustomFieldEditor> createState() => _CustomFieldEditorState();
}

class _CustomFieldEditorState extends ConsumerState<_CustomFieldEditor> {
  /// RN's `parseMultiSelectValue` — a MULTI_SELECT value is stored as a
  /// JSON-encoded array of option *labels*; a bare non-JSON string (an old
  /// single-select-shaped value, or simply malformed) is treated as a
  /// one-item selection instead of discarded.
  List<String> _parseMultiSelect(String? value) {
    if (value == null || value.isEmpty) return const [];
    try {
      final decoded = jsonDecode(value);
      return decoded is List ? decoded.map((e) => e.toString()).toList() : [value];
    } catch (_) {
      return [value];
    }
  }

  Future<void> _pickMultiSelect(List<String> options, List<String> selected) async {
    var draft = List<String>.from(selected);
    final result = await showModalBottomSheet<List<String>>(
      context: context,
      isScrollControlled: true,
      builder: (context) => StatefulBuilder(
        builder: (context, setSheetState) => SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                for (final option in options)
                  CheckboxListTile(
                    title: Text(option),
                    value: draft.contains(option),
                    onChanged: (checked) => setSheetState(() {
                      if (checked ?? false) {
                        draft.add(option);
                      } else {
                        draft.remove(option);
                      }
                    }),
                  ),
                AppButton(label: ref.t('common.done'), onPressed: () => Navigator.of(context).pop(draft)),
              ],
            ),
          ),
        ),
      ),
    );
    if (result != null) {
      widget.onChanged?.call(widget.definition.id, result.isEmpty ? null : jsonEncode(result));
    }
  }

  @override
  Widget build(BuildContext context) {
    final def = widget.definition;
    final value = widget.value;
    final label = def.name;

    if (!widget.canEdit) {
      final display = switch (def.fieldType) {
        CustomFieldType.boolean => value == 'true'
            ? ref.t('common.yes')
            : value == 'false'
            ? ref.t('common.no')
            : (value ?? '—'),
        CustomFieldType.multiSelect => _parseMultiSelect(value).isEmpty ? '—' : _parseMultiSelect(value).join(', '),
        // RN `formatCustomFieldDate`.
        CustomFieldType.date => formatCustomFieldDate(value),
        _ => value == null || value.trim().isEmpty ? '—' : value,
      };
      return Padding(
        padding: const EdgeInsets.only(top: 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label, style: Theme.of(context).textTheme.bodyMedium),
            Text(display),
          ],
        ),
      );
    }

    switch (def.fieldType) {
      case CustomFieldType.singleSelect:
        final options = def.sortedOptions.map((o) => o.label).toList();
        final currentValue = options.contains(value) ? value : null;
        return Padding(
          padding: const EdgeInsets.only(top: 8),
          child: DropdownButtonFormField<String>(
            initialValue: currentValue,
            decoration: InputDecoration(
              labelText: label,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(8),
                borderSide: const BorderSide(color: AppColors.strokePrimary),
              ),
            ),
            items: [for (final option in options) DropdownMenuItem(value: option, child: Text(option))],
            onChanged: (selected) => widget.onChanged?.call(def.id, selected),
          ),
        );

      case CustomFieldType.boolean:
        final currentValue = value == 'true' ? ref.t('common.yes') : value == 'false' ? ref.t('common.no') : null;
        return Padding(
          padding: const EdgeInsets.only(top: 8),
          child: DropdownButtonFormField<String>(
            initialValue: currentValue,
            decoration: InputDecoration(
              labelText: label,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(8),
                borderSide: const BorderSide(color: AppColors.strokePrimary),
              ),
            ),
            items: [
              DropdownMenuItem(value: ref.t('common.yes'), child: Text(ref.t('common.yes'))),
              DropdownMenuItem(value: ref.t('common.no'), child: Text(ref.t('common.no'))),
            ],
            onChanged: (selected) => widget.onChanged?.call(def.id, selected == ref.t('common.yes') ? 'true' : 'false'),
          ),
        );

      case CustomFieldType.multiSelect:
        final options = def.sortedOptions.map((o) => o.label).toList();
        final selected = _parseMultiSelect(value);
        return Padding(
          padding: const EdgeInsets.only(top: 8),
          child: InkWell(
            onTap: () => _pickMultiSelect(options, selected),
            child: InputDecorator(
              decoration: InputDecoration(
                labelText: label,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                  borderSide: const BorderSide(color: AppColors.strokePrimary),
                ),
              ),
              child: Text(selected.isEmpty ? '—' : selected.join(', ')),
            ),
          ),
        );

      case CustomFieldType.date:
      case CustomFieldType.number:
      case CustomFieldType.text:
        return Padding(
          padding: const EdgeInsets.only(top: 8),
          child: TextFormField(
            key: ValueKey(def.id),
            // RN `normalizeCustomFieldDate` for the edited DATE value.
            initialValue: def.fieldType == CustomFieldType.date ? (normalizeCustomFieldDate(value) ?? value ?? '') : value ?? '',
            keyboardType: def.fieldType == CustomFieldType.number ? TextInputType.number : TextInputType.text,
            decoration: InputDecoration(
              labelText: label,
              hintText: def.fieldType == CustomFieldType.date ? 'YYYY-MM-DD' : null,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(8),
                borderSide: const BorderSide(color: AppColors.strokePrimary),
              ),
            ),
            onChanged: (text) => widget.onChanged?.call(def.id, text.isEmpty ? null : text),
          ),
        );
    }
  }
}

/// Port of ally-mobile (React Native)'s `SummaryUnauthorized` — shown
/// instead of the generic error text when the summary fetch comes back
/// 403 (e.g. a call not owned/assigned to the viewer). Not a dedicated
/// permission check: RN's own `isUnauthorized` is purely "did this one
/// request come back 403."
class _SummaryUnauthorizedView extends ConsumerWidget {
  const _SummaryUnauthorizedView({required this.onGoBack});

  /// RN `SummaryUnauthorized onGoBack={handleGoBack}`.
  final VoidCallback onGoBack;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              Icons.lock_outline,
              size: 48,
              color: AppColors.mediumEmphasis,
            ),
            const SizedBox(height: 16),
            Text(
              ref.t('summary.notFoundTitle'),
              style: Theme.of(context).textTheme.titleMedium,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            Text(ref.t('summary.notFoundDesc'), textAlign: TextAlign.center),
            const SizedBox(height: 24),
            AppButton(
              label: ref.t('achievements.backAria'),
              onPressed: onGoBack,
            ),
          ],
        ),
      ),
    );
  }
}

