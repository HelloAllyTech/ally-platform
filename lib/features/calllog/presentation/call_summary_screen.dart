import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_card.dart';
import '../data/call_log_repository.dart';
import '../data/call_summary_fields.dart';

/// Maps each [SummarySection] to its real translation key, taken from
/// ally-mobile (React Native)'s `src/constants/summary.ts` `SECTION_LIST`
/// (`labelKey` property) — the authoritative key for every section title in
/// this form.
const _sectionLabelKeys = <SummarySection, String>{
  SummarySection.featuresAndDemographics: 'summary.sections.featuresAndDemographics',
  SummarySection.sessionSummary: 'summary.sections.sessionSummary',
  SummarySection.flow: 'summary.sections.flow',
  SummarySection.keyConcern: 'summary.sections.keyConcerns',
  SummarySection.objectiveObservations: 'summary.sections.objectiveObservations',
  SummarySection.subjectiveObservations: 'summary.sections.subjectiveObservations',
  SummarySection.assessment: 'summary.sections.assessment',
  SummarySection.dominantFeelings: 'summary.sections.dominantFeelings',
  SummarySection.issuesWorkedOn: 'summary.sections.issuesWorkedOn',
  SummarySection.keyTherapeuticTechniques: 'summary.sections.keyTherapeuticTechniques',
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
  'assessmentPsychologicalDiagnosisNotes': 'summary.fields.assessmentPsychDiagnosisNotes',
  'assessmentUseOfPsychotropicMedications': 'summary.fields.assessmentPsychotropicMeds',
  'assessmentUseOfPsychotropicMedicationsNotes':
      'summary.fields.assessmentPsychotropicMedsNotes',
  'assessmentHallucinations': 'summary.fields.assessmentHallucinations',
  'assessmentHallucinationsNotes': 'summary.fields.assessmentHallucinationsNotes',
  'assessmentAffect': 'summary.fields.assessmentAffect',
  'assessmentSpeech': 'summary.fields.assessmentSpeech',
  'ongoingRiskSelfHarm': 'summary.fields.ongoingRiskSelfHarm',
  'ongoingRiskSelfHarmNotes': 'summary.fields.ongoingRiskSelfHarmNotes',
  'ongoingRiskSuicidalThoughts': 'summary.fields.ongoingRiskSuicidalThoughts',
  'ongoingRiskSuicidalPlan': 'summary.fields.ongoingRiskSuicidalPlan',
  'ongoingRiskSuicidalAction': 'summary.fields.ongoingRiskSuicidalAction',
  'ongoingRiskSuicidalThoughtsNotes': 'summary.fields.ongoingRiskSuicidalThoughtsNotes',
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
class CallSummaryScreen extends ConsumerWidget {
  const CallSummaryScreen({super.key, required this.log});

  final CallLogItem log;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final summaryAsync = ref.watch(callSummaryProvider(log.id));
    final messagesAsync = ref.watch(chatMessagesProvider(log.id));

    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: Text(log.sessionName ?? ref.t('calls.sessionNumber', {'id': log.id})),
          bottom: TabBar(
            tabs: [
              Tab(text: ref.t('postCallSummary.header.summary')),
              Tab(text: ref.t('summary.tabs.transcript')),
            ],
          ),
        ),
        body: TabBarView(
          children: [
            _SummaryTab(log: log, summaryAsync: summaryAsync),
            _TranscriptTab(
              messagesAsync: messagesAsync,
              counselorId: summaryAsync.value?.counselorId,
            ),
          ],
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
          SnackBar(content: Text(ref.tr('callSummary.info.summaryUpdatedSuccess'))),
        );
      }
    } catch (e) {
      setState(() => _error = '${ref.tr('callSummary.info.summaryUpdateFailed')}: $e');
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return widget.summaryAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, _) =>
          Center(child: Text('${ref.t('common.somethingWentWrong')} $error')),
      data: (summary) {
        _seedIfNeeded(summary);
        return Column(
          children: [
            Expanded(
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Text('${ref.t('calls.table.summaryStatus')}: ${widget.log.status}'),
                  Text('${ref.t('callSummary.startedLabel')}: ${widget.log.startedAt}'),
                  if (widget.log.endedAt.isNotEmpty)
                    Text('${ref.t('callSummary.endedLabel')}: ${widget.log.endedAt}'),
                  if (widget.log.score != null)
                    Text('${ref.t('callSummary.scoreLabel')}: ${widget.log.score}'),
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
                child: Text(_error!, style: const TextStyle(color: AppColors.red400)),
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
