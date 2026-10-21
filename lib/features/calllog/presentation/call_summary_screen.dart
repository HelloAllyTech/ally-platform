import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/localization/localization_controller.dart';
import '../../../core/localization/translate_ref.dart';
import '../../../core/permissions/permissions_repository.dart';
import '../../../core/permissions/user_permissions.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/root_scaffold_messenger.dart';
import '../data/call_log_repository.dart';
import '../data/call_summary_fields.dart';

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
/// `updateCallSummary`, plus the real message-by-message transcript. Not
/// ported: AI-enhance per section, export, tag *ratings* (as opposed to
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

  @override
  void initState() {
    super.initState();
    // Captured eagerly here, not via a lazy `late` initializer — this must
    // be the real mount moment, not whenever `_mountTime` happens to be
    // first read (which is only on back-press, long after mount).
    _mountTime = widget.now();
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
    ref.watch(userPermissionsProvider);

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) {
        if (!didPop) _handleBackPress();
      },
      child: DefaultTabController(
        length: 2,
        child: Scaffold(
          appBar: AppBar(
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
            title: Text(
              widget.log.sessionName ??
                  ref.t('calls.sessionNumber', {'id': widget.log.id}),
            ),
            bottom: TabBar(
              tabs: [
                Tab(text: ref.t('postCallSummary.header.summary')),
                Tab(text: ref.t('summary.tabs.transcript')),
              ],
            ),
          ),
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
  final Set<String> _dirtyKeys = {};
  String? _seededForChatId;
  bool _isSaving = false;
  bool _isRetrying = false;
  String? _error;

  void _seedIfNeeded(CallSummaryDetails summary) {
    final key = '${widget.log.id}';
    if (_seededForChatId == key) return;
    _formValues
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

  Future<void> _save() async {
    if (_dirtyKeys.isEmpty) return;
    setState(() {
      _isSaving = true;
      _error = null;
    });
    try {
      final patch = {for (final key in _dirtyKeys) key: _formValues[key]};
      await ref
          .read(callLogRepositoryProvider)
          .updateCallSummary(widget.log.id, patch);
      _dirtyKeys.clear();
      ref.invalidate(callSummaryProvider(widget.log.id));
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(ref.tr('callSummary.info.summaryUpdatedSuccess')),
          ),
        );
      }
    } catch (e) {
      setState(
        () => _error = '${ref.tr('callSummary.info.summaryUpdateFailed')}: $e',
      );
    } finally {
      if (mounted) setState(() => _isSaving = false);
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
        return Column(
          children: [
            Expanded(
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Text(
                    '${ref.t('calls.table.summaryStatus')}: ${widget.log.status}',
                  ),
                  Text(
                    '${ref.t('callSummary.startedLabel')}: ${widget.log.startedAt}',
                  ),
                  if (widget.log.endedAt.isNotEmpty)
                    Text(
                      '${ref.t('callSummary.endedLabel')}: ${widget.log.endedAt}',
                    ),
                  if (widget.log.score != null)
                    Text(
                      '${ref.t('callSummary.scoreLabel')}: ${widget.log.score}',
                    ),
                  const SizedBox(height: 16),
                  for (final section in SummarySection.values)
                    _SectionCard(
                      section: section,
                      formValues: _formValues,
                      onFieldChanged: _onFieldChanged,
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
            SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: AppButton(
                  label: _dirtyKeys.isEmpty
                      ? ref.t('callSummary.noChanges')
                      : ref.t('callSummary.saveChanges'),
                  isDisabled: _dirtyKeys.isEmpty,
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

class _SectionCard extends ConsumerWidget {
  const _SectionCard({
    required this.section,
    required this.formValues,
    required this.onFieldChanged,
  });

  final SummarySection section;
  final Map<String, dynamic> formValues;
  final void Function(String fieldKey, dynamic value) onFieldChanged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final fields = summaryFieldDefs.where((f) => f.section == section).toList();
    // The RN screen also hides a section with no tenant-configured
    // "visible fields" (a backend-driven per-org form config, Redux
    // `selectSummaryVisibleFields`) — not ported, so every section in the
    // catalog shows here regardless of whether it has data yet, which
    // matters for a section the counsellor still needs to fill in.
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: AppCard(
        variant: AppCardVariant.flat,
        child: ExpansionTile(
          title: Text(ref.t(_sectionLabelKeys[section] ?? section.label)),
          children: [
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
  });

  final SummaryFieldDef field;
  final Map<String, dynamic> formValues;
  final void Function(String fieldKey, dynamic value) onChanged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final value = formValues[field.key];
    final label = ref.t(_fieldLabelKeys[field.key] ?? field.label);

    if (!field.editable) {
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
