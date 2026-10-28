import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/cupertino.dart' show CupertinoActivityIndicator;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show SystemUiOverlayStyle;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/localization/localization_controller.dart';
import '../../../core/localization/translate_ref.dart';
import '../../../core/network/error_details.dart';
import '../../../core/permissions/permissions_repository.dart';
import '../../../core/permissions/user_permissions.dart';
import '../../../core/settings/settings_repository.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/theme/rn_scale.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/confirmation_modal.dart';
import '../../../core/widgets/custom_dropdown.dart';
import '../../../core/widgets/review_type_chip.dart';
import '../../../core/widgets/toast/toast_controller.dart';
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
import '../../simulations/presentation/widgets/feedback/feedback_popup.dart';
import 'call_summary_actions.dart';
import 'call_summary_header.dart';
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

/// RN `SECTION_LIST[].icon` (`src/constants/summary.ts`): each section's
/// own SVG, drawn at its intrinsic size like RN's `<Icon />`.
const _sectionIcons = <SummarySection, String>{
  SummarySection.featuresAndDemographics: 'assets/icons/callDetails.svg',
  SummarySection.sessionSummary: 'assets/icons/sessionSummary.svg',
  SummarySection.flow: 'assets/icons/flow.svg',
  SummarySection.keyConcern: 'assets/icons/keyConcern.svg',
  SummarySection.objectiveObservations: 'assets/icons/tableEye.svg',
  SummarySection.subjectiveObservations: 'assets/icons/magnifyEye.svg',
  SummarySection.assessment: 'assets/icons/assessment.svg',
  SummarySection.dominantFeelings: 'assets/icons/smile.svg',
  SummarySection.issuesWorkedOn: 'assets/icons/brightnessAlert.svg',
  SummarySection.keyTherapeuticTechniques: 'assets/icons/prescriptions.svg',
  SummarySection.referralsProvided: 'assets/icons/handShare.svg',
  SummarySection.homeworkRecommended: 'assets/icons/newsStand.svg',
  SummarySection.planForNextCall: 'assets/icons/headsetMic.svg',
  SummarySection.tags: 'assets/icons/tag.svg',
  SummarySection.metrics: 'assets/icons/database.svg',
  SummarySection.intake: 'assets/icons/intake.svg',
  SummarySection.ongoingRisks: 'assets/icons/ongoingRisks.svg',
  SummarySection.additionalNotes: 'assets/icons/notes.svg',
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

  /// The last `callInfo.summaryName` seen from the server. RN's
  /// `useEffect(() => { if (name) setSummaryName(name) }, [name])` only
  /// re-seeds the header when the fetched name *changes*, so a refetch that
  /// still carries the old name can't overwrite a rename (ledger S5).
  String? _lastFetchedSummaryName;

  void _onSummary(CallSummaryDetails summary) {
    final fetchedName = summary.summaryName;
    if (fetchedName != null && fetchedName.isNotEmpty && fetchedName != _lastFetchedSummaryName) {
      _lastFetchedSummaryName = fetchedName;
      _summaryName = fetchedName;
    }
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
            isEditNote: false,
            note: summary.reviewNote,
            contextDateTime: summary.startTime ?? summary.createdAt,
            // Raw seconds: the share screen formats it (RN formats once, in
            // `handleShareForReview`). Formatting here too gave "-".
            contextDuration: '${summary.callDuration ?? 0}',
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
      if (mounted) showToast(ref.tr('simulationPage.privacyUpdated'));
    } catch (_) {
      if (mounted) showToast(ref.tr('simulationPage.errorUpdatePrivacy'), type: ToastType.error);
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
      showToast(ref.tr('callFeedback.submitted'));
    } catch (_) {
      showToast(ref.tr('summaryLoading.summaryFeedbackSubmittedFailed'), type: ToastType.error);
    }
    if (!mounted) return;
    setState(() => _showFeedbackPopup = false);
    _handleGoBack();
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
          backgroundColor: Colors.white,
          // RN `styles.reviewIconButton`: a 56pt white circle with a 0.5pt
          // stroke and soft shadow holding the 20pt chatBubble icon, 20pt
          // in from the right (the Scaffold already insets FABs by 16).
          floatingActionButton: showReviewButton
              ? Padding(
                  padding: const EdgeInsets.only(right: 4, bottom: 4),
                  child: GestureDetector(
                    key: const Key('call-summary-view-review'),
                    onTap: () => _pushAndRefresh(
                      context.push(
                        '/reviews/${summary!.reviewId}',
                        extra: ReviewType.scribe,
                      ),
                    ),
                    child: Container(
                      width: 56,
                      height: 56,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: Colors.white,
                        shape: BoxShape.circle,
                        border: Border.all(color: AppColors.strokePrimary, width: 0.5),
                        boxShadow: const [
                          BoxShadow(color: Color(0x1AA09E9E), offset: Offset(8.52, 11.36), blurRadius: 14.2),
                        ],
                      ),
                      child: SvgPicture.asset('assets/icons/chatBubble.svg', width: 20, height: 20),
                    ),
                  ),
                )
              : null,
          body: AnnotatedRegion<SystemUiOverlayStyle>(
            value: SystemUiOverlayStyle.dark,
            child: SafeArea(
              bottom: false,
              child: Column(
                children: [
                  // RN `components/Header/Header.tsx`.
                  CallSummaryHeader(
                    title: ref.t('callSummary.header.title'),
                    subtitle: ref.t('callSummary.header.subtitle'),
                    summaryName: _summaryName,
                    onBackPress: _handleBackPress,
                    onMenuPress: chatId == null ? null : () => _showMenu(summary),
                    shareLabel: ref.t('learn.scenario.share'),
                    showShareSwitch: showShareSwitch,
                    isSharedForReview: summary?.isSharedForReview ?? false,
                    onShareToggle: showShareSwitch ? (value) => _handleShareToggle(value, summary) : null,
                  ),
                  // RN `renderTabBar` (react-native-tab-view `TabBar`).
                  CallSummaryTabBar(
                    labels: [
                      ref.t('postCallSummary.header.summary'),
                      if (showTranscriptTab) ref.t('summary.tabs.transcript'),
                    ],
                  ),
                  Expanded(
                    child: Stack(
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
                ],
              ),
            ),
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
    _dirtyFlag.dispose();
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

  /// Ticked only when [SummaryFormState.hasChanges] differs from what the
  /// Save button last rendered ([_saveButtonShownDirty]); the button
  /// listens to it so a keystroke doesn't rebuild the whole tab.
  final ValueNotifier<int> _dirtyFlag = ValueNotifier(0);
  bool _saveButtonShownDirty = false;

  /// Per-keystroke path for free-text inputs. Nothing on screen reads a
  /// text field's value back while it is being edited (the field owns its
  /// own text via `initialValue`), so only the Save button's visibility
  /// can change — record the value and update [_dirtyFlag] instead of
  /// `setState`, which rebuilt every section and field on each character.
  void _onFieldTyped(String fieldKey, dynamic value) {
    _form.set(fieldKey, value);
    if (_form.hasChanges != _saveButtonShownDirty) _dirtyFlag.value++;
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
      showToast(ref.tr('summary.enhanceFailed'), type: ToastType.error);
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

  /// Per-keystroke path for custom text/number/date inputs: custom fields
  /// never affect the global Save button and the field owns its own text,
  /// so nothing visible depends on this value until the section's tick —
  /// record it without rebuilding the tab.
  void _onCustomFieldTyped(String fieldDefinitionId, String? value) {
    _customFieldValues[fieldDefinitionId] = value;
    _dirtyCustomFieldIds.add(fieldDefinitionId);
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
        setState(
          () => _error = '${ref.tr('callSummary.info.summaryUpdateFailed')}: '
              '${getErrorDetails(e, t: ref.tr).message}',
        );
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
        showToast(ref.tr('summary.customFieldSaveFailed'), type: ToastType.error);
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
        if (result.success) {
          showToast(ref.tr('summaryLoading.retryStarted'));
        } else {
          showToast(result.message ?? ref.tr('summaryLoading.retryFailed'), type: ToastType.error);
        }
      }
    } catch (_) {
      if (mounted) {
        showToast(ref.tr('summaryLoading.retryFailed'), type: ToastType.error);
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

  /// RN `CallSummaryScreen.renderSummaryTab` over RTK Query's state: a
  /// failed refetch keeps the summary that already loaded (RTK keeps `data`
  /// on a rejected refetch), and a first load that fails with no data falls
  /// through to the progress view with "See if ready" / "Check later" — no
  /// bare error text. Only a 403 (`isUnauthorized`) gets its own view.
  @override
  Widget build(BuildContext context) {
    final summaryAsync = widget.summaryAsync;
    final error = summaryAsync.error;
    if (error is DioException && error.response?.statusCode == 403) {
      return _SummaryUnauthorizedView(onGoBack: widget.onGoBack);
    }
    if (!summaryAsync.hasValue) {
      // RN `isLoading` is the first load only (no data, no error yet).
      if (!summaryAsync.hasError) return const Center(child: CircularProgressIndicator());
      return _buildGenerating(null);
    }
    return _buildSummary(summaryAsync.value);
  }

  Widget _buildSummary(CallSummaryDetails? summary) {
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
    final sections = [
      for (final section in SummarySection.values)
        if (isSummarySectionVisible(section, visibleFields)) section,
    ];

    return Column(
      children: [
        if (widget.isManualNote)
          VoiceNoteSection(
            chatId: _chatId,
            onValuesApplied: _applyVoiceValues,
            onCustomValuesApplied: _reseedCustomFields,
            existingTranscript: summary.transcript,
          ),
        Expanded(
          // Builder, not `children:` — sections are only built as they
          // scroll in. Index 0 is the AI disclaimer banner.
          child: ListView.builder(
            // RN `contentContainer` paddingBottom 70; the banner and the
            // section card carry their own horizontal spacing.
            padding: const EdgeInsets.only(bottom: 70),
            itemCount: sections.length + 1,
            itemBuilder: (context, index) {
              final size = RnSize.of(context);
              if (index == 0) {
                // RN `CallSummaryDetails.tsx` `alertContainer`: the
                // AI-generated disclaimer above the section card, with
                // RN's goldenShield SVG in a carrotOrange ring.
                return Container(
                  margin: EdgeInsets.only(top: 10, left: size.s(10), right: size.s(10)),
                  padding: EdgeInsets.all(size.s(10)),
                  decoration: BoxDecoration(
                    color: AppColors.amber50,
                    borderRadius: BorderRadius.circular(size.s(8)),
                    border: Border.all(color: AppColors.orange400, width: 0.5),
                  ),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.center,
                    children: [
                      Container(
                        width: size.s(32),
                        height: size.s(32),
                        margin: EdgeInsets.only(right: size.s(10)),
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          border: Border.all(color: AppColors.carrotOrange, width: 0.5),
                        ),
                        child: SvgPicture.asset('assets/icons/goldenShield.svg', key: const Key('ai-warning-shield')),
                      ),
                      Expanded(
                        child: Text(
                          ref.t('callSummary.aiGeneratedWarning'),
                          style: const TextStyle(
                            fontFamily: AppFonts.ibmPlexSerifRegular,
                            fontSize: 12,
                            height: 16 / 12,
                            letterSpacing: 0.2,
                            color: AppColors.red700,
                          ),
                        ),
                      ),
                    ],
                  ),
                );
              }
              final section = sections[index - 1];
              // RN `styles.card`: paddingHorizontal 16@s, paddingTop 8.
              return Padding(
                padding: EdgeInsets.only(left: size.s(16), right: size.s(16), top: index == 1 ? 8 : 0),
                child: _SectionCard(
                key: ValueKey(section),
                section: section,
                visibleFields: visibleFields,
                formValues: _form.values,
                onFieldChanged: _onFieldChanged,
                onFieldTyped: _onFieldTyped,
                customFieldDefs: _customFieldDefs,
                customFieldValues: _customFieldValues,
                onCustomFieldChanged: _onCustomFieldChanged,
                onCustomFieldTyped: _onCustomFieldTyped,
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
              );
            },
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
        if (!widget.isFeedbackPopupVisible)
          ValueListenableBuilder<int>(
            valueListenable: _dirtyFlag,
            builder: (context, _, _) {
              final dirty = _saveButtonShownDirty = _hasDirtyChanges;
              if (!(widget.alwaysShowSave || dirty)) return const SizedBox.shrink();
              return SafeArea(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: AppButton(
                    label: ref.t('common.save'),
                    isLoading: _isSaving,
                    onPressed: _save,
                  ),
                ),
              );
            },
          ),
      ],
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
/// section is mid-edit). Layout per RN `SectionHeader.tsx`: a 10pt
/// arrowRight/arrowDown caret (hidden while editing), the section's own SVG
/// (`SECTION_LIST[].icon`), the IBM Plex Serif Medium title, and on the
/// right a 24pt circled pencil that swaps for wand/check/close once editing.
/// The section box is RN `SectionWrapper`'s `sectionBox` (0.5pt lightGray5
/// rule under every section but the last) or `sectionBoxEditing` (0.5pt
/// grey rounded box while expanded and editing).
class _SectionCard extends ConsumerWidget {
  const _SectionCard({
    super.key,
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
    this.onFieldTyped,
    this.onCustomFieldTyped,
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

  /// Per-keystroke variants of [onFieldChanged]/[onCustomFieldChanged] for
  /// free-text inputs (no full-tab rebuild); fall back to those when null.
  final void Function(String fieldKey, dynamic value)? onFieldTyped;
  final void Function(String fieldDefinitionId, String? value)? onCustomFieldTyped;
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
    final isLast = section == SummarySection.values.last;
    final BoxDecoration? box;
    if (isEditing && isExpanded) {
      box = BoxDecoration(
        border: Border.all(color: AppColors.rnGray, width: 0.5),
        borderRadius: BorderRadius.circular(16),
      );
    } else if (!isLast) {
      box = const BoxDecoration(border: Border(bottom: BorderSide(color: AppColors.lightGray5, width: 0.5)));
    } else {
      box = null;
    }

    return Container(
      margin: EdgeInsets.only(top: isEditing && isExpanded ? 8 : 0),
      decoration: box,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          GestureDetector(
            key: ValueKey('section-header-${section.name}'),
            behavior: HitTestBehavior.opaque,
            onTap: onToggle,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 14),
              child: Row(
                children: [
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.only(right: 10),
                      child: Row(
                        children: [
                          Padding(
                            padding: const EdgeInsets.only(right: 14),
                            child: isEditing
                                ? null
                                : SizedBox(
                                    width: 24,
                                    child: Center(
                                      child: SvgPicture.asset(
                                        isExpanded ? 'assets/icons/arrowDown.svg' : 'assets/icons/arrowRight.svg',
                                        key: ValueKey('section-caret-${section.name}'),
                                        width: 10,
                                        height: 10,
                                      ),
                                    ),
                                  ),
                          ),
                          Padding(
                            padding: const EdgeInsets.only(right: 8),
                            child: SvgPicture.asset(_sectionIcons[section]!),
                          ),
                          Expanded(
                            child: Padding(
                              padding: const EdgeInsets.only(left: 6),
                              child: Text(
                                ref.t(_sectionLabelKeys[section] ?? section.label),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  fontFamily: AppFonts.ibmPlexSerifMedium,
                                  fontSize: 14,
                                  height: 22 / 14,
                                  letterSpacing: 0.2,
                                  color: AppColors.highEmphasis,
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  if (isExpanded && canEdit)
                    if (!isEditing)
                      _HeaderIconButton(
                        buttonKey: ValueKey('section-edit-${section.name}'),
                        asset: 'assets/icons/editSquare.svg',
                        onTap: onEditPress,
                        margin: EdgeInsets.zero,
                      )
                    else ...[
                      if (section.canEnhance)
                        isEnhancing
                            ? const Padding(
                                padding: EdgeInsets.symmetric(horizontal: 4),
                                child: SizedBox(width: 24, height: 24, child: CupertinoActivityIndicator(radius: 8)),
                              )
                            : _HeaderIconButton(
                                buttonKey: ValueKey('section-wand-${section.name}'),
                                asset: 'assets/icons/wandStars.svg',
                                onTap: onWandPress,
                              ),
                      _HeaderIconButton(
                        buttonKey: ValueKey('section-tick-${section.name}'),
                        asset: 'assets/icons/check.svg',
                        onTap: onTickPress,
                      ),
                      _HeaderIconButton(
                        buttonKey: ValueKey('section-close-${section.name}'),
                        asset: 'assets/icons/closeCircle.svg',
                        onTap: onClosePress,
                      ),
                    ],
                ],
              ),
            ),
          ),
          if (isExpanded)
            // RN `styles.sectionContent`: paddingLeft 30.
            Padding(
              padding: const EdgeInsets.only(left: 30),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  for (final field in fields)
                    _FieldEditor(
                      field: field,
                      formValues: formValues,
                      onChanged: onFieldChanged,
                      onTyped: onFieldTyped ?? onFieldChanged,
                      isEditing: isEditing,
                      isEnhancing: isEnhancing,
                    ),
                  for (final def in sectionCustomFields)
                    _CustomFieldEditor(
                      definition: def,
                      value: customFieldValues[def.id],
                      onChanged: onCustomFieldChanged,
                      onTyped: onCustomFieldTyped ?? onCustomFieldChanged,
                      canEdit: isEditing &&
                          _canEditCustomField(def, isAdmin: isAdmin, isCounsellorForCall: isCounsellorForCall),
                    ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// RN `SectionHeader` `editButton` / `buttonContainer`: a 24pt circle with
/// a 0.3pt lightGray4 ring around the icon at its intrinsic size.
class _HeaderIconButton extends StatelessWidget {
  const _HeaderIconButton({
    required this.buttonKey,
    required this.asset,
    required this.onTap,
    this.margin = const EdgeInsets.symmetric(horizontal: 4),
  });

  final Key buttonKey;
  final String asset;
  final VoidCallback onTap;
  final EdgeInsets margin;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      key: buttonKey,
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: Container(
        width: 24,
        height: 24,
        margin: margin,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          border: Border.all(color: AppColors.lightGray4, width: 0.3),
        ),
        child: SvgPicture.asset(asset),
      ),
    );
  }
}

/// RN `FieldRow` `styles.label` (+ `:`), IBM Plex Serif body.medium, low
/// emphasis.
const _fieldRowLabelStyle = TextStyle(
  fontFamily: AppFonts.ibmPlexSerifRegular,
  fontSize: 14,
  height: 22 / 14,
  letterSpacing: 0.2,
  color: AppColors.lowEmphasis,
);

/// RN `commonStyles.fieldValueText`: IBM Plex Serif body.medium, medium
/// emphasis.
const _fieldValueTextStyle = TextStyle(
  fontFamily: AppFonts.ibmPlexSerifRegular,
  fontSize: 14,
  height: 22 / 14,
  letterSpacing: 0.2,
  color: AppColors.mediumEmphasis,
);

/// RN `Dropdown.tsx` `styles.itemText`.
const _dropdownItemTextStyle = TextStyle(
  fontFamily: AppFonts.ibmPlexSerifRegular,
  fontSize: 14,
  height: 22 / 14,
  letterSpacing: 0.2,
  color: AppColors.highEmphasis,
);

/// RN `FieldRow`: `Label:` then the value (or [edit], RN's `renderEdit`)
/// on one row, `marginBottom: 5@vs`.
class _FieldRow extends StatelessWidget {
  const _FieldRow({required this.label, required this.value, this.edit});

  final String label;
  final String value;
  final Widget? edit;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: RnSize.of(context).vs(5)),
      child: Row(
        children: [
          Padding(
            padding: const EdgeInsets.only(right: 8),
            child: Text('$label:', style: _fieldRowLabelStyle),
          ),
          edit ?? Expanded(child: Text(value, style: _fieldValueTextStyle)),
        ],
      ),
    );
  }
}

/// RN `fieldRenderer`'s `dropdownContainer` (`flex: 1, maxWidth: 200`)
/// holding a `CustomDropdown`, whose header hugs its own content.
class _SummaryDropdown extends StatelessWidget {
  const _SummaryDropdown({
    super.key,
    required this.value,
    required this.options,
    required this.onSelect,
    required this.placeholder,
  });

  final String value;
  final List<String> options;
  final ValueChanged<String> onSelect;

  /// RN `placeholder` (`Select` by default), shown in `charcoal2` at 0.5
  /// opacity while there's no value.
  final String placeholder;

  @override
  Widget build(BuildContext context) {
    final isEmpty = value.isEmpty;
    return Flexible(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 200),
        child: Align(
          alignment: Alignment.centerLeft,
          child: CustomDropdown(
            value: isEmpty ? placeholder : value,
            options: options,
            onSelect: onSelect,
            alignRight: false,
            headerTextStyle: isEmpty
                ? _fieldValueTextStyle.copyWith(color: AppColors.charcoal2.withValues(alpha: 0.5))
                : _fieldValueTextStyle,
            itemTextStyle: _dropdownItemTextStyle,
          ),
        ),
      ),
    );
  }
}

/// A text input that owns a [TextEditingController] and re-syncs it when
/// the value it's given changes from outside (the AI wand, voice dictation,
/// a reseed) — RN's controlled `TextInput value={...}`. Keystrokes only
/// report through [onChanged]; the parent records them without a rebuild,
/// so on any later rebuild the incoming value already equals the
/// controller's text and nothing is touched.
class _SyncedTextField extends StatefulWidget {
  const _SyncedTextField({
    super.key,
    required this.value,
    required this.onChanged,
    required this.style,
    this.hintText,
    this.multiline = false,
    this.autofocus = false,
    this.keyboardType,
    this.textCapitalization = TextCapitalization.sentences,
  });

  final String value;
  final ValueChanged<String> onChanged;
  final TextStyle style;
  final String? hintText;
  final bool multiline;
  final bool autofocus;
  final TextInputType? keyboardType;
  final TextCapitalization textCapitalization;

  @override
  State<_SyncedTextField> createState() => _SyncedTextFieldState();
}

class _SyncedTextFieldState extends State<_SyncedTextField> {
  late final TextEditingController _controller = TextEditingController(text: widget.value);

  @override
  void didUpdateWidget(covariant _SyncedTextField oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.value != _controller.text) {
      _controller.value = TextEditingValue(
        text: widget.value,
        selection: TextSelection.collapsed(offset: widget.value.length),
      );
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: _controller,
      autofocus: widget.autofocus,
      style: widget.style,
      maxLines: widget.multiline ? null : 1,
      keyboardType: widget.keyboardType ?? (widget.multiline ? TextInputType.multiline : TextInputType.text),
      textInputAction: widget.multiline ? TextInputAction.newline : TextInputAction.done,
      textCapitalization: widget.textCapitalization,
      decoration: InputDecoration.collapsed(
        hintText: widget.hintText,
        hintStyle: widget.style.copyWith(color: AppColors.lightGray3),
      ),
      onChanged: widget.onChanged,
    );
  }
}

/// RN `EditableField.tsx`: the multiline value with no label — a
/// scrollable (max 200) lightGray3 text, or while editing a focused
/// multiline input; both pulse while the wand is enhancing.
class _EditableField extends StatelessWidget {
  const _EditableField({
    required this.fieldKey,
    required this.value,
    required this.onChanged,
    required this.isEditing,
    this.isEnhancing = false,
    this.placeholder = '-',
    this.keyboardType,
  });

  final String fieldKey;
  final String? value;
  final ValueChanged<String> onChanged;
  final bool isEditing;
  final bool isEnhancing;
  final String placeholder;
  final TextInputType? keyboardType;

  @override
  Widget build(BuildContext context) {
    final Widget child;
    if (isEditing) {
      child = Padding(
        padding: const EdgeInsets.only(right: 20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxHeight: 200),
          child: _SyncedTextField(
            key: ValueKey(fieldKey),
            value: value ?? '',
            onChanged: onChanged,
            multiline: true,
            autofocus: true,
            keyboardType: keyboardType,
            style: _dropdownItemTextStyle,
          ),
        ),
      );
    } else {
      child = ConstrainedBox(
        constraints: const BoxConstraints(maxHeight: 200),
        child: SingleChildScrollView(
          child: Text(
            value != null && value!.isNotEmpty ? value! : placeholder,
            style: TextStyle(
              fontFamily: AppFonts.ibmPlexSerifRegular,
              fontSize: 14,
              height: RnSize.of(context).mvs(20) / 14,
              color: AppColors.lightGray3,
            ),
          ),
        ),
      );
    }
    return Padding(
      padding: EdgeInsets.only(bottom: RnSize.of(context).vs(16)),
      child: _Pulse(active: isEnhancing, child: child),
    );
  }
}

/// RN `EditableField`'s enhancing animation: opacity 1 → 0.5 → 1 every
/// 800ms while [active]; back to 1 when it stops.
class _Pulse extends StatefulWidget {
  const _Pulse({required this.active, required this.child});

  final bool active;
  final Widget child;

  @override
  State<_Pulse> createState() => _PulseState();
}

class _PulseState extends State<_Pulse> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 800),
    value: 1,
    lowerBound: 0.5,
  );

  @override
  void initState() {
    super.initState();
    _sync();
  }

  @override
  void didUpdateWidget(covariant _Pulse oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.active != widget.active) _sync();
  }

  void _sync() {
    if (widget.active) {
      _controller.repeat(reverse: true);
    } else {
      _controller.animateTo(1, duration: const Duration(milliseconds: 300));
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => FadeTransition(opacity: _controller, child: widget.child);
}

/// RN's InlineTextInput placeholders (`summary.ts` `placeholder:
/// 'Add note'`); every other inline field falls back to `Enter detail`.
const _addNotePlaceholderKeys = {
  'intakeNotes',
  'riskSelfHarmNotes',
  'riskSuicidalThoughtsNotes',
  'riskRunningAwayNotes',
  'traumaNotes',
  'assessmentPsychologicalDiagnosisNotes',
  'assessmentUseOfPsychotropicMedicationsNotes',
  'assessmentHallucinationsNotes',
  'ongoingRiskSelfHarmNotes',
  'ongoingRiskSuicidalThoughtsNotes',
};


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

/// RN `fieldRenderer.renderField` for one built-in summary field.
class _FieldEditor extends ConsumerWidget {
  const _FieldEditor({
    required this.field,
    required this.formValues,
    required this.onChanged,
    required this.onTyped,
    required this.isEditing,
    this.isEnhancing = false,
  });

  final SummaryFieldDef field;
  final Map<String, dynamic> formValues;
  final void Function(String fieldKey, dynamic value) onChanged;

  /// Free-text keystrokes (see `_SummaryTabState._onFieldTyped`).
  final void Function(String fieldKey, dynamic value) onTyped;

  /// RN's `renderField`: a field only gets its editable control
  /// (`isEditing && field.isEditable` for an inline input,
  /// `isEditing` alone for a dropdown) while the section is in edit mode —
  /// otherwise it's always plain read-only text, same as a genuinely
  /// non-editable field like Call ID.
  final bool isEditing;
  final bool isEnhancing;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final value = formValues[field.key];
    final label = ref.t(_fieldLabelKeys[field.key] ?? field.label);
    // RN `formatFieldValue`: the field's own formatter, else `-` for null.
    final display = _computedDisplay(ref, field.key, value) ?? (value == null ? '-' : value.toString());

    switch (field.type) {
      case SummaryFieldType.text:
        return _FieldRow(label: label, value: display);

      case SummaryFieldType.inlineText:
        return _FieldRow(
          label: label,
          value: display,
          edit: isEditing && field.editable
              ? Flexible(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 200),
                    child: Padding(
                      padding: const EdgeInsets.only(right: 10),
                      child: _SyncedTextField(
                        key: ValueKey(field.key),
                        value: value?.toString() ?? '',
                        onChanged: (text) => onTyped(field.key, text),
                        hintText: _addNotePlaceholderKeys.contains(field.key) ? 'Add note' : 'Enter detail',
                        textCapitalization: TextCapitalization.words,
                        style: _fieldValueTextStyle.copyWith(color: AppColors.highEmphasis),
                      ),
                    ),
                  ),
                )
              : null,
        );

      case SummaryFieldType.multilineText:
        return _EditableField(
          fieldKey: field.key,
          value: value is String ? value : value?.toString(),
          onChanged: (text) => onTyped(field.key, text),
          isEditing: isEditing && field.editable,
          isEnhancing: isEnhancing,
        );

      case SummaryFieldType.dropdown:
        final options = field.options ?? const <String>[];
        String labelFor(String option) => ref.t(_fieldOptionLabelKeys[option] ?? option);
        return _FieldRow(
          label: label,
          value: display,
          edit: isEditing
              ? _SummaryDropdown(
                  key: ValueKey('dropdown-${field.key}'),
                  value: value is String && value.isNotEmpty ? labelFor(value) : '',
                  options: [for (final option in options) labelFor(option)],
                  placeholder: 'Select',
                  onSelect: (selected) {
                    final option = options.firstWhere((o) => labelFor(o) == selected, orElse: () => selected);
                    onChanged(field.key, option);
                  },
                )
              : null,
        );

      case SummaryFieldType.searchableDropdown:
        // RN `fieldRenderer` SearchableDropdown: the places picker in the
        // same 200-wide `dropdownContainer`.
        return _FieldRow(
          label: label,
          value: display,
          edit: isEditing
              ? Flexible(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 200),
                    child: SearchableLocationDropdown(
                      key: ValueKey('location-${field.key}'),
                      value: value?.toString() ?? '',
                      onSelect: (selected) => onChanged(field.key, selected),
                    ),
                  ),
                )
              : null,
        );
    }
  }
}

