import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../../core/localization/translate_ref.dart';
import '../../../../../core/realtime/connectivity.dart';
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
/// as before. Once it is `ready` (and not read-only), the same reply thread
/// moves under its reflective question as Ask Ally: replies go to the Debrief
/// agent (`POST /debriefs/sessions/:id/reply/stream`, web `DebriefTab`'s
/// `askAlly`) on the same history.
///
/// Read-only (Roleplay Logs) asks for the supervisor's view instead
/// (`GET /debriefs/sessions/:id/supervisor`, v9 FR-26): the same cards with
/// no controls, the learner's flags and outcomes under each card, their
/// "Was this helpful?" answer and their Ask Ally thread. A 403 or
/// `not_available` keeps the note.
class DebriefTab extends ConsumerStatefulWidget {
  const DebriefTab({
    super.key,
    required this.chat,
    required this.sessionId,
    required this.summary,
    required this.retryLimitReached,
    this.onOpenMoment,
    this.onSeeQuote,
    this.readOnly = false,
    bool? supervisorView,
  }) : supervisorView = supervisorView ?? readOnly;

  final AskAiChatController chat;

  /// The scenario session, for the Debrief agent's debrief.
  final String sessionId;
  final SimulationSummary? summary;
  final bool retryLimitReached;
  final ValueChanged<String>? onOpenMoment;

  /// "See this moment" under a debrief card's quote: the transcript at the
  /// turn holding those words.
  final ValueChanged<String>? onSeeQuote;
  final bool readOnly;

  /// Whose view of the debrief: the supervisor's (Roleplay Logs, someone
  /// else's session) or the learner's own. Defaults to [readOnly].
  final bool supervisorView;

  @override
  ConsumerState<DebriefTab> createState() => _DebriefTabState();
}

class _DebriefTabState extends ConsumerState<DebriefTab> {
  final _scrollController = ScrollController();
  late final LearnerDebriefController _learnerDebrief = LearnerDebriefController(
    repository: ref.read(learnerDebriefRepositoryProvider),
    sessionId: widget.sessionId,
    // Roleplay Logs: the supervisor's view of the learner's debrief (v9
    // FR-26); a 403 (another organisation) or not_available keeps the note.
    supervisor: widget.supervisorView,
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
    final view = _learnerDebrief.view;
    final askAlly = !widget.readOnly && view?.state == LearnerDebriefState.ready;
    widget.chat.streamPath = askAlly ? LearnerDebriefRepository.replyStreamPath(widget.sessionId) : null;
    final showing = view != null;
    if (!mounted || showing == _showingLearnerDebrief) return;
    setState(() => _showingLearnerDebrief = showing);
  }

  /// The end of Ask Ally's thread inside the cards, followed while a reply
  /// streams in.
  final _threadEndKey = GlobalKey();

