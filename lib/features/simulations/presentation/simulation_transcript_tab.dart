import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/widgets/root_scaffold_messenger.dart';
import '../data/simulation_transcript_repository.dart';
import 'widgets/feedback/feedback_widgets.dart';

/// A "See this moment" jump from the debrief (RN `TranscriptFocusRequest`):
/// [requestId] makes a repeat tap on the same chip a new request.
typedef TranscriptFocusRequest = ({String messageId, int requestId});

/// Port of RN `TranscriptTab` → `SimulationTranscript` +
/// `SimulationTranscriptItem`: a "Transcript" card with the accuracy
/// disclaimer and the paginated turn-by-turn list (10 per page, loaded on
/// scroll). Each turn is a tinted, outlined card — blue for the learner,
/// purple for the AI client — headed `mm:ss Speaker`.
///
/// A [focusMessage] from a debrief chip pages forward until that row has
/// loaded, scrolls it into view (30% from the top) and outlines it for
/// 2.5s; if the transcript runs out first, a toast says so.
///
/// Not ported: the session-recording audio player (and its playback-synced
/// highlighting / tap-to-seek) and the transcript-translation language
/// dropdown in the card's title row.
class SimulationTranscriptTab extends ConsumerStatefulWidget {
  const SimulationTranscriptTab({
    super.key,
    required this.scenarioSessionId,
    this.agentName,
    this.focusMessage,
  });

  final String scenarioSessionId;

  /// The simulated client's name (`scenario.metadata.name`).
  final String? agentName;
  final TranscriptFocusRequest? focusMessage;

  @override
  ConsumerState<SimulationTranscriptTab> createState() => _SimulationTranscriptTabState();
}

class _SimulationTranscriptTabState extends ConsumerState<SimulationTranscriptTab> {
  static const _focusHighlight = Duration(milliseconds: 2500);

  final _scrollController = ScrollController();
  final List<SimulationTranscriptMessage> _messages = [];
  final Map<int, GlobalKey> _itemKeys = {};
  int _offset = 0;
  int? _totalCount;
  bool _isLoading = true;
  bool _isLoadingMore = false;
  bool _hasMore = true;
  String? _focusedMessageId;
  int? _handledFocusRequest;
  Timer? _focusTimer;

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
    _loadFirstPage();
  }

  @override
  void didUpdateWidget(SimulationTranscriptTab oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.focusMessage?.requestId != oldWidget.focusMessage?.requestId) _chaseFocus();
  }

  @override
  void dispose() {
    _focusTimer?.cancel();
    _scrollController.dispose();
    super.dispose();
  }

  void _onScroll() {
    final position = _scrollController.position;
    if (position.pixels >= position.maxScrollExtent * 0.9) _loadMore();
  }

  Future<void> _loadFirstPage() async {
    setState(() => _isLoading = true);
    try {
      final result = await ref
          .read(simulationTranscriptRepositoryProvider)
          .getMessages(scenarioSessionId: widget.scenarioSessionId, offset: 0);
      if (!mounted) return;
      setState(() {
        _messages
          ..clear()
          ..addAll(result.messages);
        _totalCount = result.count;
        _offset = result.messages.length;
        _hasMore = result.messages.isNotEmpty && _messages.length < result.count;
      });
    } catch (e) {
      // RN `showErrorToast(error, 'postSim.tabs.transcriptTranslationFailed')`.
      if (mounted) {
        _hasMore = false;
        rootScaffoldMessengerKey.currentState?.showSnackBar(
          SnackBar(content: Text(ref.tr('postSim.tabs.transcriptTranslationFailed'))),
        );
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
    _chaseFocus();
  }

  Future<void> _loadMore() async {
    if (_isLoading || _isLoadingMore || !_hasMore) return;
    setState(() => _isLoadingMore = true);
    try {
      final result = await ref
          .read(simulationTranscriptRepositoryProvider)
          .getMessages(scenarioSessionId: widget.scenarioSessionId, offset: _offset);
      if (!mounted) return;
      // A page that loops back onto already-seen ids means there's nothing
      // further to fetch (same dedupe as the RN hook).
      final seenIds = _messages.map((m) => m.id).toSet();
      final newMessages = result.messages.where((m) => !seenIds.contains(m.id)).toList();
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
    _chaseFocus();
  }

  /// RN's "moment chase" effect.
  void _chaseFocus() {
    final focus = widget.focusMessage;
    if (!mounted || focus == null || _handledFocusRequest == focus.requestId) return;
    final index = _messages.indexWhere((m) => '${m.id}' == focus.messageId);
    if (index != -1) {
      _handledFocusRequest = focus.requestId;
      _focusTimer?.cancel();
      setState(() => _focusedMessageId = focus.messageId);
      _focusTimer = Timer(_focusHighlight, () {
        if (mounted) setState(() => _focusedMessageId = null);
      });
      _scrollToIndex(index);
      return;
    }
    if (_hasMore) {
      if (!_isLoading && !_isLoadingMore) _loadMore();
      return;
    }
    if (_isLoading) return;
    _handledFocusRequest = focus.requestId;
    rootScaffoldMessengerKey.currentState?.showSnackBar(
      SnackBar(content: Text(ref.tr('postSim.debrief.momentNotFound'))),
    );
  }

  /// Rows are variable-height, so jump near the row's estimated offset to
  /// get it built, then let `ensureVisible` place it 30% from the top
  /// (RN `scrollToIndex({viewPosition: 0.3})`).
  void _scrollToIndex(int index) {
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      if (!mounted || !_scrollController.hasClients) return;
      final id = _messages[index].id;
      var context = _itemKeys[id]?.currentContext;
      if (context == null) {
        final position = _scrollController.position;
        final estimate = position.maxScrollExtent * index / _messages.length.clamp(1, 1 << 30);
        _scrollController.jumpTo(estimate.clamp(0, position.maxScrollExtent));
        await WidgetsBinding.instance.endOfFrame;
        context = _itemKeys[id]?.currentContext;
      }
      if (context != null && context.mounted) {
        await Scrollable.ensureVisible(
          context,
          alignment: 0.3,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      }
    });
  }

  String _speakerLabel(SimulationTranscriptMessage message) {
    if (message.isLearner) return ref.t('transcription.youLabel');
    final suffix = ref.t('transcription.aiClientSuffix');
    final name = widget.agentName;
    return (name != null && name.isNotEmpty) ? '$name ($suffix)' : suffix;
  }

  @override
  Widget build(BuildContext context) {
    final Widget body;
    if (_isLoading && _messages.isEmpty) {
      body = const Center(child: CircularProgressIndicator(color: AppColors.primary));
    } else if (_messages.isEmpty) {
      body = const _EmptyTranscript();
    } else {
      body = ListView.builder(
        key: const Key('transcript-list'),
        controller: _scrollController,
        padding: const EdgeInsets.only(bottom: 100),
        itemCount: _messages.length + (_isLoadingMore ? 1 : 0),
        itemBuilder: (context, index) {
          if (index >= _messages.length) {
            return const Center(child: CircularProgressIndicator(color: AppColors.primary));
          }
          final message = _messages[index];
          return TranscriptItem(
            key: _itemKeys.putIfAbsent(message.id, GlobalKey.new),
            time: message.formattedTime,
            message: message.content,
            speakerLabel: _speakerLabel(message),
            isLearner: message.isLearner,
            isFocused: _focusedMessageId == '${message.id}',
          );
        },
      );
    }

    return FeedbackSummaryCard(
      expand: true,
      title: ref.t('postSim.tabs.transcript'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(
              ref.t('transcription.accuracyDisclaimer'),
              style: const TextStyle(
                fontFamily: AppFonts.ibmPlexSerifRegular,
                fontSize: 11,
                color: AppColors.mediumEmphasis,
              ),
            ),
          ),
          Expanded(child: body),
        ],
      ),
    );
  }
}

