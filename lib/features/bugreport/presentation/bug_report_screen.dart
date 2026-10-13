import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/bug_report_repository.dart';

/// Scoped port of ally-mobile (React Native)'s `BugReportScreen` —
/// description field + submit. Device/app-state context attachment not
/// collected in this pass (see repository's doc comment).
class BugReportScreen extends ConsumerStatefulWidget {
  const BugReportScreen({super.key});

  @override
  ConsumerState<BugReportScreen> createState() => _BugReportScreenState();
}

class _BugReportScreenState extends ConsumerState<BugReportScreen> {
  final _controller = TextEditingController();
  bool _isSubmitting = false;
  bool _submitted = false;
  String? _error;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_controller.text.trim().isEmpty) {
      setState(() => _error = 'Please describe the issue.');
      return;
    }
    setState(() {
      _isSubmitting = true;
      _error = null;
    });
    try {
      await ref.read(bugReportRepositoryProvider).createBugReport(_controller.text.trim());
      if (mounted) setState(() => _submitted = true);
    } catch (e) {
      setState(() => _error = 'Failed to submit report: $e');
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Report a bug')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: _submitted
            ? const Center(child: Text('Thanks — your report was submitted.'))
            : Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  TextField(
                    controller: _controller,
                    maxLines: 6,
                    decoration: const InputDecoration(
                      labelText: 'What went wrong?',
                      border: OutlineInputBorder(),
                    ),
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
                        : const Text('Submit'),
                  ),
                ],
              ),
      ),
    );
  }
}