/// Mirrors RN's `CustomFieldsSection` — one tenant-defined extra field,
/// rendered per its [CustomFieldDefinition.fieldType]. [value] is always the
/// raw stored string (see [CustomFieldValue]'s own doc comment on the
/// select-types' label-vs-id quirk this faithfully reproduces).
class _CustomFieldEditor extends ConsumerWidget {
  const _CustomFieldEditor({
    required this.definition,
    required this.value,
    required this.onChanged,
    required this.canEdit,
    this.onTyped,
  });

  final CustomFieldDefinition definition;
  final String? value;
  final void Function(String fieldDefinitionId, String? value)? onChanged;

  /// Free-text keystrokes (see `_SummaryTabState._onCustomFieldTyped`).
  final void Function(String fieldDefinitionId, String? value)? onTyped;

  /// RN `isEditing && fieldIsEditable`.
  final bool canEdit;

  /// RN's `parseMultiSelectValue` — a MULTI_SELECT value is stored as a
  /// JSON-encoded array of option *labels*; a bare non-JSON string (an old
  /// single-select-shaped value, or simply malformed) is treated as a
  /// one-item selection instead of discarded.
  static List<String> _parseMultiSelect(String? value) {
    if (value == null || value.isEmpty) return const [];
    try {
      final decoded = jsonDecode(value);
      return decoded is List ? decoded.map((e) => e.toString()).toList() : [value];
    } catch (_) {
      return [value];
    }
  }

