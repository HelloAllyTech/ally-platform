import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../../core/localization/translate_ref.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_fonts.dart';
import '../../../../../core/widgets/ask_ai_chat/ask_ai_chat.dart';
import '../../../data/learner_debrief_repository.dart';
import '../../../data/simulation_models.dart';
import 'debrief_cards.dart';
import 'learner_debrief_controller.dart';
import 'supervisor_note.dart';

/// Port of RN `Debrief/DebriefTab.tsx`: the landing surface after a
/// session. Ally's note opens one continuous thread the learner can reply
/// to — the reply thread is the scenario-session Ask-AI chat
/// ([AskAiChatController], RN `useAskAIChat`), absorbed here.
///
/// While the note is still being generated (and polling hasn't given up) a
/// skeleton + "Ally is writing your debrief…" shows; a failed or missing
/// note says so plainly. Read-only (opened from Logs) shows the note alone.
///
/// The Debrief agent's debrief ([DebriefCards], the web helpline's
/// `DebriefTab` → `useLearnerDebrief`) replaces all of that once the
/// learner's organisation is switched on. Until its first answer lands — and
/// for `not_available` or any failed request — today's debrief shows exactly
/// as before. Read-only (Logs) never asks, matching RN.
class DebriefTab extends ConsumerStatefulWidget {
  const DebriefTab({
    super.key,
    required this.chat,
    required this.sessionId,
    required this.summary,
    required this.retryLimitReached,
    this.onOpenMoment,
    this.readOnly = false,
  });

  final AskAiChatController chat;

  /// The scenario session, for the Debrief agent's debrief.
  final String sessionId;
  final SimulationSummary? summary;
  final bool retryLimitReached;
  final ValueChanged<String>? onOpenMoment;
  final bool readOnly;

  @override
  ConsumerState<DebriefTab> createState() => _DebriefTabState();
}

class _DebriefTabState extends ConsumerState<DebriefTab> {
  final _scrollController = ScrollController();
  late final LearnerDebriefController _learnerDebrief = LearnerDebriefController(
    repository: ref.read(learnerDebriefRepositoryProvider),
    // Asked on the Logs view too, as RN: the endpoint answers only the
    // learner themself, and anyone else's 403 falls back to the note.
    sessionId: widget.sessionId,
  );

  @override
  void initState() {
    super.initState();
    _learnerDebrief.addListener(_onLearnerDebrief);
    _learnerDebrief.load();
    widget.chat.addListener(_onChat);
    if (!widget.readOnly) widget.chat.loadHistory();
  }

