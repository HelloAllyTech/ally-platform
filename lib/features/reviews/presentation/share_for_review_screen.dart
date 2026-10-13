import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../data/reviews_repository.dart';

/// Port of ally-mobile (React Native)'s `ShareForReviewScreen` — a note
/// field + submit, creating a review tied to a completed scenario session.
/// Same POST /scenario-session-reviews contract (scenarioSessionId + note).
class ShareForReviewScreen extends ConsumerStatefulWidget {
  const ShareForReviewScreen({super.key, required this.scenarioSessionId});

  final String scenarioSessionId;

  @override
  ConsumerState<ShareForReviewScreen> createState() =>
      _ShareForReviewScreenState();
}

class _ShareForReviewScreenState extends ConsumerState<ShareForReviewScreen> {
  final _noteController = TextEditingController();
  bool _isSubmitting = false;
  String? _error;

  @override
  void dispose() {
    _noteController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _isSubmitting = true;
      _error = null;
    });
    try {
      await ref
          .read(reviewsRepositoryProvider)
          .createReview(
            scenarioSessionId: widget.scenarioSessionId,
            note: _noteController.text.trim(),
          );
      if (mounted) context.go('/home');
    } catch (e) {
      setState(() => _error = 'Failed to share for review: $e');
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Share for review')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('Add a note for your reviewer (optional):'),
            const SizedBox(height: 12),
            TextField(
              controller: _noteController,
              maxLines: 5,
              decoration: const InputDecoration(border: OutlineInputBorder()),
            ),
            if (_error != null) ...[
              const SizedBox(height: 12),
              Text(_error!, style: const TextStyle(color: Colors.red)),
            ],
            const SizedBox(height: 16),
            FilledButton(
              onPressed: _isSubmitting ? null : _submit,
              child: _isSubmitting
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Share'),
            ),
          ],
        ),
      ),
    );
  }
}