  /// RN scrolls to the bottom on every content-size change (each streamed
  /// token included). Under the cards only a streaming reply is followed —
  /// jumping on the history's arrival would skip past the debrief itself.
  void _onChat() {
    if (!mounted) return;
    setState(() {});
    if (_showingLearnerDebrief) {
      if (widget.chat.streamingMessage == null) return;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        final end = _threadEndKey.currentContext;
        if (!mounted || end == null) return;
        Scrollable.ensureVisible(end, alignment: 1, duration: const Duration(milliseconds: 200));
      });
      return;
    }
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_scrollController.hasClients) return;
      final max = _scrollController.position.maxScrollExtent;
      if (max > 0) {
        _scrollController.animateTo(max, duration: const Duration(milliseconds: 200), curve: Curves.easeOut);
      }
    });
  }

  /// Ask Ally: the thread and its composer, inside the reflective-question card.
  Widget _askAlly(AskAiChatController chat) {
    return Column(
      key: const Key('ask-ally'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final message in chat.allMessages) ...[
          message.role == AskAiChatRole.user
              ? AskAiLearnerBubble(key: ValueKey(message.id), message: message)
              : AskAiAllyReply(
                  key: ValueKey(message.id),
                  message: message,
                  clientName: widget.summary?.scenario?.clientName,
                  onOpenMoment: widget.onOpenMoment,
                ),
          const SizedBox(height: 12),
        ],
        if (chat.error != null) ...[
          AskAiErrorBanner(message: chat.error!, onRetry: chat.retry, calm: true),
          const SizedBox(height: 12),
        ],
        SizedBox(key: _threadEndKey, height: 0),
        // v9 Q47: supervisors read this thread, and the learner is told.
        // The composer itself docks at the bottom of the screen ([_composer]).
        Padding(
          padding: EdgeInsets.zero,
          child: Text(
            ref.t('postSim.debriefCards.supervisor.canRead'),
            key: const Key('ask-ally-supervisor-can-read'),
            style: const TextStyle(
              fontFamily: AppFonts.ibmPlexSerifRegular,
              fontSize: 12,
              color: AppColors.mediumEmphasis,
            ),
          ),
        ),
      ],
    );
  }

  /// Ask Ally's composer, docked by [DebriefCards] while the reflective
  /// question is in view (design A5).
  Widget _composer(AskAiChatController chat) => AskAiReplyInput(
    placeholder: ref.t('postSim.debriefCards.reply.placeholder'),
    disabled: chat.isStreaming,
    onSend: chat.sendMessage,
  );

  /// Roleplay Logs: the learner's Ask Ally thread, read-only (web
  /// `supervisor-thread`).
  Widget? _supervisorThread(SupervisorDebriefExtras? supervisor) {
    if (supervisor == null) return null;
    const style = TextStyle(fontFamily: AppFonts.ibmPlexSerifRegular, fontSize: 13, color: AppColors.mediumEmphasis);
    return Column(
      key: const Key('supervisor-thread'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          ref.t('postSim.debriefCards.supervisor.thread'),
          style: style.copyWith(fontFamily: AppFonts.ibmPlexSerifMedium, color: AppColors.highEmphasis),
        ),
        const SizedBox(height: 12),
        if (supervisor.thread.isEmpty)
          Text(ref.t('postSim.debriefCards.supervisor.noThread'), style: style)
        else
          for (final (index, turn) in supervisor.thread.indexed) ...[
            if (turn.fromLearner)
              AskAiLearnerBubble(key: ValueKey('supervisor-thread-$index'), message: _threadMessage(index, turn))
            else
              AskAiAllyReply(
                key: ValueKey('supervisor-thread-$index'),
                message: _threadMessage(index, turn),
                clientName: widget.summary?.scenario?.clientName,
                onOpenMoment: widget.onOpenMoment,
              ),
            const SizedBox(height: 12),
          ],
      ],
    );
  }

  static AskAiChatMessage _threadMessage(int index, SupervisorThreadMessage turn) => AskAiChatMessage(
    id: 'supervisor-$index',
    role: turn.fromLearner ? AskAiChatRole.user : AskAiChatRole.assistant,
    content: turn.content,
    createdAt: turn.at,
  );

  @override
  Widget build(BuildContext context) {
    // "You're offline … It will load when you're back online": a debrief
    // that didn't load asks again by itself on reconnecting.
    if (!widget.readOnly) {
      ref.listen<AsyncValue<bool>>(isOfflineProvider, (previous, next) {
        final state = _learnerDebrief.view?.state;
        final failed = state == LearnerDebriefState.offline || state == LearnerDebriefState.failed;
        if (previous?.value == true && next.value == false && failed) _learnerDebrief.retry();
      });
    }
    final chat = widget.chat;
    if (_showingLearnerDebrief) {
      return DebriefCards(
        controller: _learnerDebrief,
        replyThread: widget.readOnly ? _supervisorThread(_learnerDebrief.view?.supervisor) : _askAlly(chat),
        composer: widget.readOnly ? null : _composer(chat),
        readOnly: widget.readOnly,
        onSeeQuote: widget.onSeeQuote,
      );
    }
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
