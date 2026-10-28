import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/cover_video_preview.dart';
import '../data/simulation_models.dart';
import 'start_simulation/start_simulation_modals.dart';
import 'widgets/scenario_language_dropdown.dart';

/// Direct port of ally-mobile (React Native)'s `SimulationDetailsModal` — the
/// pre-start preview shown when a learner taps a scenario card (or the path/
/// case's own Start/Continue button) in `SimulationPathDetailsScreen` or
/// `CaseDetailsScreen`: cover media, title, scenario description, trigger
/// warnings, an inline language picker when the scenario offers more than
/// one, and the real "Start Simulation" action.
///
/// The cover is RN's `VideoPreview` when the scenario has a cover video.
///
/// "Start Simulation" first shows RN's `NotificationModal` ("Before you get
/// started"); RN hides this modal while that one is up
/// (`visible={!!selectedSimulation && !showNotification}`), and shows it
/// again if the learner closes it. On confirm, [onStart] runs (the
/// screen's `StartSimulationController`, which surfaces its own errors and
/// modals) with this modal showing its loading state, and the modal then
/// closes whatever the outcome — RN's `.finally(handleCloseModal)`.
class SimulationDetailsModal extends ConsumerStatefulWidget {
  const SimulationDetailsModal({
    super.key,
    required this.scenario,
    required this.onStart,
  });

  final PathScenario scenario;

  /// Starts the scenario with the chosen language (`null` when the scenario
  /// has none to choose from), after the pre-start confirmation. Call
  /// [close] as soon as the start call has returned, before any follow-up
  /// modal or navigation; the modal also closes once this resolves.
  final Future<void> Function(int? languageId, VoidCallback close) onStart;

  /// Shows this as a non-dismissible-by-backdrop overlay (RN's `Modal` has
  /// no backdrop-tap-to-close either — only the X icon, via `onRequestClose`
  /// being wired to the same `onClose`). Resolves once the dialog is popped,
  /// whether by a successful start or the close button.
  static Future<void> show(
    BuildContext context, {
    required PathScenario scenario,
    required Future<void> Function(int? languageId, VoidCallback close) onStart,
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
  bool _hidden = false;

  @override
  void initState() {
    super.initState();
    final languages = widget.scenario.availableLanguages;
    if (languages != null && languages.isNotEmpty) {
      _selectedLanguage = languages.first;
    }
  }

  Future<void> _handleStart() async {
    // RN hides this modal while the NotificationModal is up; with its
    // barrier kept here, that one adds none of its own.
    setState(() => _hidden = true);
    final confirmed = await PreStartNotificationModal.show(
      context,
      barrierColor: Colors.transparent,
    );
    if (!mounted) return;
    setState(() {
      _hidden = false;
      _isStarting = confirmed;
    });
    if (!confirmed) return;
    var closed = false;
    void close() {
      if (closed || !mounted) return;
      closed = true;
      Navigator.of(context).pop();
    }

    try {
      await widget.onStart(_selectedLanguage?.languageId, close);
    } catch (_) {
      // The caller reports its own failures; RN closes regardless.
    }
    close();
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
    final video = scenario.coverVideoUrl;

    return PopScope(
      canPop: !_isStarting,
      child: Visibility(
        visible: !_hidden,
        maintainState: true,
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
                    padding: const EdgeInsets.only(
                      left: 16,
                      right: 16,
                      top: 16,
                    ),
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
                          // styles.mediaContainer padding 12 (always present):
                          // VideoPreview, else the cover image.
                          Padding(
                            padding: const EdgeInsets.all(12),
                            child: video != null && video.isNotEmpty
                                ? CoverVideoPreview(
                                    key: const Key(
                                      'simulation-details-modal-video',
                                    ),
                                    url: video,
                                    thumbnailUrl: cover,
                                  )
                                : cover == null || cover.isEmpty
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
                                              padding:
                                                  const EdgeInsets.symmetric(
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
      ),
    );
  }
}
