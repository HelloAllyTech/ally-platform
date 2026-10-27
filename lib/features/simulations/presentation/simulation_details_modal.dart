import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/widgets/app_button.dart';
import '../data/simulation_models.dart';

/// Direct port of ally-mobile (React Native)'s `SimulationDetailsModal` — the
/// pre-start preview shown when a learner taps a scenario card (or the path/
/// case's own Start/Continue button) in `SimulationPathDetailsScreen` or
/// `CaseDetailsScreen`: cover media, title, scenario description, trigger
/// warnings, an inline language picker when the scenario offers more than
/// one, and the real "Start Simulation" action.
///
/// Not ported, matching [SimulationDetailsScreen]'s own documented scope
/// line: the video cover preview (falls back to the image, see
/// [PathScenario.coverVideoUrl]'s own doc comment) — no video-preview widget
/// exists in this app yet.
///
/// Also deliberately narrower than RN here: RN's own "Start Simulation"
/// button doesn't start anything directly — it opens a separate
/// `NotificationModal` ("ready to begin?") confirmation first, which is
/// itself a distinct, not-yet-ported component. [LearningPathDetailView]
/// already draws this same scope line for the active-simulation-conflict,
/// 429-retry, and low-credits modals; this adds one more to that list
/// rather than silently dropping the behavior. [onStart] here fires the
/// real start directly instead.
class SimulationDetailsModal extends ConsumerStatefulWidget {
  const SimulationDetailsModal({super.key, required this.scenario, required this.onStart});

  final PathScenario scenario;

  /// Starts the scenario with the chosen language (`null` when the scenario
  /// has none to choose from). Rethrow on failure — the modal shows the
  /// error inline and stays open so the learner can retry or back out,
  /// rather than being silently dismissed on a failed start.
  final Future<void> Function(int? languageId) onStart;

  /// Shows this as a non-dismissible-by-backdrop overlay (RN's `Modal` has
  /// no backdrop-tap-to-close either — only the X icon, via `onRequestClose`
  /// being wired to the same `onClose`). Resolves once the dialog is popped,
  /// whether by a successful start or the close button.
  static Future<void> show(
    BuildContext context, {
    required PathScenario scenario,
    required Future<void> Function(int? languageId) onStart,
  }) {
    return showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (context) => SimulationDetailsModal(scenario: scenario, onStart: onStart),
    );
  }

  @override
  ConsumerState<SimulationDetailsModal> createState() => _SimulationDetailsModalState();
}

