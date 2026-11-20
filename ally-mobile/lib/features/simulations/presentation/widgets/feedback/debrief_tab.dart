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

/// The landing surface after a session: the Debrief agent's debrief
/// ([DebriefCards], web helpline `DebriefTab` → `useLearnerDebrief`), which
/// serves every organisation.
///
/// When it is not available (`not_available`, polling gave up, a refused
/// request) a session that already holds Ally's OLD note (RN `DebriefTab`,
/// `supervisorNote`) shows it read-only: no rating, no reply thread, no
/// waiting. With no old note one calm line says there is no debrief.
///
/// Once the debrief is `ready` (and not read-only), the Ask-AI chat thread
/// ([AskAiChatController]) moves under its reflective question as Ask Ally: replies go to the Debrief
/// agent (`POST /debriefs/sessions/:id/reply/stream`, web `DebriefTab`'s
/// `askAlly`) on the same history.
///
/// Read-only (Roleplay Logs) asks for the supervisor's view instead
/// (`GET /debriefs/sessions/:id/supervisor`, v9 FR-26): the same cards with
/// no controls, the learner's flags and outcomes under each card, their
/// "Was this helpful?" answer and their Ask Ally thread. A 403 or
/// `not_available` keeps the note. The reader's own session (the learner
/// view answers `ready`) shows as their debrief instead, with its
/// "Practise this next" button (web `ownReady`).
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
    this.trackId,
  }) : supervisorView = supervisorView ?? readOnly;

  /// The course this session was played in: "Practise this" keeps it.
  final String? trackId;

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
    final askAllyOpen = view?.askAllyOpen ?? true;
    final settled = _learnerDebrief.settled || _learnerDebrief.gaveUp;
    if (!mounted ||
        (showing == _showingLearnerDebrief && askAllyOpen == _askAllyOpen && settled == _settledSeen)) {
      return;
    }
    setState(() {
      _settledSeen = settled;
      _showingLearnerDebrief = showing;
      _askAllyOpen = askAllyOpen;
    });
  }

  /// The learner view's `askAlly.open`, so a change rebuilds the composer.
  bool _askAllyOpen = true;
  bool _settledSeen = false;

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
    }
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
        // Closed by the server with no limit message in this thread: say so.
        if (chat.limitReached == null && !(_learnerDebrief.view?.askAllyOpen ?? true)) ...[
          Text(
            ref.t('postSim.debriefCards.reply.closed'),
            key: const Key('ask-ally-closed'),
            style: const TextStyle(
              fontFamily: AppFonts.ibmPlexSerifRegular,
              fontSize: 13,
              color: AppColors.mediumEmphasis,
            ),
          ),
          const SizedBox(height: 12),
        ],
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

  /// No more questions: the reply stream said the limit was reached (its
  /// message stays in the thread), or the learner view says Ask Ally is
  /// closed (`askAlly.open == false`; missing reads as open).
  bool get _askAllyClosed => widget.chat.limitReached != null || !(_learnerDebrief.view?.askAllyOpen ?? true);

  /// Ask Ally's composer, docked by [DebriefCards] while the reflective
  /// question is in view (design A5). Null once Ask Ally is closed.
  Widget? _composer(AskAiChatController chat) => _askAllyClosed ? null : AskAiReplyInput(
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
        trackId: widget.trackId,
        thisRoleplay: widget.summary?.scenario?.id,
      );
    }
    // The new debrief is not available (not_available, polling gave up, a
    // refused or failed request): an old note stays readable, read-only; no
    // old note says so once. Nothing here waits for, rates or replies to a
    // note: the backend no longer writes them.
    if (!_learnerDebrief.settled && !_learnerDebrief.gaveUp) {
      return const AskAiGradientCard(
        title: '',
        child: Center(child: CircularProgressIndicator(key: Key('debrief-loading'))),
      );
    }
    final note = widget.summary?.supervisorNote;
    final hasNote = note != null && note.isNotEmpty;
    if (!hasNote && widget.summary == null && !widget.retryLimitReached) {
      return const AskAiGradientCard(
        title: '',
        child: Center(child: CircularProgressIndicator(key: Key('debrief-loading'))),
      );
    }

    return AskAiGradientCard(
      title: ref.t('postSim.debrief.header'),
      child: Column(
        children: [
          Expanded(
            child: ListView(
              key: const Key('debrief-list'),
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
              children: [
                if (hasNote)
                  SupervisorNote(note: note, onOpenMoment: widget.onOpenMoment, hideClosing: true)
                else
                  Text(
                    ref.t('postSim.debrief.unavailable'),
                    key: const Key('debrief-unavailable'),
                    style: const TextStyle(
                      fontFamily: AppFonts.ibmPlexSerifRegular,
                      fontSize: 13,
                      color: AppColors.highEmphasis,
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