/// RN `SimulationTranscriptItem`.
class TranscriptItem extends StatelessWidget {
  const TranscriptItem({
    super.key,
    required this.time,
    required this.message,
    required this.speakerLabel,
    required this.isLearner,
    this.isFocused = false,
  });

  final String time;
  final String message;
  final String speakerLabel;
  final bool isLearner;

  /// Briefly outlined after a debrief chip jumped here.
  final bool isFocused;

  @override
  Widget build(BuildContext context) {
    final background = isLearner ? AppColors.blueAlpha25 : AppColors.deepPurpleAlpha25;
    final border = isFocused
        ? AppColors.primary
        : (isLearner ? AppColors.primary : AppColors.deepPurple500);
    final speakerColor = isLearner ? AppColors.primary : AppColors.deepPurple800;

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: border, width: isFocused ? 2 : 0.5),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            height: 24,
            child: Row(
              children: [
                Text(
                  '$time ',
                  style: const TextStyle(
                    fontFamily: AppFonts.ibmPlexSerifRegular,
                    fontSize: 13,
                    letterSpacing: 0.1,
                    color: AppColors.mediumEmphasis,
                  ),
                ),
                const SizedBox(width: 4),
                Flexible(
                  child: Text(
                    speakerLabel,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontFamily: AppFonts.ibmPlexSerifMedium,
                      fontSize: 13,
                      height: 24 / 13,
                      letterSpacing: 0.25,
                      color: speakerColor,
                    ),
                  ),
                ),
              ],
            ),
          ),
          Text(
            message,
            style: const TextStyle(
              fontFamily: AppFonts.ibmPlexSerifRegular,
              fontSize: 13,
              height: 20 / 13,
              letterSpacing: 0.25,
              color: AppColors.highEmphasis,
            ),
          ),
        ],
      ),
    );
  }
}

/// RN `components/EmptyTranscript`.
class _EmptyTranscript extends ConsumerWidget {
  const _EmptyTranscript();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return LayoutBuilder(
      builder: (context, constraints) => SingleChildScrollView(
        child: Padding(
          padding: EdgeInsets.only(top: constraints.maxWidth * 0.4),
          child: Column(
            children: [
              SvgPicture.asset('assets/icons/emptyTranscript.svg'),
              const SizedBox(height: 30),
              Padding(
                padding: EdgeInsets.symmetric(horizontal: constraints.maxWidth * 0.3),
                child: Text(
                  ref.t('transcription.empty'),
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontFamily: AppFonts.ibmPlexSerifMedium,
                    fontSize: 16,
                    height: 24 / 16,
                    color: AppColors.darkGray2,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
