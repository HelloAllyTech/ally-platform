import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/html_rich_text.dart';
import '../../../core/widgets/back_title_header.dart';
import '../data/simulation_models.dart';
import '../data/simulations_repository.dart';
import 'widgets/scenario_language_dropdown.dart';

/// Shared-link base for a scenario — RN's `env.ALLY_WEB_URL` (no equivalent
/// env config exists in this app yet; hardcoded the same way LoginScreen's
/// Terms/Privacy links are, matching the production value).
const _allyWebUrl = 'https://app.helloally.ai/';

/// Port of ally-mobile (React Native)'s `SimulationDetailsScreen` — scenario
/// detail + "start simulation", which calls the real
/// `scenario-session-start` endpoint and hands the resulting LiveKit
/// url/token to RoleplayVoiceScreen (Phase 1), closing the real
/// scenario → live session → feedback loop end to end.
///
/// Not ported: the "ready to begin?" NotificationModal RN shows before
/// starting, the video cover preview (RN's `VideoPreview`, shown instead
/// of the image when `coverVideoUrl` is set — no video-preview widget
/// exists yet, only the full course-item video player), the low-credits
/// illustrated modal, the active-simulation-conflict modal, and the
/// 429-rate-limit retry modal — same scope line `LearningPathDetailView`
/// already draws for the equivalent path/case flows.
class SimulationDetailsScreen extends ConsumerStatefulWidget {
  const SimulationDetailsScreen({
    super.key,
    required this.scenarioId,
    this.initialScenario,
  });

  final int scenarioId;

  /// The already-fetched `Scenario` from the catalog list, when reached that
  /// way — matches RN, which never fetches this screen's data separately at
  /// all (`route.params.scenario`). Falls back to a fresh by-id fetch only
  /// when absent (e.g. a future deep link with no list context to reuse).
  final Scenario? initialScenario;

  @override
  ConsumerState<SimulationDetailsScreen> createState() =>
      _SimulationDetailsScreenState();
}