  Future<void> _pickMultiSelect(BuildContext context, List<String> options, List<String> selected) async {
    final result = await showDialog<List<String>>(
      context: context,
      barrierColor: const Color(0x66000000),
      builder: (context) => _MultiSelectModal(options: options, selected: selected),
    );
    if (result != null) {
      onChanged?.call(definition.id, result.isEmpty ? null : jsonEncode(result));
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final def = definition;
    final label = def.name;
    void typed(String text) => (onTyped ?? onChanged)?.call(def.id, text.isEmpty ? null : text);

    switch (def.fieldType) {
      case CustomFieldType.text:
      case CustomFieldType.number:
        return _FieldRow(
          label: label,
          value: value ?? '-',
          edit: canEdit
              ? Expanded(
                  child: _EditableField(
                    fieldKey: def.id,
                    value: value,
                    onChanged: typed,
                    isEditing: true,
                    keyboardType: def.fieldType == CustomFieldType.number ? TextInputType.number : null,
                  ),
                )
              : null,
        );

      case CustomFieldType.date:
        return _FieldRow(
          label: label,
          // RN `formatCustomFieldDate`.
          value: formatCustomFieldDate(value),
          edit: canEdit
              ? Expanded(
                  child: _EditableField(
                    fieldKey: def.id,
                    // RN `normalizeCustomFieldDate` for the edited value.
                    value: normalizeCustomFieldDate(value) ?? value,
                    onChanged: typed,
                    isEditing: true,
                    placeholder: 'YYYY-MM-DD',
                  ),
                )
              : null,
        );

      case CustomFieldType.singleSelect:
        final options = def.sortedOptions.map((o) => o.label).toList();
        return _FieldRow(
          label: label,
          value: value ?? '-',
          edit: canEdit
              ? _SummaryDropdown(
                  key: ValueKey('dropdown-${def.id}'),
                  value: value ?? '',
                  options: options,
                  placeholder: ref.t('common.select'),
                  onSelect: (selected) => onChanged?.call(def.id, selected),
                )
              : null,
        );

      case CustomFieldType.boolean:
        final yes = ref.t('common.yes');
        final no = ref.t('common.no');
        final display = value == 'true' ? yes : value == 'false' ? no : (value ?? '-');
        return _FieldRow(
          label: label,
          value: display,
          edit: canEdit
              ? _SummaryDropdown(
                  key: ValueKey('dropdown-${def.id}'),
                  value: display == '-' ? '' : display,
                  options: [yes, no],
                  placeholder: ref.t('common.select'),
                  onSelect: (selected) => onChanged?.call(def.id, selected == yes ? 'true' : 'false'),
                )
              : null,
        );

      case CustomFieldType.multiSelect:
        final options = def.sortedOptions.map((o) => o.label).toList();
        final selected = _parseMultiSelect(value);
        final display = selected.isEmpty ? '-' : selected.join(', ');
        return _FieldRow(
          label: label,
          value: display,
          edit: canEdit
              ? Expanded(
                  child: GestureDetector(
                    key: ValueKey('multiselect-${def.id}'),
                    behavior: HitTestBehavior.opaque,
                    onTap: () => _pickMultiSelect(context, options, selected),
                    child: Text(display, style: _dropdownItemTextStyle),
                  ),
                )
              : null,
        );
    }
  }
}

/// RN `CustomFieldsSection`'s `MultiSelectModal`: a centred white card (80%
/// wide, radius 12) of square checkboxes over a 40% black scrim, with a
/// dark Done button.
class _MultiSelectModal extends ConsumerStatefulWidget {
  const _MultiSelectModal({required this.options, required this.selected});

