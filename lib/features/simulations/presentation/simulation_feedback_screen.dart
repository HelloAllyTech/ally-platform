import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../data/simulation_models.dart';
import '../data/simulations_repository.dart';

/// Scoped port of ally-mobile (React Native)'s `SimulationFeedbackScreen` —
/// the original is ~9,100 lines (transcript tabs with tappable supervisor-
/// note anchors, per-skill scoring breakdowns, reactions). This covers the
/// real AI-generated debrief (score, what-went-well, areas-for-improvement
/// — same `getSimulationDetails` data the original fetches) plus the
/// feedback *submission* form. Turn-by-turn transcript display
/// (`TranscriptTab.tsx`) and per-skill category scoring are real further
/// work, not ported here.
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
      setState(() => _error = 'Please select a rating.');
      return;
    }
    setState(() {
      _isSubmitting = true;
      _error = null;
    });
    try {
      await ref.read(simulationsRepositoryProvider).addSimulationFeedback(
            scenarioSessionId: widget.scenarioSessionId,
            rating: _rating,
            comment: _commentController.text.trim(),
          );
      if (mounted) setState(() => _submitted = true);
    } catch (e) {
      setState(() => _error = 'Failed to submit feedback: $e');
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final summaryAsync = ref.watch(simulationSummaryProvider(widget.scenarioSessionId));

    return Scaffold(
      appBar: AppBar(title: const Text('Session feedback')),
      body: ListView(
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
                const Text('Thanks for your feedback!'),
                const SizedBox(height: 24),
                OutlinedButton(
                  onPressed: () =>
                      context.push('/share-for-review/${widget.scenarioSessionId}'),
                  child: const Text('Share this session for review'),
                ),
                const SizedBox(height: 12),
                FilledButton(
                  onPressed: () => context.go('/home'),
                  child: const Text('Back to home'),
                ),
              ],
            )
          else
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('How did that session go?', style: Theme.of(context).textTheme.titleLarge),
                const SizedBox(height: 16),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: List.generate(5, (index) {
                    final starValue = index + 1;
                    return IconButton(
                      iconSize: 36,
                      onPressed: () => setState(() => _rating = starValue),
                      icon: Icon(
                        starValue <= _rating ? Icons.star : Icons.star_border,
                        color: Colors.amber,
                      ),
                    );
                  }),
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: _commentController,
                  maxLines: 4,
                  decoration: const InputDecoration(
                    labelText: 'Any comments? (optional)',
                    border: OutlineInputBorder(),
                  ),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 12),
                  Text(_error!, style: const TextStyle(color: Colors.red)),
                ],
                const SizedBox(height: 24),
                FilledButton(
                  onPressed: _isSubmitting ? null : _submit,
                  child: _isSubmitting
                      ? const SizedBox(
                          width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Text('Submit feedback'),
                ),
              ],
            ),
        ],
      ),
    );
  }
}

class _SummarySection extends StatelessWidget {
  const _SummarySection({required this.summary});

  final SimulationSummary summary;

  @override
  Widget build(BuildContext context) {
    final duration = summary.endedAt != null
        ? DateTime.parse(summary.endedAt!).difference(DateTime.parse(summary.startedAt))
        : null;

    return Card(
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
                    backgroundColor: Theme.of(context).colorScheme.primaryContainer,
                    child: Text(
                      summary.score!.round().toString(),
                      style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18),
                    ),
                  ),
                  const SizedBox(width: 16),
                ],
                if (duration != null) Text('${duration.inMinutes} min session'),
              ],
            ),
            if (summary.whatWentWell.isNotEmpty) ...[
              const SizedBox(height: 16),
              Text('What went well', style: Theme.of(context).textTheme.titleSmall),
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
              Text('Areas for improvement', style: Theme.of(context).textTheme.titleSmall),
              for (final item in summary.areasForImprovement)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Icon(Icons.arrow_upward, size: 16, color: Colors.orange),
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
