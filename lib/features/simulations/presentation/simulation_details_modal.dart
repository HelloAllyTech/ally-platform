import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/widgets/app_button.dart';
import '../data/simulation_models.dart';
import 'widgets/scenario_language_dropdown.dart';

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
  const SimulationDetailsModal({
    super.key,
    required this.scenario,
    required this.onStart,
  });

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
      builder: (context) =>
          SimulationDetailsModal(scenario: scenario, onStart: onStart),
    );
  }

  @override
  ConsumerState<SimulationDetailsModal> createState() =>
      _SimulationDetailsModalState();
}

class _SimulationDetailsModalState
    extends ConsumerState<SimulationDetailsModal> {
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

  static const _sectionLabelStyle = TextStyle(
    fontFamily: AppFonts.ibmPlexSerifMedium,
    fontSize: 14,
    height: 22 / 14,
    letterSpacing: 0.2,
    color: AppColors.mediumEmphasis,
  );

  @override
  Widget build(BuildContext context) {
    final scenario = widget.scenario;
    final languages = scenario.availableLanguages ?? const [];
    final cover = scenario.coverImageUrl;

    return PopScope(
      canPop: !_isStarting,
      child: Dialog(
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
        // styles.modalBackdrop paddingHorizontal 20; modalContainer radius.lg.
        insetPadding: const EdgeInsets.symmetric(horizontal: 20),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        clipBehavior: Clip.antiAlias,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 500),
          // styles.modalContainer: height 80% of the screen.
          child: SizedBox(
            height: MediaQuery.sizeOf(context).height * 0.8,
            child: Column(
              children: [
                // styles.header
                Padding(
                  padding: const EdgeInsets.only(left: 16, right: 16, top: 16),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Flexible(
                        child: Text.rich(
                          TextSpan(
                            text: '${ref.t('common.start')} ',
                            children: [
                              TextSpan(
                                text: ref.t('common.simulation'),
                                style: const TextStyle(
                                  fontFamily: AppFonts.replayProBoldItalic,
                                  fontStyle: FontStyle.italic,
                                ),
                              ),
                            ],
                          ),
                          // styles.headerTitle: REPLAY_PRO.HEADLINE + display.small, light.
                          style: const TextStyle(
                            fontFamily: AppFonts.replayProHeadline,
                            fontSize: 18,
                            height: 24 / 18,
                            letterSpacing: 0.18,
                            fontWeight: FontWeight.w300,
                            color: AppColors.highEmphasis,
                          ),
                        ),
                      ),
                      GestureDetector(
                        key: const Key('simulation-details-modal-close'),
                        behavior: HitTestBehavior.opaque,
                        onTap: _isStarting
                            ? null
                            : () => Navigator.of(context).pop(),
                        child: Padding(
                          padding: const EdgeInsets.all(4),
                          // close.svg's #424242 fill is baked in; RN's
                          // `color` prop doesn't reach it.
                          child: SvgPicture.asset(
                            'assets/icons/close.svg',
                            width: 20,
                            height: 20,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                // styles.contentContainer: flex 1, 16 margin, hairline border.
                Expanded(
                  child: Container(
                    margin: const EdgeInsets.all(16),
                    clipBehavior: Clip.antiAlias,
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(
                        color: AppColors.strokePrimary,
                        width: 0.35,
                      ),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        if (languages.isNotEmpty)
                          Padding(
                            padding: const EdgeInsets.only(bottom: 12),
                            child: Align(
                              alignment: Alignment.centerLeft,
                              child:
                                  ScenarioLanguageDropdown<
                                    SimulationLanguageOption
                                  >(
                                    key: const Key(
                                      'simulation-details-modal-language',
                                    ),
                                    options: languages,
                                    selected: _selectedLanguage,
                                    labelOf: (lang) => lang.label,
                                    enabled: !_isStarting,
                                    onSelected: (lang) => setState(
                                      () => _selectedLanguage = lang,
                                    ),
                                  ),
                            ),
                          ),
                        // styles.mediaContainer padding 12 (always present).
                        Padding(
                          padding: const EdgeInsets.all(12),
                          child: cover == null || cover.isEmpty
                              ? const SizedBox.shrink()
                              : ClipRRect(
                                  borderRadius: BorderRadius.circular(8),
                                  child: Image.network(
                                    cover,
                                    height: 180,
                                    width: double.infinity,
                                    fit: BoxFit.cover,
                                    errorBuilder: (_, _, _) => Container(
                                      height: 180,
                                      color: AppColors.grey200,
                                    ),
                                  ),
                                ),
                        ),
                        Expanded(
                          child: SingleChildScrollView(
                            padding: const EdgeInsets.only(
                              left: 16,
                              right: 16,
                              bottom: 16,
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                // styles.orderLabel: ROBOTO.REGULAR + body.small.
                                Padding(
                                  padding: const EdgeInsets.only(top: 12),
                                  child: Text(
                                    '${ref.t('common.simulation')} ${scenario.order}',
                                    style: const TextStyle(
                                      fontFamily: AppFonts.robotoRegular,
                                      fontSize: 12,
                                      height: 16 / 12,
                                      letterSpacing: 0.2,
                                      color: AppColors.lowEmphasis,
                                    ),
                                  ),
                                ),
                                if (scenario.title != null &&
                                    scenario.title!.isNotEmpty)
                                  Padding(
                                    padding: const EdgeInsets.symmetric(
                                      vertical: 8,
                                    ),
                                    // styles.title: IBM_PLEX_SERIF.REGULAR + body.large.
                                    child: Text(
                                      scenario.title!,
                                      style: const TextStyle(
                                        fontFamily:
                                            AppFonts.ibmPlexSerifRegular,
                                        fontSize: 16,
                                        height: 24 / 16,
                                        letterSpacing: 0.5,
                                        color: AppColors.highEmphasis,
                                      ),
                                    ),
                                  ),
                                if (scenario.description != null &&
                                    scenario.description!.isNotEmpty) ...[
                                  Padding(
                                    padding: const EdgeInsets.only(bottom: 4),
                                    child: Text(
                                      ref.t('learn.scenario.scenarioLabel'),
                                      style: _sectionLabelStyle,
                                    ),
                                  ),
                                  Padding(
                                    padding: const EdgeInsets.only(bottom: 6),
                                    child: Text(
                                      scenario.description!,
                                      style: _sectionLabelStyle.copyWith(
                                        fontFamily:
                                            AppFonts.ibmPlexSerifRegular,
                                      ),
                                    ),
                                  ),
                                ],
                                if (scenario.triggerWarnings.isNotEmpty) ...[
                                  Padding(
                                    padding: const EdgeInsets.only(bottom: 8),
                                    // RN appends a second ':'; shown once.
                                    child: Text(
                                      ref.t('common.triggerWarnings'),
                                      style: _sectionLabelStyle,
                                    ),
                                  ),
                                  Padding(
                                    padding: const EdgeInsets.only(bottom: 8),
                                    child: Wrap(
                                      spacing: 6,
                                      runSpacing: 6,
                                      children: [
                                        for (final warning
                                            in scenario.triggerWarnings)
                                          Container(
                                            padding: const EdgeInsets.symmetric(
                                              horizontal: 8,
                                              vertical: 4,
                                            ),
                                            decoration: BoxDecoration(
                                              color: AppColors.grey50,
                                              borderRadius:
                                                  BorderRadius.circular(999),
                                              border: Border.all(
                                                color: AppColors.grey300,
                                                width: 0.5,
                                              ),
                                            ),
                                            child: Text(
                                              warning,
                                              style: _sectionLabelStyle
                                                  .copyWith(
                                                    fontFamily: AppFonts
                                                        .ibmPlexSerifRegular,
                                                  ),
                                            ),
                                          ),
                                      ],
                                    ),
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
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(
                      left: 16,
                      right: 16,
                      bottom: 8,
                    ),
                    child: Text(
                      _error!,
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        color: AppColors.red400,
                        fontSize: 12,
                      ),
                    ),
                  ),
                // styles.buttonContainer / ctaWrapper.
                Padding(
                  padding: const EdgeInsets.only(
                    left: 16,
                    right: 16,
                    bottom: 16,
                  ),
                  child: AppButton(
                    key: const Key('simulation-details-modal-start'),
                    label:
                        '${ref.t('common.start')} ${ref.t('common.simulation')}',
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
