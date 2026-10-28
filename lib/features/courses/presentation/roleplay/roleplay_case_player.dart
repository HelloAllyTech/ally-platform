import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../../core/localization/translate_ref.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/widgets/app_button.dart';
import '../../../simulations/data/simulation_models.dart';
import '../../../simulations/data/simulations_repository.dart';
import '../../../simulations/presentation/start_simulation/start_simulation_controller.dart';
import '../../../simulations/presentation/widgets/scenario_language_dropdown.dart';
import '../../../simulations/presentation/widgets/simulation_card.dart';
import '../../data/course_models.dart';
import '../../data/start_item_payload.dart';

/// System font — RN's `<Text>`s here set no `fontFamily`.
const _systemStyle = TextStyle(fontFamily: 'CupertinoSystemText', fontSize: 14, color: AppColors.mediumEmphasis);

/// RN's `formatDate`: short month + two-digit day ("Oct 05").
String _formatDate(String iso) => DateFormat('MMM dd').format(DateTime.parse(iso).toLocal());

/// Port of ally-mobile (React Native)'s `CourseItemPlayerScreen/components/
/// players/RoleplayCasePlayer.tsx` — the pre-launch card for ROLEPLAY and
/// CASE items. A roleplay starts a live session linked to the item's
/// progress row (`trackItemProgressId`) through the same
/// [StartSimulationController] the simulation screens use; a case opens the
/// case screen. Completion arrives out of band, so this never reports it:
/// [onLaunched] tells the player to refetch the track when it's back on
/// top (RN's `setActiveTrackContext` + on-focus refetch).
class RoleplayCasePlayer extends ConsumerStatefulWidget {
  const RoleplayCasePlayer({
    super.key,
    required this.payload,
    required this.item,
    required this.alreadyCompleted,
    required this.onLaunched,
  });

  final StartItemPayload payload;
  final TrackDetailItem item;
  final bool alreadyCompleted;
  final VoidCallback onLaunched;

  @override
  ConsumerState<RoleplayCasePlayer> createState() => _RoleplayCasePlayerState();
}

class _RoleplayCasePlayerState extends ConsumerState<RoleplayCasePlayer> {
  late final StartSimulationController _start = StartSimulationController(ref)..addListener(_onStartChanged);
  ScenarioLanguageOption? _selectedLanguage;

  bool get _isCase => widget.payload.type == 'CASE';
  bool get _isAssessment => !_isCase && widget.payload.roleplayAssessmentMode;
  String? get _submittedAt => _isCase ? null : widget.payload.assessmentSubmittedAt;
  bool get _assessmentLocked => _isAssessment && _submittedAt != null;