  final List<String> options;
  final List<String> selected;

  @override
  ConsumerState<_MultiSelectModal> createState() => _MultiSelectModalState();
}

class _MultiSelectModalState extends ConsumerState<_MultiSelectModal> {
  late final List<String> _selected = List.of(widget.selected);

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width * 0.8;
    return Center(
      child: Material(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          width: width,
          constraints: const BoxConstraints(maxHeight: 400),
          padding: const EdgeInsets.all(16),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (final option in widget.options)
                  GestureDetector(
                    behavior: HitTestBehavior.opaque,
                    onTap: () => setState(() {
                      _selected.contains(option) ? _selected.remove(option) : _selected.add(option);
                    }),
                    child: Container(
                      padding: const EdgeInsets.symmetric(vertical: 10),
                      decoration: const BoxDecoration(
                        border: Border(bottom: BorderSide(color: AppColors.lightGray5, width: 0.5)),
                      ),
                      child: Row(
                        children: [
                          Container(
                            width: 18,
                            height: 18,
                            margin: const EdgeInsets.only(right: 10),
                            decoration: BoxDecoration(
                              color: _selected.contains(option) ? AppColors.darkSlate : null,
                              borderRadius: BorderRadius.circular(4),
                              border: Border.all(
                                color: _selected.contains(option) ? AppColors.darkSlate : AppColors.rnGray,
                                width: 1.5,
                              ),
                            ),
                          ),
                          Expanded(child: Text(option, style: _dropdownItemTextStyle)),
                        ],
                      ),
                    ),
                  ),
                Align(
                  alignment: Alignment.centerRight,
                  child: GestureDetector(
                    key: const Key('multiselect-done'),
                    onTap: () => Navigator.of(context).pop(_selected),
                    child: Container(
                      margin: const EdgeInsets.only(top: 12),
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                      decoration: BoxDecoration(color: AppColors.darkSlate, borderRadius: BorderRadius.circular(8)),
                      // RN `typography.label.medium`, system font.
                      child: Text(
                        ref.t('common.done'),
                        style: const TextStyle(
                          fontFamily: 'CupertinoSystemText',
                          fontSize: 12,
                          height: 20 / 12,
                          letterSpacing: 0.2,
                          color: Colors.white,
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
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
    // RN `SummaryUnauthorized.tsx`: the summaryFailed.png illustration,
    // a 24pt IBM Plex Serif Medium title, a 16pt darkGray2 subtitle and a
    // 70%-wide Back button.
    return LayoutBuilder(
      builder: (context, constraints) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 24),
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Image.asset('assets/images/summaryFailed.png', key: const Key('summary-unauthorized-image')),
              Padding(
                padding: const EdgeInsets.only(top: 24),
                child: Text(
                  ref.t('summary.notFoundTitle'),
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontFamily: AppFonts.ibmPlexSerifMedium,
                    fontSize: 24,
                    height: RnSize.of(context).mvs(32) / 24,
                    color: AppColors.darkSlate,
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.only(top: 8, bottom: 24),
                child: Text(
                  ref.t('summary.notFoundDesc'),
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontFamily: AppFonts.ibmPlexSerifRegular,
                    fontSize: 16,
                    height: RnSize.of(context).mvs(24) / 16,
                    color: AppColors.darkGray2,
                  ),
                ),
              ),
              SizedBox(
                width: (constraints.maxWidth - 48) * 0.7,
                child: AppButton(label: ref.t('achievements.backAria'), onPressed: onGoBack),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

