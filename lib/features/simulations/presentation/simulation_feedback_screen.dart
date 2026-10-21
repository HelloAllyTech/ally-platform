import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/localization/localization_controller.dart';
import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/app_text_field.dart';
import '../data/simulation_models.dart';
import '../data/simulations_repository.dart';
import 'simulation_transcript_tab.dart';

/// Scoped port of ally-mobile (React Native)'s `SimulationFeedbackScreen` —
/// the original is ~9,100 lines (tappable supervisor-note anchors into the
/// transcript, Ask-AI chat, event checklist, reactions). This covers the
/// real AI-generated debrief (score, what-went-well, areas-for-improvement
/// — same `getSimulationDetails` data the original fetches), the feedback
/// *submission* form, and the turn-by-turn transcript tab
/// (`TranscriptTab`/`SimulationTranscript` — see `simulation_transcript_tab.dart`).
/// No per-skill-category scoring exists to port: the RN data model
/// (`SimulationSummaryData`) has no such field for simulation sessions —
/// that concept exists only for course Track feedback
/// (`TrackSkillCategoryFeedback` in `src/types/courses.ts`), a different
/// screen entirely.
class SimulationFeedbackScreen extends ConsumerStatefulWidget {
  const SimulationFeedbackScreen({super.key, required this.scenarioSessionId});

  final String scenarioSessionId;

  @override
  ConsumerState<SimulationFeedbackScreen> createState() =>
      _SimulationFeedbackScreenState();
}

