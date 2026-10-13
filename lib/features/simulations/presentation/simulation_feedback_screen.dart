import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../data/simulations_repository.dart';

/// Scoped port of ally-mobile (React Native)'s `SimulationFeedbackScreen` —
/// the original is ~9,100 lines (transcript tabs, debrief sections,
/// per-skill scoring breakdowns, reactions). This covers only the feedback
/// *submission* form (star rating + comment, POST
/// /learn/scenario-session/:id/feedback) — the real post-session analytics
/// display is substantial separate work for a later pass.
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
    return Scaffold(
      appBar: AppBar(title: const Text('Session feedback')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: _submitted
            ? Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(Icons.check_circle, color: Colors.green, size: 64),
                  const SizedBox(height: 16),
                  const Text('Thanks for your feedback!'),
                  const SizedBox(height: 24),
                  FilledButton(
                    onPressed: () => context.go('/home'),
                    child: const Text('Back to home'),
                  ),
                ],
              )
            : Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'How did that session go?',
                    style: Theme.of(context).textTheme.headlineSmall,
                  ),
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
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Text('Submit feedback'),
                  ),
                ],
              ),
      ),
    );
  }
}
