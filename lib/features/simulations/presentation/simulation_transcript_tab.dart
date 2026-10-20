import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_fonts.dart';
import '../data/simulation_transcript_repository.dart';

/// Port of ally-mobile (React Native)'s `TranscriptTab`/`SimulationTranscript`
/// — chronological, paginated turn-by-turn transcript. Scoped to the
/// transcript list itself: the RN original's audio-player scrubbing,
/// scroll-to-playback-position, translation-language dropdown, and
/// debrief-chip moment-focus aren't ported (no audio player or supervisor-
/// note chip linking exist yet in this app to drive them).
class SimulationTranscriptTab extends ConsumerStatefulWidget {
  const SimulationTranscriptTab({super.key, required this.scenarioSessionId});

  final String scenarioSessionId;

  @override
  ConsumerState<SimulationTranscriptTab> createState() =>
      _SimulationTranscriptTabState();
}

class _SimulationTranscriptTabState
    extends ConsumerState<SimulationTranscriptTab> {
  final _scrollController = ScrollController();
  final List<SimulationTranscriptMessage> _messages = [];
  int _offset = 0;
  int? _totalCount;
  bool _isLoading = true;
  bool _isLoadingMore = false;
  bool _hasMore = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
    _loadFirstPage();
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (_scrollController.position.pixels >=
        _scrollController.position.maxScrollExtent - 200) {
      _loadMore();
    }
  }

  Future<void> _loadFirstPage() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final result = await ref
          .read(simulationTranscriptRepositoryProvider)
          .getMessages(scenarioSessionId: widget.scenarioSessionId, offset: 0);
      setState(() {
        _messages
          ..clear()
          ..addAll(result.messages);
        _totalCount = result.count;
        _offset = result.messages.length;
        _hasMore =
            result.messages.isNotEmpty && _messages.length < result.count;
      });
    } catch (e) {
      setState(() => _error = '${ref.tr('postSim.tabs.transcriptTranslationFailed')}: $e');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _loadMore() async {
    if (_isLoading || _isLoadingMore || !_hasMore) return;
    setState(() => _isLoadingMore = true);
    try {
      final result = await ref
          .read(simulationTranscriptRepositoryProvider)
          .getMessages(
            scenarioSessionId: widget.scenarioSessionId,
            offset: _offset,
          );
      // Dedupe, same reasoning as the RN hook: a page that loops back onto
      // already-seen ids means there's nothing further to fetch.
      final seenIds = _messages.map((m) => m.id).toSet();
      final newMessages = result.messages
          .where((m) => !seenIds.contains(m.id))
          .toList();
      setState(() {
        _messages.addAll(newMessages);
        _offset += result.messages.length;
        final total = _totalCount ?? result.count;
        _hasMore = newMessages.isNotEmpty && _messages.length < total;
      });
    } catch (_) {
      // Stays retryable on the next scroll tick, same as the RN hook.
    } finally {
      if (mounted) setState(() => _isLoadingMore = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) return const Center(child: CircularProgressIndicator());
    if (_error != null) {
      return Center(
        child: Text(_error!, style: const TextStyle(color: Colors.red)),
      );
    }
    if (_messages.isEmpty) {
      return Center(
        child: Text(ref.t('transcription.empty')),
      );
    }

    return ListView.builder(
      controller: _scrollController,
      padding: const EdgeInsets.all(16),
      itemCount: _messages.length + (_isLoadingMore ? 1 : 0),
      itemBuilder: (context, index) {
        if (index >= _messages.length) {
          return const Padding(
            padding: EdgeInsets.all(16),
            child: Center(child: CircularProgressIndicator()),
          );
        }
        final message = _messages[index];
        return Padding(
          padding: const EdgeInsets.only(bottom: 16),
          child: Column(
            crossAxisAlignment: message.isLearner
                ? CrossAxisAlignment.end
                : CrossAxisAlignment.start,
            children: [
              // RN's SimulationTranscriptItem styles.timeText/timeInline:
              // IBM_PLEX_SERIF.REGULAR — not labelSmall's Roboto.
              Text(
                '${message.isLearner ? ref.t('transcription.youLabel') : ref.t('transcription.clientLabel')} · ${message.formattedTime}',
                style: Theme.of(context)
                    .textTheme
                    .labelSmall
                    ?.copyWith(fontFamily: AppFonts.ibmPlexSerifRegular),
              ),
              const SizedBox(height: 4),
              Container(
                constraints: const BoxConstraints(maxWidth: 320),
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 8,
                ),
                decoration: BoxDecoration(
                  color: message.isLearner
                      ? Theme.of(context).colorScheme.primaryContainer
                      : Theme.of(context).colorScheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(message.content),
              ),
            ],
          ),
        );
      },
    );
  }
}
