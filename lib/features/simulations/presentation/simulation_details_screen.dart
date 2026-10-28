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
/// Not ported: the video cover preview (RN's `VideoPreview`, shown instead
/// of the image when `coverVideoUrl` is set — no video-preview widget
/// exists yet, only the full course-item video player), the low-credits
/// illustrated modal, the active-simulation-conflict modal, and the
/// 429-rate-limit retry modal — same scope line `LearningPathDetailView`
/// already draws for the equivalent path/case flows.
class SimulationDetailsScreen extends ConsumerStatefulWidget {
  const SimulationDetailsScreen({super.key, required this.scenarioId, this.initialScenario});

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
      final session = await ref.read(simulationsRepositoryProvider).startScenarioSession(
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
                child: Text('${ref.t('learn.details.loadingDetailsError')}: $error'),
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
    return Stack(
      children: [
        ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
          children: [
            if (scenario.availableLanguages.isNotEmpty) ...[
              _LanguageDropdown(
                options: scenario.availableLanguages,
                selected: _selectedLanguage,
                enabled: !_isStarting,
                onSelected: (lang) => setState(() => _selectedLanguage = lang),
              ),
              const SizedBox(height: 12),
            ],
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: scenario.coverImageUrl != null
                  ? Image.network(
                      scenario.coverImageUrl!,
                      height: 180,
                      width: double.infinity,
                      fit: BoxFit.cover,
                      errorBuilder: (_, _, _) => Container(height: 180, color: AppColors.lightGray2),
                    )
                  : Container(height: 180, color: AppColors.lightGray2),
            ),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  // RN's styles.cardTitle: IBM_PLEX_SERIF.MEDIUM at 20px —
                  // not headlineSmall's ReplayPro-Headline at 24px (that's
                  // the screen's own pageTitle, a different element).
                  child: Padding(
                    padding: const EdgeInsets.only(top: 18, bottom: 16),
                    child: Text(
                      scenario.title,
                      style: const TextStyle(
                        fontFamily: AppFonts.ibmPlexSerifMedium,
                        fontSize: 20,
                        color: AppColors.highEmphasis,
                      ),
                    ),
                  ),
                ),
                IconButton(
                  icon: SvgPicture.asset('assets/icons/share.svg', width: 20, height: 20),
                  onPressed: _copyLink,
                ),
              ],
            ),
            if (scenario.completedAttemptCount > 0) ...[
              _CompletedChip(count: scenario.completedAttemptCount),
              const SizedBox(height: 8),
            ],
            Text(
              ref.t('learn.scenario.scenarioLabel'),
              style: const TextStyle(fontFamily: AppFonts.ibmPlexSerifMedium, fontSize: 14),
            ),
            const SizedBox(height: 2),
            HtmlRichText(html: scenario.description),
            if (scenario.triggerWarnings.isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(
                '${ref.t('common.triggerWarnings')}:',
                style: const TextStyle(fontFamily: AppFonts.ibmPlexSerifMedium, fontSize: 14),
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
                      child: Text(warning, style: const TextStyle(fontSize: 12, color: AppColors.mediumEmphasis)),
                    ),
                ],
              ),
            ],
            if (_error != null) ...[
              const SizedBox(height: 16),
              Text(_error!, style: const TextStyle(color: AppColors.red400)),
            ],
          ],
        ),
        Positioned(
          left: 24,
          right: 24,
          bottom: 40,
          child: AppButton(
            label: scenario.completedAttemptCount > 0
                ? ref.t('common.practiceAgain')
                : '${ref.t('common.start')} ${ref.t('common.simulation')}',
            isLoading: _isStarting,
            onPressed: () => _startSimulation(scenario),
          ),
        ),
      ],
    );
  }
}

/// RN's `ScenarioCompletion`-driven pill — completing a scenario never
/// locks it; this is an invitation to run it again, not a status badge.
class _CompletedChip extends ConsumerWidget {
  const _CompletedChip({required this.count});

  final int count;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      margin: const EdgeInsets.only(bottom: 4),
      decoration: BoxDecoration(
        color: const Color(0xFFE6F4EA),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.check_circle, size: 14, color: Colors.green),
          const SizedBox(width: 4),
          Text(
            count == 1
                ? ref.t('simulations.completedChip_one')
                : ref.t('simulations.completedChip_other', {'count': count}),
            style: const TextStyle(
              fontFamily: AppFonts.ibmPlexSerifMedium,
              fontSize: 12,
              color: Colors.green,
            ),
          ),
        ],
      ),
    );
  }
}

/// RN's `CustomDropdown` as used here — a pill header (selected label +
/// chevron) opening a popup list. Not a pixel port of the original's
/// custom animated modal-positioned dropdown, but the same selectable-pill
/// affordance and behavior.
class _LanguageDropdown extends StatelessWidget {
  const _LanguageDropdown({
    required this.options,
    required this.selected,
    required this.enabled,
    required this.onSelected,
  });

  final List<ScenarioLanguageOption> options;
  final ScenarioLanguageOption? selected;
  final bool enabled;
  final ValueChanged<ScenarioLanguageOption> onSelected;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.centerLeft,
      child: PopupMenuButton<ScenarioLanguageOption>(
        enabled: enabled,
        onSelected: onSelected,
        itemBuilder: (context) => [
          for (final option in options)
            PopupMenuItem(value: option, child: Text(option.label)),
        ],
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(4),
            border: Border.all(color: AppColors.lightGray2, width: 0.5),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(selected?.label ?? ''),
              const SizedBox(width: 8),
              SvgPicture.asset('assets/icons/arrowDown.svg', width: 8, height: 8),
            ],
          ),
        ),
      ),
    );
  }
}
