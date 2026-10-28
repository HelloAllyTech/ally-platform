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
import '../../../core/widgets/root_scaffold_messenger.dart';
import '../../account/data/account_repository.dart';
import '../../reactions/data/reactions_repository.dart';
import '../../reviews/data/scribe_reviews_repository.dart';
import '../data/call_log_repository.dart';
import '../data/call_summary_fields.dart';
import '../data/custom_fields_repository.dart';
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

/// Scoped port of ally-mobile (React Native)'s `CallSummaryScreen` — the
/// full structured clinical documentation form (`summaryFieldDefs`,
/// ported from `src/constants/summary.ts`'s `SECTION_LIST`/`summaryFields`:
/// demographics, flow, key concerns, observations, assessment, intake/risk
/// screening, ongoing risks, and more), editable and saved back via
/// `updateCallSummary`, plus the real message-by-message transcript.
///
/// The header's share toggle (creating/toggling the visibility of a scribe
/// review — a genuinely separate backend resource from simulation reviews,
/// see `ScribeReviewsRepository`'s own doc comment), 3-dot menu
/// (rename/data-policy-link/archive), and the floating "view review"
/// button (gated the same way RN's `useHideReviewDetails` does: a private
/// review with no threads or reactions stays hidden) are now wired too.
///
/// Not ported: AI-enhance per section, export (needs platform storage
/// permissions + a file-save flow — a different, device-dependent kind of
/// risk from the rest of this screen), delete (RN reaches it from inside
/// the rename modal rather than the menu itself, and it's destructive
/// enough to deserve its own careful pass), tag *ratings* (as opposed to
/// tag names, which are editable here), the Ask-AI chat, and the
/// separately backend-configurable "custom fields" system.
class CallSummaryScreen extends ConsumerStatefulWidget {
  const CallSummaryScreen({
    super.key,
    required this.log,
    this.now = DateTime.now,
  });

  final CallLogItem log;

  /// Injectable clock, so tests can fast-forward past the 30s
  /// back-press-feedback-prompt threshold without a real wall-clock wait.
  final DateTime Function() now;

  @override
  ConsumerState<CallSummaryScreen> createState() => _CallSummaryScreenState();
}

class _CallSummaryScreenState extends ConsumerState<CallSummaryScreen> {
  late final DateTime _mountTime;
  bool _showFeedbackPopup = false;

  /// Mirrors RN's `useHideReviewDetails`'s `hideReviewDetails` state
  /// (initial value `true`, same as there) — whether the floating "view
  /// review" button should stay hidden because the review is private AND
  /// has no threads/reactions worth surfacing yet.
  bool _hideReviewDetails = true;

  /// Guards the async visibility check so it only re-runs when the
  /// review's identity or privacy actually changes, not on every rebuild.
  String? _hideReviewDetailsCheckedFor;