  void _onStartChanged() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _start
      ..removeListener(_onStartChanged)
      ..dispose();
    super.dispose();
  }

  Future<void> _launch(Scenario? scenario) async {
    final payload = widget.payload;
    if (_isCase) {
      final caseId = payload.caseId;
      if (caseId == null) return;
      widget.onLaunched();
      context.push('/cases/$caseId');
      return;
    }
    final scenarioId = payload.scenarioId;
    if (scenarioId == null) return;
    widget.onLaunched();
    await _start.start(
      context,
      StartSimulationParams(
        scenarioId: scenarioId,
        trackItemProgressId: payload.trackItemProgressId,
        languageId: _selectedLanguage?.languageId,
        scenario: scenario,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final payload = widget.payload;
    final scenario = !_isCase && payload.scenarioId != null
        ? ref.watch(scenarioByIdProvider(payload.scenarioId!)).value
        : null;
    final caseDetails = _isCase && payload.caseId != null
        ? ref.watch(caseDetailsProvider(payload.caseId!)).value
        : null;

    // Default to the first offered language while there's no valid pick,
    // so a refetch never reverts the learner's choice.
    final languages = scenario?.availableLanguages ?? const <ScenarioLanguageOption>[];
    if (languages.isNotEmpty && !languages.any((l) => l.label == _selectedLanguage?.label)) {
      _selectedLanguage = languages.first;
    }

    final coverImageUrl = _isCase ? caseDetails?.coverImageUrl : scenario?.coverImageUrl;
    final description = (_isCase ? caseDetails?.description : scenario?.description) ?? '';
    final primaryLabel = _isCase
        ? ref.t('courses.roleplay.openCase')
        : widget.alreadyCompleted
        ? ref.t('courses.roleplay.replay')
        : ref.t('courses.roleplay.start');
    final completedAt = widget.item.completedAt;
    final submittedAt = _submittedAt;

    // styles.container: centred column, gap 16, padding 24.
    final children = <Widget>[
      SimulationCard(
        title: widget.item.title,
        description: description,
        coverImageUrl: coverImageUrl,
        triggerWarnings: _isCase ? const [] : (scenario?.triggerWarnings ?? const []),
        onTap: _assessmentLocked ? () {} : () => _launch(scenario),
      ),
      Text(
        _isAssessment ? ref.t('courses.roleplay.assessmentIntro') : ref.t('courses.roleplay.intro'),
        textAlign: TextAlign.center,
        style: _systemStyle,
      ),
      if (_isAssessment && !_assessmentLocked)
        Container(
          key: const Key('roleplay-assessment-notice'),
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: BoxDecoration(color: AppColors.amber50, borderRadius: BorderRadius.circular(12)),
          child: Text(
            ref.t('courses.roleplay.assessmentNotice'),
            style: _systemStyle.copyWith(color: AppColors.amber900),
          ),
        ),
      if (widget.alreadyCompleted && completedAt != null)
        Container(
          key: const Key('roleplay-completed-chip'),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
          decoration: BoxDecoration(color: AppColors.green50, borderRadius: BorderRadius.circular(20)),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              SvgPicture.asset('assets/icons/tickRound.svg', width: 16, height: 16),
              const SizedBox(width: 6),
              Text(
                ref.t('courses.roleplay.completedOn', {'date': _formatDate(completedAt)}),
                style: _systemStyle.copyWith(color: AppColors.green700),
              ),
            ],
          ),
        ),
      if (_assessmentLocked && !widget.alreadyCompleted && submittedAt != null)
        Text(
          '${ref.t('courses.roleplay.assessmentSubmitted', {'date': _formatDate(submittedAt)})}\n'
          '${ref.t('courses.roleplay.assessmentNotPassed')}',
          key: const Key('roleplay-assessment-submitted'),
          textAlign: TextAlign.center,
          style: _systemStyle,
        ),
      if (_assessmentLocked)
        Text(
          ref.t('courses.roleplay.assessmentLocked'),
          key: const Key('roleplay-assessment-locked'),
          textAlign: TextAlign.center,
          style: _systemStyle,
        )
      else ...[
        if (languages.isNotEmpty)
          Align(
            alignment: Alignment.centerLeft,
            child: ScenarioLanguageDropdown<ScenarioLanguageOption>(
              options: languages,
              selected: _selectedLanguage,
              labelOf: (lang) => lang.label,
              placeholder: ref.t('nav.language.label'),
              enabled: !_start.isCreatingRoom,
              onSelected: (lang) => setState(() => _selectedLanguage = lang),
            ),
          ),
        AppButton(
          key: const Key('roleplay-case-launch'),
          label: primaryLabel,
          isLoading: _start.isCreatingRoom,
          onPressed: () => _launch(scenario),
        ),
      ],
    ];

    return LayoutBuilder(
      builder: (context, constraints) => SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: ConstrainedBox(
          constraints: BoxConstraints(minHeight: (constraints.maxHeight - 48).clamp(0, double.infinity)),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              for (var i = 0; i < children.length; i++) ...[if (i > 0) const SizedBox(height: 16), children[i]],
            ],
          ),
        ),
      ),
    );
  }
}
