import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/call_log_repository.dart';
import '../data/call_summary_fields.dart';

/// Scoped port of ally-mobile (React Native)'s `CallSummaryScreen` — the
/// full structured clinical documentation form (`summaryFieldDefs`,
/// ported from `src/constants/summary.ts`'s `SECTION_LIST`/`summaryFields`:
/// demographics, flow, key concerns, observations, assessment, intake/risk
/// screening, ongoing risks, and more), editable and saved back via
/// `updateCallSummary`, plus the real message-by-message transcript. Not
/// ported: AI-enhance per section, export, tag *ratings* (as opposed to
/// tag names, which are editable here), the Ask-AI chat, and the
/// separately backend-configurable "custom fields" system.
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
          bottom: const TabBar(
            tabs: [
              Tab(text: 'Summary'),
              Tab(text: 'Transcript'),
            ],
          ),
        ),
        body: TabBarView(
          children: [
            _SummaryTab(log: log, summaryAsync: summaryAsync),
            _TranscriptTab(
              messagesAsync: messagesAsync,
              counselorId: summaryAsync.value?.counselorId,
            ),
          ],
        ),
      ),
    );
  }
}

class _SummaryTab extends ConsumerStatefulWidget {
  const _SummaryTab({required this.log, required this.summaryAsync});

  final CallLogItem log;
  final AsyncValue<CallSummaryDetails> summaryAsync;

  @override
  ConsumerState<_SummaryTab> createState() => _SummaryTabState();
}

class _SummaryTabState extends ConsumerState<_SummaryTab> {
  final Map<String, dynamic> _formValues = {};
  final Set<String> _dirtyKeys = {};
  String? _seededForChatId;
  bool _isSaving = false;
  String? _error;

  void _seedIfNeeded(CallSummaryDetails summary) {
    final key = '${widget.log.id}';
    if (_seededForChatId == key) return;
    _formValues
      ..clear()
      ..addAll(summary.fields);
    _dirtyKeys.clear();
    _seededForChatId = key;
  }

  void _onFieldChanged(String fieldKey, dynamic value) {
    setState(() {
      _formValues[fieldKey] = value;
      _dirtyKeys.add(fieldKey);
    });
  }

  Future<void> _save() async {
    if (_dirtyKeys.isEmpty) return;
    setState(() {
      _isSaving = true;
      _error = null;
    });
    try {
      final patch = {for (final key in _dirtyKeys) key: _formValues[key]};
      await ref
          .read(callLogRepositoryProvider)
          .updateCallSummary(widget.log.id, patch);
      _dirtyKeys.clear();
      ref.invalidate(callSummaryProvider(widget.log.id));
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Summary saved.')));
      }
    } catch (e) {
      setState(() => _error = 'Failed to save: $e');
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return widget.summaryAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, _) =>
          Center(child: Text('Failed to load summary: $error')),
      data: (summary) {
        _seedIfNeeded(summary);
        return Column(
          children: [
            Expanded(
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Text('Status: ${widget.log.status}'),
                  Text('Started: ${widget.log.startedAt}'),
                  if (widget.log.endedAt.isNotEmpty)
                    Text('Ended: ${widget.log.endedAt}'),
                  if (widget.log.score != null)
                    Text('Score: ${widget.log.score}'),
                  const SizedBox(height: 16),
                  for (final section in SummarySection.values)
                    _SectionCard(
                      section: section,
                      formValues: _formValues,
                      onFieldChanged: _onFieldChanged,
                    ),
                ],
              ),
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Text(_error!, style: const TextStyle(color: Colors.red)),
              ),
            SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: (_dirtyKeys.isEmpty || _isSaving) ? null : _save,
                    child: _isSaving
                        ? const SizedBox(
                            height: 18,
                            width: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : Text(
                            _dirtyKeys.isEmpty ? 'No changes' : 'Save changes',
                          ),
                  ),
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}

class _SectionCard extends StatelessWidget {
  const _SectionCard({
    required this.section,
    required this.formValues,
    required this.onFieldChanged,
  });

  final SummarySection section;
  final Map<String, dynamic> formValues;
  final void Function(String fieldKey, dynamic value) onFieldChanged;

  @override
  Widget build(BuildContext context) {
    final fields = summaryFieldDefs.where((f) => f.section == section).toList();
    // The RN screen also hides a section with no tenant-configured
    // "visible fields" (a backend-driven per-org form config, Redux
    // `selectSummaryVisibleFields`) — not ported, so every section in the
    // catalog shows here regardless of whether it has data yet, which
    // matters for a section the counsellor still needs to fill in.
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: ExpansionTile(
        title: Text(section.label),
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final field in fields)
                  _FieldEditor(
                    field: field,
                    formValues: formValues,
                    onChanged: onFieldChanged,
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _FieldEditor extends StatelessWidget {
  const _FieldEditor({
    required this.field,
    required this.formValues,
    required this.onChanged,
  });

  final SummaryFieldDef field;
  final Map<String, dynamic> formValues;
  final void Function(String fieldKey, dynamic value) onChanged;

  @override
  Widget build(BuildContext context) {
    final value = formValues[field.key];

    if (!field.editable) {
      final display = value == null || value.toString().trim().isEmpty
          ? '—'
          : value.toString();
      return Padding(
        padding: const EdgeInsets.only(top: 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(field.label, style: Theme.of(context).textTheme.labelMedium),
            Text(display),
          ],
        ),
      );
    }

    if (field.type == SummaryFieldType.dropdown) {
      final options = field.options ?? const [];
      final currentValue = options.contains(value) ? value as String : null;
      return Padding(
        padding: const EdgeInsets.only(top: 8),
        child: DropdownButtonFormField<String>(
          initialValue: currentValue,
          decoration: InputDecoration(
            labelText: field.label,
            border: const OutlineInputBorder(),
          ),
          items: [
            for (final option in options)
              DropdownMenuItem(value: option, child: Text(option)),
          ],
          onChanged: (selected) => onChanged(field.key, selected),
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: TextFormField(
        key: ValueKey(field.key),
        initialValue: value?.toString() ?? '',
        maxLines: field.type == SummaryFieldType.multilineText ? 4 : 1,
        decoration: InputDecoration(
          labelText: field.label,
          border: const OutlineInputBorder(),
        ),
        onChanged: (text) => onChanged(field.key, text),
      ),
    );
  }
}

class _TranscriptTab extends StatelessWidget {
  const _TranscriptTab({
    required this.messagesAsync,
    required this.counselorId,
  });

  final AsyncValue<List<ChatMessage>> messagesAsync;
  final int? counselorId;

  @override
  Widget build(BuildContext context) {
    return messagesAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, _) =>
          Center(child: Text('Failed to load transcript: $error')),
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
              alignment: isCounselor
                  ? Alignment.centerRight
                  : Alignment.centerLeft,
              child: Container(
                margin: const EdgeInsets.symmetric(vertical: 4),
                padding: const EdgeInsets.all(12),
                constraints: BoxConstraints(
                  maxWidth: MediaQuery.sizeOf(context).width * 0.75,
                ),
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