class _SimulationDetailsModalState extends ConsumerState<SimulationDetailsModal> {
  SimulationLanguageOption? _selectedLanguage;
  bool _isStarting = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final languages = widget.scenario.availableLanguages;
    if (languages != null && languages.isNotEmpty) {
      _selectedLanguage = languages.first;
    }
  }

  Future<void> _handleStart() async {
    setState(() {
      _isStarting = true;
      _error = null;
    });
    try {
      await widget.onStart(_selectedLanguage?.languageId);
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      if (mounted) {
        setState(() {
          _isStarting = false;
          _error = e.toString();
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final scenario = widget.scenario;
    final languages = scenario.availableLanguages ?? const [];

    return PopScope(
      canPop: !_isStarting,
      child: Dialog(
        backgroundColor: Colors.transparent,
        insetPadding: const EdgeInsets.symmetric(horizontal: 20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 500, maxHeight: 640),
          child: Container(
            decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16)),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text.rich(
                          TextSpan(
                            children: [
                              TextSpan(text: '${ref.t('common.start')} '),
                              TextSpan(
                                text: ref.t('common.simulation'),
                                style: const TextStyle(
                                  fontFamily: AppFonts.replayProBoldItalic,
                                  fontStyle: FontStyle.italic,
                                ),
                              ),
                            ],
                          ),
                          style: const TextStyle(
                            fontFamily: AppFonts.replayProHeadline,
                            fontSize: 20,
                            color: AppColors.highEmphasis,
                          ),
                        ),
                      ),
                      IconButton(
                        key: const Key('simulation-details-modal-close'),
                        onPressed: _isStarting ? null : () => Navigator.of(context).pop(),
                        icon: const Icon(Icons.close, size: 20, color: AppColors.mediumEmphasis),
                        visualDensity: VisualDensity.compact,
                      ),
                    ],
                  ),
                ),
                Flexible(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Container(
                      decoration: BoxDecoration(
                        border: Border.all(color: AppColors.strokePrimary, width: 0.5),
                        borderRadius: BorderRadius.circular(16),
                      ),
                      clipBehavior: Clip.antiAlias,
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          if (languages.isNotEmpty)
                            Padding(
                              padding: const EdgeInsets.fromLTRB(12, 12, 12, 0),
                              child: Align(
                                alignment: Alignment.centerLeft,
                                child: _LanguagePicker(
                                  options: languages,
                                  selected: _selectedLanguage,
                                  enabled: !_isStarting,
                                  onSelected: (lang) => setState(() => _selectedLanguage = lang),
                                ),
                              ),
                            ),
                          Padding(
                            padding: const EdgeInsets.all(12),
                            child: ClipRRect(
                              borderRadius: BorderRadius.circular(12),
                              child: scenario.coverImageUrl != null
                                  ? Image.network(
                                      scenario.coverImageUrl!,
                                      height: 180,
                                      width: double.infinity,
                                      fit: BoxFit.cover,
                                      errorBuilder: (_, _, _) =>
                                          Container(height: 180, color: AppColors.lightGray2),
                                    )
                                  : Container(height: 180, color: AppColors.lightGray2),
                            ),
                          ),
                          Flexible(
                            child: SingleChildScrollView(
                              padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    '${ref.t('common.simulation')} ${scenario.order}',
                                    style: const TextStyle(fontSize: 12, color: AppColors.lowEmphasis),
                                  ),
                                  if (scenario.title != null) ...[
                                    const SizedBox(height: 8),
                                    Text(
                                      scenario.title!,
                                      style: const TextStyle(
                                        fontFamily: AppFonts.ibmPlexSerifRegular,
                                        fontSize: 16,
                                        color: AppColors.highEmphasis,
                                      ),
                                    ),
                                  ],
                                  if (scenario.description != null) ...[
                                    const SizedBox(height: 8),
                                    Text(
                                      ref.t('learn.scenario.scenarioLabel'),
                                      style: const TextStyle(
                                        fontFamily: AppFonts.ibmPlexSerifMedium,
                                        fontSize: 14,
                                        color: AppColors.mediumEmphasis,
                                      ),
                                    ),
                                    const SizedBox(height: 4),
                                    Text(
                                      scenario.description!,
                                      style: const TextStyle(fontSize: 14, color: AppColors.mediumEmphasis),
                                    ),
                                  ],
                                  if (scenario.triggerWarnings.isNotEmpty) ...[
                                    const SizedBox(height: 8),
                                    Text(
                                      '${ref.t('common.triggerWarnings')}:',
                                      style: const TextStyle(
                                        fontFamily: AppFonts.ibmPlexSerifMedium,
                                        fontSize: 14,
                                        color: AppColors.mediumEmphasis,
                                      ),
                                    ),
                                    const SizedBox(height: 6),
                                    Wrap(
                                      spacing: 6,
                                      runSpacing: 6,
                                      children: [
                                        for (final warning in scenario.triggerWarnings)
                                          Container(
                                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                            decoration: BoxDecoration(
                                              color: AppColors.lightGray,
                                              borderRadius: BorderRadius.circular(999),
                                              border: Border.all(color: AppColors.lightGray2, width: 0.5),
                                            ),
                                            child: Text(
                                              warning,
                                              style: const TextStyle(fontSize: 12, color: AppColors.mediumEmphasis),
                                            ),
                                          ),
                                      ],
                                    ),
                                  ],
                                ],
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(left: 16, right: 16, bottom: 8),
                    child: Text(
                      _error!,
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: AppColors.red400, fontSize: 12),
                    ),
                  ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                  child: AppButton(
                    key: const Key('simulation-details-modal-start'),
                    label: '${ref.t('common.start')} ${ref.t('common.simulation')}',
                    isLoading: _isStarting,
                    isDisabled: _isStarting,
                    onPressed: _handleStart,
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

/// Inline language dropdown, embedded in the preview card above the cover
/// media — RN's `CustomDropdown`. A plain `PopupMenuButton` here, matching
/// `SimulationDetailsScreen`'s own `_LanguageDropdown`.
class _LanguagePicker extends StatelessWidget {
  const _LanguagePicker({
    required this.options,
    required this.selected,
    required this.enabled,
    required this.onSelected,
  });

  final List<SimulationLanguageOption> options;
  final SimulationLanguageOption? selected;
  final bool enabled;
  final ValueChanged<SimulationLanguageOption> onSelected;

  @override
  Widget build(BuildContext context) {
    return PopupMenuButton<SimulationLanguageOption>(
      key: const Key('simulation-details-modal-language'),
      enabled: enabled,
      onSelected: onSelected,
      itemBuilder: (context) => [
        for (final option in options) PopupMenuItem(value: option, child: Text(option.label)),
      ],
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          border: Border.all(color: AppColors.strokePrimary),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(selected?.label ?? '', style: const TextStyle(fontSize: 12, color: AppColors.highEmphasis)),
            const SizedBox(width: 4),
            const Icon(Icons.arrow_drop_down, size: 16, color: AppColors.mediumEmphasis),
          ],
        ),
      ),
    );
  }
}