class _SimulationDetailsScreenState
    extends ConsumerState<SimulationDetailsScreen> {
  bool _isStarting = false;
  String? _error;
  ScenarioLanguageOption? _selectedLanguage;
  bool _languageInitialized = false;

  void _ensureLanguageInitialized(Scenario scenario) {
    if (_languageInitialized) return;
    _languageInitialized = true;
    if (scenario.availableLanguages.isNotEmpty) {
      _selectedLanguage = scenario.availableLanguages.first;
    }
  }

  Future<void> _copyLink() async {
    await Clipboard.setData(
      ClipboardData(text: '${_allyWebUrl}scenario/${widget.scenarioId}'),
    );
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(ref.tr('simulationPage.linkCopiedToClipboard'))),
    );
  }

  Future<void> _startSimulation(Scenario scenario) async {
    setState(() {
      _isStarting = true;
      _error = null;
    });
    try {
      final session = await ref
          .read(simulationsRepositoryProvider)
          .startScenarioSession(
            scenarioId: widget.scenarioId,
            languageId: scenario.availableLanguages.isNotEmpty
                ? _selectedLanguage?.languageId
                : null,
          );
      if (mounted) {
        context.push(
          '/roleplay',
          extra: {
            'liveKitServerUrl': session.liveKitServerUrl,
            'accessToken': session.accessToken,
            'scenarioSessionId': session.id,
            'scenario': scenario,
          },
        );
      }
    } catch (e) {
      setState(() => _error = '${ref.tr('errors.startSimulation')}: $e');
    } finally {
      if (mounted) setState(() => _isStarting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final initialScenario = widget.initialScenario;
    final AsyncValue<Scenario> scenarioAsync = initialScenario != null
        ? AsyncValue.data(initialScenario)
        : ref.watch(scenarioByIdProvider(widget.scenarioId));

    return Scaffold(
      // RN's `safe` style: white, not the app's off-white background.
      backgroundColor: Colors.white,
      body: Column(
        children: [
          // RN's own renderHeader(): back arrow, then "Start" plain +
          // "Role play" italic.
          BackTitleHeader(
            title: ref.t('common.start'),
            italicTitle: ref.t('common.simulation'),
          ),
          Expanded(
            child: scenarioAsync.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (error, _) => Center(
                child: Text(
                  '${ref.t('learn.details.loadingDetailsError')}: $error',
                ),
              ),
              data: (scenario) {
                _ensureLanguageInitialized(scenario);
                return _buildBody(context, scenario);
              },
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBody(BuildContext context, Scenario scenario) {
    final imageUrl = scenario.coverImageUrl;
    final credits = ref.watch(simulationCreditsProvider).value;
    // RN's isStartSimulationDisabled: credits loaded and running low.
    final isStartDisabled = credits?.isLow ?? false;

    return Stack(
      children: [
        // RN's styles.container: paddingHorizontal 16, paddingBottom 90.
        ListView(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 90),
          children: [
            if (scenario.availableLanguages.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: ScenarioLanguageDropdown<ScenarioLanguageOption>(
                    options: scenario.availableLanguages,
                    selected: _selectedLanguage,
                    labelOf: (lang) => lang.label,
                    placeholder: ref.t('nav.language.label'),
                    enabled: !_isStarting,
                    onSelected: (lang) =>
                        setState(() => _selectedLanguage = lang),
                  ),
                ),
              ),
            // styles.imageContainer (marginBottom 12) — empty when the
            // scenario has no cover. The video cover isn't ported yet.
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: imageUrl == null || imageUrl.isEmpty
                  ? const SizedBox.shrink()
                  : ClipRRect(
                      borderRadius: BorderRadius.circular(8),
                      child: Image.network(
                        imageUrl,
                        height: 180,
                        width: double.infinity,
                        fit: BoxFit.cover,
                        errorBuilder: (_, _, _) =>
                            Container(height: 180, color: AppColors.lightGray4),
                        loadingBuilder: (context, child, progress) =>
                            progress == null
                            ? child
                            : Container(
                                height: 180,
                                color: AppColors.lightGray4,
                              ),
                      ),
                    ),
            ),
            // styles.row: title (max 85% wide) and the share icon, centred.
            Padding(
              padding: const EdgeInsets.only(right: 4),
              child: LayoutBuilder(
                builder: (context, constraints) => Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    ConstrainedBox(
                      constraints: BoxConstraints(
                        maxWidth: constraints.maxWidth * 0.85,
                      ),
                      child: Padding(
                        padding: const EdgeInsets.only(top: 18, bottom: 16),
                        // styles.cardTitle: IBM_PLEX_SERIF.MEDIUM 20, black.
                        child: Text(
                          scenario.title,
                          style: const TextStyle(
                            fontFamily: AppFonts.ibmPlexSerifMedium,
                            fontSize: 20,
                            color: Colors.black,
                          ),
                        ),
                      ),
                    ),
                    // <ShareIcon /> at its intrinsic 16x19.
                    GestureDetector(
                      key: const Key('simulation-details-share'),
                      behavior: HitTestBehavior.opaque,
                      onTap: _copyLink,
                      child: SvgPicture.asset('assets/icons/share.svg'),
                    ),
                  ],
                ),
              ),
            ),
            if (scenario.completedAttemptCount > 0)
              Align(
                alignment: Alignment.centerLeft,
                child: _CompletedChip(count: scenario.completedAttemptCount),
              ),
            _FieldLabel(ref.t('learn.scenario.scenarioLabel')),
            // RichText style={styles.description}: marginBottom 6.
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: HtmlRichText(html: scenario.description),
            ),
            if (scenario.triggerWarnings.isNotEmpty) ...[
              // RN appends ':' to a value that already ends in one
              // ("Trigger warnings::"); show it once.
              _FieldLabel(ref.t('common.triggerWarnings')),
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    for (final warning in scenario.triggerWarnings)
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 4,
                        ),
                        decoration: BoxDecoration(
                          color: AppColors.grey50,
                          borderRadius: BorderRadius.circular(999),
                          border: Border.all(
                            color: AppColors.grey300,
                            width: 0.5,
                          ),
                        ),
                        // styles.chipText: IBM_PLEX_SERIF.REGULAR + label.large.
                        child: Text(
                          warning,
                          style: const TextStyle(
                            fontFamily: AppFonts.ibmPlexSerifRegular,
                            fontSize: 14,
                            height: 22 / 14,
                            letterSpacing: 0.2,
                            color: AppColors.mediumEmphasis,
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ],
            if (_error != null) ...[
              const SizedBox(height: 16),
              Text(_error!, style: const TextStyle(color: AppColors.red400)),
            ],
          ],
        ),
        // styles.ctaWrapper: absolute, 24 from the sides, 40 from the bottom.
        Positioned(
          left: 24,
          right: 24,
          bottom: 40,
          child: AppButton(
            label: scenario.completedAttemptCount > 0
                ? ref.t('common.practiceAgain')
                : '${ref.t('common.start')} ${ref.t('common.simulation')}',
            isLoading: _isStarting,
            isDisabled: isStartDisabled,
            onPressed: () => _startSimulation(scenario),
          ),
        ),
      ],
    );
  }
}

/// styles.fieldLabel: IBM_PLEX_SERIF.MEDIUM 14, black, 2px below.
class _FieldLabel extends StatelessWidget {
  const _FieldLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 2),
      child: Text(
        text,
        style: const TextStyle(
          fontFamily: AppFonts.ibmPlexSerifMedium,
          fontSize: 14,
          fontWeight: FontWeight.w500,
          color: Colors.black,
        ),
      ),
    );
  }
}

/// RN's `styles.completedChip` — completing a scenario never locks it; this
/// is an invitation to run it again, not a status badge.
class _CompletedChip extends ConsumerWidget {
  const _CompletedChip({required this.count});

  final int count;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Container(
      key: const Key('simulation-details-completed-chip'),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      margin: const EdgeInsets.only(bottom: 4),
      decoration: BoxDecoration(
        color: AppColors.green50,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          // TickRoundIcon 14x14 (its #81C784 fill is baked into the SVG).
          SvgPicture.asset('assets/icons/tickRound.svg', width: 14, height: 14),
          const SizedBox(width: 4),
          Text(
            count == 1
                ? ref.t('simulations.completedChip_one')
                : ref.t('simulations.completedChip_other', {'count': count}),
            // styles.completedChipText: IBM_PLEX_SERIF.MEDIUM + label.large.
            style: const TextStyle(
              fontFamily: AppFonts.ibmPlexSerifMedium,
              fontSize: 14,
              height: 22 / 14,
              letterSpacing: 0.2,
              color: AppColors.green700,
            ),
          ),
        ],
      ),
    );
  }
}