class _SimulationFeedbackScreenState
    extends ConsumerState<SimulationFeedbackScreen> {
  int _rating = 0;
  final _selectedTags = <String>{};
  final _commentController = TextEditingController();
  bool _isSubmitting = false;
  bool _submitted = false;
  String? _error;

  @override
  void dispose() {
    _commentController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_rating == 0) {
      setState(() => _error = ref.tr('postSim.feedback.ratingRequired'));
      return;
    }
    setState(() {
      _isSubmitting = true;
      _error = null;
    });
    try {
      await ref
          .read(simulationsRepositoryProvider)
          .addSimulationFeedback(
            scenarioSessionId: widget.scenarioSessionId,
            rating: _rating,
            comment: _commentController.text.trim(),
            tags: _selectedTags.toList(),
          );
      if (mounted) setState(() => _submitted = true);
    } catch (e) {
      setState(
        () => _error = '${ref.tr('callFeedback.failSubmitFeedback')}: $e',
      );
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  /// Mirrors RN's forced-feedback exit interception
  /// (`handleFeedbackAndNavigate`/`feedbackPopupSource.current = 'leave'`):
  /// leaving before rating re-surfaces the ask instead of silently letting
  /// the learner go. This port's rating form is already inline (no separate
  /// popup to auto-open), so the prompt is a plain confirm dialog rather
  /// than reopening a modal.
  Future<void> _confirmLeave() async {
    final shouldLeave = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(ref.tr('postSim.feedback.ratingPrompt')),
        content: Text(ref.tr('postSim.feedback.ratingRequired')),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(ref.tr('common.cancel')),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(ref.tr('common.discard')),
          ),
        ],
      ),
    );
    if (shouldLeave == true && mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      // Already submitted (or came in with feedback already present) —
      // nothing forcing an exit prompt.
      canPop: _submitted,
      onPopInvokedWithResult: (didPop, result) {
        if (!didPop) _confirmLeave();
      },
      child: DefaultTabController(
        length: 2,
        child: Scaffold(
          appBar: AppBar(
            title: Text(ref.t('postSim.feedback.sessionFeedback')),
            bottom: TabBar(
              tabs: [
                Tab(text: ref.t('postSim.tabs.debrief')),
                Tab(text: ref.t('postSim.tabs.transcript')),
              ],
            ),
          ),
          body: TabBarView(
            children: [
              _buildDebriefTab(context),
              SimulationTranscriptTab(
                scenarioSessionId: widget.scenarioSessionId,
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildDebriefTab(BuildContext context) {
    final summaryAsync = ref.watch(
      simulationSummaryProvider(widget.scenarioSessionId),
    );

    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        summaryAsync.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          // A missing/failed debrief shouldn't block submitting feedback —
          // it may still be generating. Just skip the summary section.
          error: (_, _) => const SizedBox.shrink(),
          data: (summary) => _SummarySection(summary: summary),
        ),
        const SizedBox(height: 24),
        if (_submitted)
          Column(
            children: [
              const Icon(Icons.check_circle, color: Colors.green, size: 64),
              const SizedBox(height: 16),
              Text(ref.t('callFeedback.submitted')),
              const SizedBox(height: 24),
              AppButton(
                variant: AppButtonVariant.secondary,
                label: ref.t('postSim.common.shareForReview'),
                onPressed: () => context.push(
                  '/share-for-review/${widget.scenarioSessionId}',
                ),
              ),
              const SizedBox(height: 12),
              AppButton(
                label: ref.t('common.backToHome'),
                onPressed: () => context.go('/home'),
              ),
            ],
          )
        else
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                ref.t('postSim.feedback.ratingPrompt'),
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 16),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: List.generate(5, (index) {
                  final starValue = index + 1;
                  return IconButton(
                    iconSize: 36,
                    // Matches RN's `setStarRating`: picking a new rating
                    // clears any tags chosen for the previous one (each
                    // rating has its own distinct tag set).
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
              if (_rating > 0) _buildRatingTags(),
              const SizedBox(height: 16),
              AppTextField(
                controller: _commentController,
                maxLines: 4,
                placeholder: ref.t('postSim.feedback.commentLabel'),
              ),
              if (_error != null) ...[
                const SizedBox(height: 12),
                Text(_error!, style: const TextStyle(color: AppColors.red400)),
              ],
              const SizedBox(height: 24),
              AppButton(
                label: ref.t('common.submit'),
                isLoading: _isSubmitting,
                onPressed: _submit,
              ),
            ],
          ),
      ],
    );
  }

  /// Mirrors RN's `FeedbackPopup`'s `ratingTagOptions`/`handleTagSelectionChange`
  /// — a rating-specific set of short descriptor tags
  /// (`postSim.feedback.dialog.rating.tags.<rating>`, a translated string
  /// array rather than a single interpolatable key, hence `.raw(...)` not
  /// `.t(...)`), toggled on tap and included in the feedback submission.
  Widget _buildRatingTags() {
    final tags =
        ref
                .watch(localizationControllerProvider)
                .value
                ?.raw('postSim.feedback.dialog.rating.tags.$_rating')
            as List<dynamic>? ??
        const [];
    if (tags.isEmpty) return const SizedBox.shrink();

    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Wrap(
        spacing: 8,
        runSpacing: 8,
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
    );
  }
}

class _SummarySection extends ConsumerWidget {
  const _SummarySection({required this.summary});

  final SimulationSummary summary;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final duration = summary.endedAt != null
        ? DateTime.parse(summary.endedAt!)
              .difference(DateTime.parse(summary.startedAt))
        : null;

    return AppCard(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                if (summary.score != null) ...[
                  CircleAvatar(
                    radius: 28,
                    backgroundColor: Theme.of(context)
                        .colorScheme
                        .primaryContainer,
                    child: Text(
                      summary.score!.round().toString(),
                      style: const TextStyle(
                        fontWeight: FontWeight.bold,
                        fontSize: 18,
                      ),
                    ),
                  ),
                  const SizedBox(width: 16),
                ],
                if (duration != null)
                  Text(
                    ref.t('postSim.feedback.sessionDuration', {
                      'minutes': duration.inMinutes,
                    }),
                  ),
              ],
            ),
            if (summary.whatWentWell.isNotEmpty) ...[
              const SizedBox(height: 16),
              Text(
                ref.t('postSim.feedback.whatWentWell'),
                style: Theme.of(context).textTheme.titleSmall,
              ),
              for (final item in summary.whatWentWell)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Icon(Icons.check, size: 16, color: Colors.green),
                      const SizedBox(width: 8),
                      Expanded(child: Text(item)),
                    ],
                  ),
                ),
            ],
            if (summary.areasForImprovement.isNotEmpty) ...[
              const SizedBox(height: 16),
              Text(
                ref.t('postSim.feedback.areasForImprovement'),
                style: Theme.of(context).textTheme.titleSmall,
              ),
              for (final item in summary.areasForImprovement)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Icon(
                        Icons.arrow_upward,
                        size: 16,
                        color: Colors.orange,
                      ),
                      const SizedBox(width: 8),
                      Expanded(child: Text(item)),
                    ],
                  ),
                ),
            ],
          ],
        ),
      ),
    );
  }
}