  @override
  void initState() {
    super.initState();
    // Captured eagerly here, not via a lazy `late` initializer — this must
    // be the real mount moment, not whenever `_mountTime` happens to be
    // first read (which is only on back-press, long after mount).
    _mountTime = widget.now();
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
      final threads = await ref
          .read(scribeReviewsRepositoryProvider)
          .getThreads(reviewId, limit: 1);
      if (threads.threads.isNotEmpty) {
        if (mounted) setState(() => _hideReviewDetails = false);
        return;
      }
      final reactions = await ref
          .read(scribeReactionsRepositoryProvider)
          .getReactionsCount(reviewId);
      if (mounted) setState(() => _hideReviewDetails = reactions.isEmpty);
    } catch (_) {
      // RN only logs this (console.error) and leaves the prior value in
      // place — matched by simply not updating state here.
    }
  }

  /// Mirrors RN's `handleShareToggle`: turning the switch ON when there's
  /// no review yet, or one was created within the last 10 minutes, opens
  /// the share/edit-note screen instead of silently flipping a status (a
  /// very-fresh review's note is still worth reviewing before it goes
  /// live). Any other toggle — ON for an older review, or OFF at all —
  /// just flips the review's visibility directly.
  Future<void> _handleShareToggle(bool isEnabled, CallSummaryDetails summary) async {
    final reviewId = summary.reviewId;
    final createdAt = summary.reviewCreatedAt;
    final recentlyCreated = createdAt != null && !_isMinutesPassed(createdAt);
    if (isEnabled && (reviewId == null || recentlyCreated)) {
      await context.push<void>(
        '/share-for-review/${widget.log.id}',
        extra: (
          reviewId: reviewId,
          note: summary.reviewNote,
          contextDateTime: null,
          contextDuration: null,
          isScribe: true,
          contextTitle: widget.log.sessionName,
        ),
      );
      ref.invalidate(callSummaryProvider(widget.log.id));
      return;
    }
    if (reviewId == null) return;
    try {
      await ref
          .read(scribeReviewsRepositoryProvider)
          .updateReviewStatus(
            reviewId: reviewId,
            status: isEnabled ? 'IN_REVIEW' : 'HIDDEN',
          );
      if (mounted) {
        rootScaffoldMessengerKey.currentState?.showSnackBar(
          SnackBar(content: Text(ref.tr('simulationPage.privacyUpdated'))),
        );
      }
    } catch (_) {
      if (mounted) {
        rootScaffoldMessengerKey.currentState?.showSnackBar(
          SnackBar(content: Text(ref.tr('simulationPage.errorUpdatePrivacy'))),
        );
      }
    } finally {
      ref.invalidate(callSummaryProvider(widget.log.id));
    }
  }

  Future<void> _showRenameDialog(String currentName) async {
    final controller = TextEditingController(text: currentName);
    final newName = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(ref.t('callSummary.info.rename')),
        content: TextField(controller: controller, autofocus: true),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: Text(ref.t('common.cancel')),
          ),
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(controller.text.trim()),
            child: Text(ref.t('common.save')),
          ),
        ],
      ),
    );
    if (newName == null || newName.isEmpty) return;
    try {
      await ref.read(callLogRepositoryProvider).updateSummaryName(widget.log.id, newName);
      ref.invalidate(callSummaryProvider(widget.log.id));
      if (mounted) {
        rootScaffoldMessengerKey.currentState?.showSnackBar(
          SnackBar(content: Text(ref.tr('callSummary.info.summaryNameUpdateSuccess'))),
        );
      }
    } catch (_) {
      if (mounted) {
        rootScaffoldMessengerKey.currentState?.showSnackBar(
          SnackBar(content: Text(ref.tr('callSummary.info.summaryNameUpdateFailed'))),
        );
      }
    }
  }

  Future<void> _handleArchiveToggle(bool currentlyArchived) async {
    final action = currentlyArchived ? 'unarchive' : 'archive';
    final confirmed = await ConfirmationModal.show(
      context,
      title: ref.t('callSummary.archiveActionModal.$action.header.title'),
      subtitle: ref.t('callSummary.archiveActionModal.$action.header.subtitle'),
      description: ref.t('callSummary.archiveActionModal.$action.description'),
      confirmLabel: ref.t('callSummary.archiveActionModal.$action.confirm'),
      cancelLabel: ref.t('callSummary.archiveActionModal.$action.cancel'),
      confirmVariant: currentlyArchived ? AppButtonVariant.primary : AppButtonVariant.destructive,
    );
    if (confirmed != true) return;
    try {
      await ref
          .read(callLogRepositoryProvider)
          .archiveCallLog(widget.log.id, archive: !currentlyArchived);
      ref.invalidate(callSummaryProvider(widget.log.id));
      if (mounted) {
        rootScaffoldMessengerKey.currentState?.showSnackBar(
          SnackBar(content: Text(ref.tr('callSummary.archiveActionModal.$action.success'))),
        );
      }
    } catch (_) {
      if (mounted) {
        rootScaffoldMessengerKey.currentState?.showSnackBar(
          SnackBar(content: Text(ref.tr('callSummary.archiveActionModal.$action.failed'))),
        );
      }
    }
  }

  /// Mirrors RN's `onBackNavigation` — a summary that's already visible,
  /// generated by AI (not a hand-filled manual note), without feedback
  /// already given, held by someone with edit permission, and at least 30s
  /// into viewing it, re-surfaces a rating prompt instead of leaving
  /// silently. Everything else just leaves.
  Future<void> _handleBackPress() async {
    final summary = ref.read(callSummaryProvider(widget.log.id)).value;
    final permissions =
        ref.read(userPermissionsProvider).value ?? const <String>[];
    final elapsed = widget.now().difference(_mountTime);
    final shouldPrompt =
        summary != null &&
        summary.isSummaryAvailable &&
        !summary.isManualNote &&
        !summary.isSummaryFeedbackAdded &&
        permissions.contains(UserPermissions.editSummaryFeedback) &&
        elapsed >= const Duration(seconds: 30);
    if (shouldPrompt) {
      setState(() => _showFeedbackPopup = true);
      return;
    }
    if (mounted) context.pop();
  }

  void _dismissFeedback() {
    setState(() => _showFeedbackPopup = false);
    context.pop();
  }

  Future<void> _submitFeedback(int rating, String comment) async {
    try {
      await ref
          .read(callLogRepositoryProvider)
          .addSummaryFeedback(
            chatId: widget.log.id,
            rating: rating,
            comment: comment,
          );
      rootScaffoldMessengerKey.currentState?.showSnackBar(
        SnackBar(content: Text(ref.tr('callFeedback.submitted'))),
      );
    } catch (_) {
      rootScaffoldMessengerKey.currentState?.showSnackBar(
        SnackBar(
          content: Text(
            ref.tr('summaryLoading.summaryFeedbackSubmittedFailed'),
          ),
        ),
      );
    }
    if (mounted) {
      setState(() => _showFeedbackPopup = false);
      context.pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    final summaryAsync = ref.watch(callSummaryProvider(widget.log.id));
    final messagesAsync = ref.watch(chatMessagesProvider(widget.log.id));
    // Warms the cache so `_handleBackPress`'s `ref.read` (fired once, on
    // back-press) sees an already-resolved value instead of the still-
    // loading state a cold first `read` of a `FutureProvider` returns.
    final permissions = ref.watch(userPermissionsProvider).value ?? const <String>[];

    // One-time-per-identity visibility check for the floating "view review"
    // button — mirrors RN's `useEffect([reviewId, isPrivate, ...])` in
    // `useHideReviewDetails`.
    ref.listen(callSummaryProvider(widget.log.id), (previous, next) {
      final summary = next.value;
      final reviewId = summary?.reviewId;
      if (reviewId == null) return;
      final isPrivate = summary!.reviewStatus == 'HIDDEN';
      final key = '$reviewId|$isPrivate';
      if (_hideReviewDetailsCheckedFor == key) return;
      _hideReviewDetailsCheckedFor = key;
      _checkHideReviewDetails(reviewId, isPrivate);
    });

    final summary = summaryAsync.value;
    final showShareSwitch =
        summary != null &&
        summary.isSummaryAvailable &&
        summary.summaryStatus == 'SUCCESS' &&
        summary.hasTranscript &&
        !summary.isArchived;
    final hasScribeReviewPermission = permissions.contains(UserPermissions.viewScribeReview);
    final showReviewButton =
        summary?.reviewId != null &&
        !_hideReviewDetails &&
        hasScribeReviewPermission &&
        !(summary?.isArchived ?? false);

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) {
        if (!didPop) _handleBackPress();
      },
      child: DefaultTabController(
        length: 2,
        child: Scaffold(
          appBar: AppBar(
            // Mirrors RN's `Header.tsx`: a plain white header, not the blue
            // chrome this screen inherited from Flutter's global
            // `AppBarTheme` default. RN never uses a blue header anywhere —
            // `RootNavigator` sets `headerShown: false` globally and every
            // screen builds its own white custom header instead.
            backgroundColor: Colors.white,
            foregroundColor: AppColors.highEmphasis,
            elevation: 0,
            // `PopScope(canPop: false)` makes `ModalRoute.canPop` report
            // false, which would otherwise make `AppBar` hide its
            // auto-implied back button entirely (it assumes "can't pop" ==
            // "nothing to go back to") — an explicit `leading` keeps the
            // back arrow visible and routes it through the same
            // interception as the system back gesture.
            leading: IconButton(
              icon: const BackButtonIcon(),
              tooltip: MaterialLocalizations.of(context).backButtonTooltip,
              onPressed: _handleBackPress,
            ),
            // "Session" (regular) + "Summary" (bold italic) title, then the
            // real session code as a muted subtitle — `widget.log.sessionName`
            // is RN's `callInfo.summaryName` (e.g. "CALL-1774-2026-07-16"),
            // prefixed with "#" exactly like `Header.tsx`'s
            // `summaryName ? '#'+summaryName : '-'`.
            title: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                RichText(
                  text: TextSpan(
                    style: Theme.of(context).textTheme.titleLarge
                        ?.copyWith(color: AppColors.highEmphasis),
                    children: [
                      TextSpan(text: '${ref.t('callSummary.header.title')} '),
                      TextSpan(
                        text: ref.t('callSummary.header.subtitle'),
                        style: const TextStyle(
                          fontStyle: FontStyle.italic,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
                Text(
                  widget.log.sessionName != null
                      ? '#${widget.log.sessionName}'
                      : '-',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.bodyMedium
                      ?.copyWith(color: AppColors.mediumEmphasis),
                ),
              ],
            ),
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
              if (summary != null)
                PopupMenuButton<String>(
                  onSelected: (value) {
                    switch (value) {
                      case 'rename':
                        _showRenameDialog(widget.log.sessionName ?? '');
                      case 'dataPolicy':
                        launchUrl(
                          Uri.parse(_privacyPolicyUrl),
                          mode: LaunchMode.externalApplication,
                        );
                      case 'archive':
                        _handleArchiveToggle(summary.isArchived);
                    }
                  },
                  itemBuilder: (context) => [
                    PopupMenuItem(
                      value: 'rename',
                      child: Text(ref.t('callSummary.info.rename')),
                    ),
                    PopupMenuItem(
                      value: 'dataPolicy',
                      child: Text(ref.t('callSummary.customMenu.dataPolicy')),
                    ),
                    PopupMenuItem(
                      value: 'archive',
                      child: Text(
                        ref.t(
                          summary.isArchived
                              ? 'callSummary.customMenu.unarchive'
                              : 'callSummary.customMenu.archive',
                        ),
                      ),
                    ),
                  ],
                ),
            ],
            bottom: TabBar(
              tabs: [
                Tab(text: ref.t('postCallSummary.header.summary')),
                Tab(text: ref.t('summary.tabs.transcript')),
              ],
            ),
          ),
          floatingActionButton: showReviewButton
              ? FloatingActionButton(
                  key: const Key('call-summary-view-review'),
                  onPressed: () => context.push(
                    '/reviews/${summary!.reviewId}',
                    extra: ReviewType.scribe,
                  ),
                  child: const Icon(Icons.comment_outlined),
                )
              : null,
          body: Stack(
            children: [
              TabBarView(
                children: [
                  _SummaryTab(log: widget.log, summaryAsync: summaryAsync),
                  _TranscriptTab(
                    messagesAsync: messagesAsync,
                    counselorId: summaryAsync.value?.counselorId,
                  ),
                ],
              ),
              if (_showFeedbackPopup)
                Positioned.fill(
                  child: _SummaryFeedbackPopup(
                    onDismiss: _dismissFeedback,
                    onSubmit: _submitFeedback,
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
  const _SummaryTab({required this.log, required this.summaryAsync});

  final CallLogItem log;
  final AsyncValue<CallSummaryDetails> summaryAsync;

  @override
  ConsumerState<_SummaryTab> createState() => _SummaryTabState();
}

class _SummaryTabState extends ConsumerState<_SummaryTab> {
  final Map<String, dynamic> _formValues = {};

  /// Last-known-saved baseline for built-in fields — mirrors RN's
  /// `savedFormData`, used by `handleSectionFieldsReset` (the section
  /// close/X button) to reset just that section's fields back to their
  /// real last-saved values, not merely clear the dirty flag.
  final Map<String, dynamic> _savedFormValues = {};
  final Set<String> _dirtyKeys = {};
  String? _seededForChatId;
  bool _isSaving = false;
  bool _isRetrying = false;
  String? _error;

  // Per-section accordion/edit-mode state — mirrors RN's
  // `CallSummaryDetails.tsx` `expanded`/`isEditing` state maps. Absence
  // means false/collapsed/not-editing, same default RN seeds every section
  // to.
  final Map<SummarySection, bool> _expandedSections = {};
  final Map<SummarySection, bool> _editingSections = {};
  final Set<SummarySection> _enhancingSections = {};

  // Tenant-configured custom fields (see custom_fields_repository.dart) —
  // kept in their own map/dirty-set rather than merged into _formValues/
  // _dirtyKeys above: they save through a different endpoint
  // (upsertValues, not updateCallSummary) and are keyed by field-definition
  // id, a different id space from the built-in SummaryFieldDef.key values.
  final Map<String, String?> _customFieldValues = {};
  final Set<String> _dirtyCustomFieldIds = {};
  List<CustomFieldDefinition> _customFieldDefs = const [];
  String? _customFieldsSeededForChatId;

  void _seedIfNeeded(CallSummaryDetails summary) {
    final key = '${widget.log.id}';
    if (_seededForChatId == key) return;
    _formValues
      ..clear()
      ..addAll(summary.fields);
    _savedFormValues
      ..clear()
      ..addAll(summary.fields);
    _dirtyKeys.clear();
    _seededForChatId = key;
  }

  void _onFieldChanged(String fieldKey, dynamic value) {
    setState(() {
      _formValues[fieldKey] = value;
      _dirtyKeys.add(fieldKey);
    });
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
    for (final field in summaryFieldDefs.where((f) => f.section == section && f.editable)) {
      _formValues[field.key] = _savedFormValues[field.key];
      _dirtyKeys.remove(field.key);
    }
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
    final content = _formValues[field.key];
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
    final key = '${widget.log.id}';
    if (_customFieldsSeededForChatId == key) return;
    _customFieldValues
      ..clear()
      ..addEntries(values.map((v) => MapEntry(v.fieldDefinitionId, v.value)));
    _dirtyCustomFieldIds.clear();
    _customFieldsSeededForChatId = key;
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
    setState(() => _formValues.addAll(updates));
    await ref.read(callLogRepositoryProvider).updateCallSummary(widget.log.id, updates);
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
  bool get _hasDirtyChanges => _dirtyKeys.isNotEmpty;

  /// RN's `handleSubmit` — saves every dirty built-in field across the
  /// whole form (not scoped to one section), shared by both the global
  /// Save button and each section's own tick/checkmark.
  Future<bool> _saveBuiltinFields() async {
    if (_dirtyKeys.isEmpty) return true;
    final patch = {for (final key in _dirtyKeys) key: _formValues[key]};
    try {
      await ref.read(callLogRepositoryProvider).updateCallSummary(widget.log.id, patch);
      _savedFormValues.addAll(patch);
      _dirtyKeys.clear();
      ref.invalidate(callSummaryProvider(widget.log.id));
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
        widget.log.id,
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

  Future<void> _save() async {
    if (!_hasDirtyChanges) return;
    setState(() {
      _isSaving = true;
      _error = null;
    });
    final succeeded = await _saveBuiltinFields();
    if (mounted) {
      if (succeeded) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(ref.tr('callSummary.info.summaryUpdatedSuccess'))),
        );
      }
      setState(() => _isSaving = false);
    }
  }

  Future<void> _retrySummary() async {
    setState(() => _isRetrying = true);
    try {
      final result = await ref
          .read(callLogRepositoryProvider)
          .retrySummary(widget.log.id);
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
    ref.invalidate(callSummaryProvider(widget.log.id));
    if (mounted) setState(() => _isRetrying = false);
  }

  Future<void> _refresh() async {
    setState(() => _isRetrying = true);
    ref.invalidate(callSummaryProvider(widget.log.id));
    // Mirrors RN's own `handleRefresh`: the loading flag just covers the
    // refetch's own round trip, not a fixed delay.
    try {
      await ref.read(callSummaryProvider(widget.log.id).future);
    } catch (_) {
      // Surfaced via the provider's own AsyncError state, nothing more to do here.
    }
    if (mounted) setState(() => _isRetrying = false);
  }

  @override
  Widget build(BuildContext context) {
    return widget.summaryAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, _) {
        // RN's `isUnauthorized`: any 403 on the summary fetch (viewing a
        // call not owned/assigned to you) gets its own view instead of the
        // generic error text, and suppresses the transcript tab too — see
        // `CallSummaryScreen`'s own `showTranscriptTab` check.
        if (error is DioException && error.response?.statusCode == 403) {
          return const _SummaryUnauthorizedView();
        }
        return Center(
          child: Text('${ref.t('common.somethingWentWrong')} $error'),
        );
      },
      data: (summary) {
        if (!(summary.isSummaryAvailable || summary.isManualNote)) {
          final hasFailed = summary.summaryStatus == 'FAILED';
          return _GenerationProgressView(
            summaryStatus: summary.summaryStatus,
            isBusy: _isRetrying,
            onPrimaryAction: hasFailed ? _retrySummary : _refresh,
            onCheckLater: () => Navigator.of(context).maybePop(),
          );
        }
        _seedIfNeeded(summary);

        // Custom fields: fetched/seeded only once the tenant toggle resolves
        // true — mirrors RN's `skip: !customFieldsActive` on both the
        // definitions and values queries, rather than firing either request
        // unconditionally on every summary open.
        final customFieldsEnabled = ref.watch(customFieldsEnabledProvider).value ?? false;
        if (customFieldsEnabled) {
          _customFieldDefs = ref.watch(customFieldDefinitionsProvider).value ?? _customFieldDefs;
          final valuesAsync = ref.watch(customFieldValuesProvider(widget.log.id));
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
            if (summary.isManualNote)
              VoiceNoteSection(chatId: widget.log.id, onValuesApplied: _applyVoiceValues),
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
                    _SectionCard(
                      section: section,
                      formValues: _formValues,
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
            if (_hasDirtyChanges)
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
  });

  final SummarySection section;
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
    final fields = summaryFieldDefs.where((f) => f.section == section).toList();
    final sectionCustomFields = customFieldDefs.where((d) => d.sectionKey == section.name).toList();
    // RN's `canEdit={sectionConfig.canEdit && (isAdmin || isCounsellorForCall)}`.
    final canEdit = section.canEdit && (isAdmin || isCounsellorForCall);
    // The RN screen also hides a section with no tenant-configured
    // "visible fields" (a backend-driven per-org form config, Redux
    // `selectSummaryVisibleFields`) — not ported, so every section in the
    // catalog shows here regardless of whether it has data yet, which
    // matters for a section the counsellor still needs to fill in.
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
      final display = value == null || value.toString().trim().isEmpty
          ? '—'
          : value.toString();
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
            initialValue: value ?? '',
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

class _TranscriptTab extends ConsumerWidget {
  const _TranscriptTab({
    required this.messagesAsync,
    required this.counselorId,
  });

  final AsyncValue<List<ChatMessage>> messagesAsync;
  final int? counselorId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return messagesAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, _) =>
          Center(child: Text('${ref.t('common.somethingWentWrong')} $error')),
      data: (messages) {
        if (messages.isEmpty) {
          return Center(child: Text(ref.t('transcription.empty')));
        }
        return ListView.builder(
          padding: const EdgeInsets.all(16),
          itemCount: messages.length,
          itemBuilder: (context, index) {
            final message = messages[index];
            final isCounselor = message.senderId == counselorId;
            return Align(
              alignment: isCounselor
                  ? Alignment.centerRight
                  : Alignment.centerLeft,
              child: Container(
                margin: const EdgeInsets.symmetric(vertical: 4),
                padding: const EdgeInsets.all(12),
                constraints: BoxConstraints(
                  maxWidth: MediaQuery.sizeOf(context).width * 0.75,
                ),
                decoration: BoxDecoration(
                  color: isCounselor
                      ? Theme.of(context).colorScheme.primaryContainer
                      : Colors.grey.shade200,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(message.content),
              ),
            );
          },
        );
      },
    );
  }
}

/// Port of ally-mobile (React Native)'s `SummaryUnauthorized` — shown
/// instead of the generic error text when the summary fetch comes back
/// 403 (e.g. a call not owned/assigned to the viewer). Not a dedicated
/// permission check: RN's own `isUnauthorized` is purely "did this one
/// request come back 403."
class _SummaryUnauthorizedView extends ConsumerWidget {
  const _SummaryUnauthorizedView();

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
              onPressed: () => context.pop(),
            ),
          ],
        ),
      ),
    );
  }
}

/// Port of ally-mobile (React Native)'s `SummaryGenerationProgress` — scoped
/// down to the real state machine (pending/in-progress spinner, failed
/// retry, no-audio) without RN's cycling Lottie step animation or the
/// transient "transcription deleted" banner, which are cosmetic rather than
/// functional. [summaryStatus] is RN's `ChatSummaryStatus`
/// ('PENDING'/'IN_PROGRESS'/'SUCCESS'/'FAILED'/'NO_AUDIO') — null/pending/
/// in-progress all render the same "still generating" state.
class _GenerationProgressView extends ConsumerWidget {
  const _GenerationProgressView({
    required this.summaryStatus,
    required this.isBusy,
    required this.onPrimaryAction,
    required this.onCheckLater,
  });

  final String? summaryStatus;
  final bool isBusy;
  final VoidCallback onPrimaryAction;
  final VoidCallback onCheckLater;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final hasFailed = summaryStatus == 'FAILED';
    final isNoAudio = summaryStatus == 'NO_AUDIO';

    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (isNoAudio)
              Padding(
                padding: const EdgeInsets.only(bottom: 16),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(
                      Icons.warning_amber,
                      color: AppColors.red400,
                      size: 18,
                    ),
                    const SizedBox(width: 8),
                    Text(
                      ref.t('calls.status.noAudio'),
                      style: const TextStyle(color: AppColors.red400),
                    ),
                  ],
                ),
              ),
            if (hasFailed || isNoAudio) ...[
              const Icon(
                Icons.error_outline,
                size: 56,
                color: AppColors.red400,
              ),
              const SizedBox(height: 16),
              Text(
                ref.t('summaryLoading.failedTitle'),
                style: Theme.of(context).textTheme.titleMedium,
                textAlign: TextAlign.center,
              ),
            ] else ...[
              const CircularProgressIndicator(),
              const SizedBox(height: 16),
              Text(
                ref.t('summaryLoading.processingDescMain2'),
                textAlign: TextAlign.center,
              ),
            ],
            const SizedBox(height: 24),
            // RN hides this entirely for NO_AUDIO — there's nothing to retry
            // or re-check when the call never had audio to begin with.
            if (!isNoAudio)
              AppButton(
                label: hasFailed
                    ? ref.t('common.retry')
                    : ref.t('summaryLoading.seeIfReady'),
                isLoading: isBusy,
                onPressed: onPrimaryAction,
              ),
            if (!isBusy)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: TextButton(
                  onPressed: onCheckLater,
                  child: Text(ref.t('summaryLoading.checkLater')),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// Port of ally-mobile (React Native)'s `FeedbackPopup` as used by
/// `SummaryModals` (`note={t('callFeedback.rateSubtitle')}`) — star rating
/// plus the same rating-dependent tag chips
/// (`postSim.feedback.dialog.rating.tags.<rating>`) ported for
/// `SimulationFeedbackScreen`'s own feedback form, and a comment box. Not
/// ported: the separate `FEEDBACK_ISSUE_OPTIONS` chip row RN shows for a
/// 2-4 rating (`showChips`, true by default for this caller, unlike
/// SimulationFeedbackScreen's `showChips={false}`) — a second, independent
/// chip set this scoped port leaves out; the comment box below always shows
/// instead of being gated behind it.
class _SummaryFeedbackPopup extends ConsumerStatefulWidget {
  const _SummaryFeedbackPopup({
    required this.onDismiss,
    required this.onSubmit,
  });

  final VoidCallback onDismiss;
  final void Function(int rating, String comment) onSubmit;

  @override
  ConsumerState<_SummaryFeedbackPopup> createState() =>
      _SummaryFeedbackPopupState();
}

class _SummaryFeedbackPopupState extends ConsumerState<_SummaryFeedbackPopup> {
  int _rating = 0;
  final _selectedTags = <String>{};
  final _commentController = TextEditingController();

  @override
  void dispose() {
    _commentController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final tags = _rating == 0
        ? const <dynamic>[]
        : ref
                      .watch(localizationControllerProvider)
                      .value
                      ?.raw('postSim.feedback.dialog.rating.tags.$_rating')
                  as List<dynamic>? ??
              const [];

    return Container(
      color: Colors.black.withValues(alpha: 0.5),
      alignment: Alignment.bottomCenter,
      child: Material(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
        // RN's own bottom sheet caps itself at `maxHeight: '90%'` — without
        // a cap here, the rating tags (a 5-item Wrap, on top of everything
        // else already in the sheet) can overflow a short viewport.
        child: ConstrainedBox(
          constraints: BoxConstraints(
            maxHeight: MediaQuery.sizeOf(context).height * 0.9,
          ),
          child: SafeArea(
            top: false,
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.end,
                    children: [
                      IconButton(
                        icon: const Icon(Icons.close),
                        onPressed: widget.onDismiss,
                      ),
                    ],
                  ),
                  Text(
                    ref.t('callFeedback.rateTitle'),
                    style: Theme.of(context).textTheme.titleMedium,
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 4),
                  Text(
                    ref.t('callFeedback.rateSubtitle'),
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                  const SizedBox(height: 16),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: List.generate(5, (index) {
                      final starValue = index + 1;
                      return IconButton(
                        iconSize: 32,
                        onPressed: () => setState(() {
                          _rating = starValue;
                          _selectedTags.clear();
                        }),
                        icon: Icon(
                          starValue <= _rating ? Icons.star : Icons.star_border,
                          color: Colors.amber,
                        ),
                      );
                    }),
                  ),
                  if (tags.isNotEmpty)
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      alignment: WrapAlignment.center,
                      children: [
                        for (final tag in tags.cast<String>())
                          FilterChip(
                            label: Text(tag),
                            selected: _selectedTags.contains(tag),
                            onSelected: (selected) => setState(() {
                              if (selected) {
                                _selectedTags.add(tag);
                              } else {
                                _selectedTags.remove(tag);
                              }
                            }),
                          ),
                      ],
                    ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _commentController,
                    maxLines: 3,
                    decoration: InputDecoration(
                      hintText: ref.t('callFeedback.suggestionPlaceholder'),
                      border: const OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 16),
                  AppButton(
                    label: ref.t('callFeedback.submit'),
                    isDisabled: _rating == 0,
                    onPressed: () => widget.onSubmit(
                      _rating,
                      _commentController.text.trim(),
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
