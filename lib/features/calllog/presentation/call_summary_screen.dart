import 'package:flutter/material.dart';

import '../data/call_log_repository.dart';

/// Heavily scoped port of ally-mobile (React Native)'s `CallSummaryScreen`
/// (~7,000 lines in the original: transcript, AI-generated notes, export,
/// field editing). This shows the basic session facts only — transcript and
/// notes are real, separate work for a later phase.
class CallSummaryScreen extends StatelessWidget {
  const CallSummaryScreen({super.key, required this.log});

  final CallLogItem log;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(log.sessionName ?? 'Session #${log.id}')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Status: ${log.status}'),
            Text('Started: ${log.startedAt}'),
            if (log.endedAt.isNotEmpty) Text('Ended: ${log.endedAt}'),
            if (log.score != null) Text('Score: ${log.score}'),
            const SizedBox(height: 24),
            const Text(
              'Transcript and AI-generated notes aren\'t ported yet in this '
              'build.',
              style: TextStyle(color: Colors.grey),
            ),
          ],
        ),
      ),
    );
  }
}
