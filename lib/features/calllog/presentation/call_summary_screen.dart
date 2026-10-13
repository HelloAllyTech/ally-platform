import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/call_log_repository.dart';

/// Scoped port of ally-mobile (React Native)'s `CallSummaryScreen`
/// (~7,000 lines in the original: full structured clinical documentation
/// form, AI-enhance, export, tag ratings, feedback). This shows the real
/// AI-generated session summary + key concerns (GET /chats/:id) and the
/// real message-by-message transcript (GET /chats/:id/messages) — the two
/// things a counsellor actually reads back after a session, not the full
/// editable clinical form.
class CallSummaryScreen extends ConsumerWidget {
  const CallSummaryScreen({super.key, required this.log});

  final CallLogItem log;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final summaryAsync = ref.watch(callSummaryProvider(log.id));
    final messagesAsync = ref.watch(chatMessagesProvider(log.id));

    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: Text(log.sessionName ?? 'Session #${log.id}'),
          bottom: const TabBar(tabs: [Tab(text: 'Summary'), Tab(text: 'Transcript')]),
        ),
        body: TabBarView(
          children: [
            _SummaryTab(log: log, summaryAsync: summaryAsync),
            _TranscriptTab(messagesAsync: messagesAsync, counselorId: summaryAsync.value?.counselorId),
          ],
        ),
      ),
    );
  }
}

class _SummaryTab extends StatelessWidget {
  const _SummaryTab({required this.log, required this.summaryAsync});

  final CallLogItem log;
  final AsyncValue<CallSummaryDetails> summaryAsync;

  @override
  Widget build(BuildContext context) {
    return summaryAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, _) => Center(child: Text('Failed to load summary: $error')),
      data: (summary) => ListView(
        padding: const EdgeInsets.all(24),
        children: [
          Text('Status: ${log.status}'),
          Text('Started: ${log.startedAt}'),
          if (log.endedAt.isNotEmpty) Text('Ended: ${log.endedAt}'),
          if (log.score != null) Text('Score: ${log.score}'),
          const SizedBox(height: 24),
          if (summary.sessionSummary != null) ...[
            Text('Session summary', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            Text(summary.sessionSummary!),
            const SizedBox(height: 24),
          ],
          if (summary.keyConcerns != null) ...[
            Text('Key concerns', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            Text(summary.keyConcerns!),
          ],
          if (summary.sessionSummary == null && summary.keyConcerns == null)
            const Text(
              'No AI summary available yet for this session.',
              style: TextStyle(color: Colors.grey),
            ),
        ],
      ),
    );
  }
}

class _TranscriptTab extends StatelessWidget {
  const _TranscriptTab({required this.messagesAsync, required this.counselorId});

  final AsyncValue<List<ChatMessage>> messagesAsync;
  final int? counselorId;

  @override
  Widget build(BuildContext context) {
    return messagesAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, _) => Center(child: Text('Failed to load transcript: $error')),
      data: (messages) {
        if (messages.isEmpty) {
          return const Center(child: Text('No transcript available.'));
        }
        return ListView.builder(
          padding: const EdgeInsets.all(16),
          itemCount: messages.length,
          itemBuilder: (context, index) {
            final message = messages[index];
            final isCounselor = message.senderId == counselorId;
            return Align(
              alignment: isCounselor ? Alignment.centerRight : Alignment.centerLeft,
              child: Container(
                margin: const EdgeInsets.symmetric(vertical: 4),
                padding: const EdgeInsets.all(12),
                constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.75),
                decoration: BoxDecoration(
                  color: isCounselor
                      ? Theme.of(context).colorScheme.primaryContainer
                      : Colors.grey.shade200,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(message.content),
              ),
            );
          },
        );
      },
    );
  }
}