  @override
  void didUpdateWidget(DebriefTab oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.chat != widget.chat) {
      oldWidget.chat.removeListener(_onChat);
      widget.chat.addListener(_onChat);
    }
  }

  @override
  void dispose() {
    widget.chat.removeListener(_onChat);
    _learnerDebrief
      ..removeListener(_onLearnerDebrief)
      ..dispose();
    _scrollController.dispose();
    super.dispose();
  }

  /// Only the switch between today's debrief and the new one matters here;
  /// [DebriefCards] listens for everything else itself.
  bool _showingLearnerDebrief = false;

  void _onLearnerDebrief() {
    final showing = _learnerDebrief.view != null;
    if (!mounted || showing == _showingLearnerDebrief) return;
    setState(() => _showingLearnerDebrief = showing);
  }

  /// RN scrolls to the bottom on every content-size change (each streamed
  /// token included).
  void _onChat() {
    if (!mounted) return;
    setState(() {});
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_scrollController.hasClients) return;
      final max = _scrollController.position.maxScrollExtent;
      if (max > 0) {
        _scrollController.animateTo(max, duration: const Duration(milliseconds: 200), curve: Curves.easeOut);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_showingLearnerDebrief) return DebriefCards(controller: _learnerDebrief);
    final chat = widget.chat;
    final note = widget.summary?.supervisorNote;
    final hasNote = note != null && note.isNotEmpty;
    final errorMessage = widget.summary?.errorMessage;
    final isGenerating = !hasNote && (errorMessage == null || errorMessage.isEmpty) && !widget.retryLimitReached;
    final messages = widget.readOnly ? const <AskAiChatMessage>[] : chat.allMessages;
    final clientName = widget.summary?.scenario?.clientName;

    final header = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (isGenerating)
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const _NoteSkeleton(),
              const SizedBox(height: 10),
              Text.rich(
                TextSpan(
                  text: '${ref.t('postSim.debrief.generating')} ',
                  style: const TextStyle(
                    fontFamily: AppFonts.ibmPlexSerifRegular,
                    fontSize: 12,
                    color: AppColors.mediumEmphasis,
                  ),
                  children: [
                    TextSpan(
                      text: ref.t('postSim.debrief.generatingHint'),
                      style: const TextStyle(color: AppColors.lowEmphasis),
                    ),
                  ],
                ),
              ),
            ],
          )
        else if (hasNote)
          SupervisorNote(note: note, onOpenMoment: widget.onOpenMoment, hideClosing: widget.readOnly)
        else
          Text(
            (errorMessage != null && errorMessage.isNotEmpty) ? errorMessage : ref.t('postSim.debrief.failed'),
            style: const TextStyle(
              fontFamily: AppFonts.ibmPlexSerifRegular,
              fontSize: 13,
              color: AppColors.highEmphasis,
            ),
          ),
        if (!widget.readOnly && hasNote && chat.messages.isEmpty && chat.streamingMessage == null && !chat.isLoading)
          Padding(
            padding: const EdgeInsets.only(top: 16),
            child: Text(
              ref.t('postSim.debrief.replyPrompt'),
              style: const TextStyle(
                fontFamily: AppFonts.ibmPlexSerifRegular,
                fontSize: 12,
                color: AppColors.mediumEmphasis,
              ),
            ),
          ),
      ],
    );

    final items = <Widget>[
      header,
      for (final message in messages)
        message.role == AskAiChatRole.user
            ? AskAiLearnerBubble(key: ValueKey(message.id), message: message)
            : AskAiAllyReply(
                key: ValueKey(message.id),
                message: message,
                clientName: clientName,
                onOpenMoment: widget.onOpenMoment,
              ),
      if (!widget.readOnly && chat.error != null)
        AskAiErrorBanner(message: chat.error!, onRetry: chat.retry),
    ];

    return AskAiGradientCard(
      title: ref.t('postSim.debrief.header'),
      child: Column(
        children: [
          Expanded(
            child: ListView.separated(
              key: const Key('debrief-list'),
              controller: _scrollController,
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
              keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.manual,
              itemCount: items.length,
              separatorBuilder: (_, _) => const SizedBox(height: 20),
              itemBuilder: (_, index) => items[index],
            ),
          ),
          if (!widget.readOnly && hasNote)
            AskAiReplyInput(
              placeholder: ref.t('postSim.debrief.replyPlaceholder'),
              disabled: chat.isStreaming,
              onSend: chat.sendMessage,
            ),
        ],
      ),
    );
  }
}

/// RN `NoteSkeleton`: a grey avatar circle and four grey bars.
class _NoteSkeleton extends StatelessWidget {
  const _NoteSkeleton();

  @override
  Widget build(BuildContext context) {
    Widget line(double? widthFactor) => FractionallySizedBox(
      alignment: Alignment.centerLeft,
      widthFactor: widthFactor ?? 1,
      child: Container(
        height: 10,
        decoration: BoxDecoration(
          color: AppColors.lightGray2,
          borderRadius: BorderRadius.circular(6),
        ),
      ),
    );
    return Row(
      key: const Key('debrief-note-skeleton'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 32,
          height: 32,
          decoration: const BoxDecoration(color: AppColors.lightGray2, shape: BoxShape.circle),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Column(
              children: [
                line(0.4),
                const SizedBox(height: 8),
                line(null),
                const SizedBox(height: 8),
                line(0.9),
                const SizedBox(height: 8),
                line(0.7),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
