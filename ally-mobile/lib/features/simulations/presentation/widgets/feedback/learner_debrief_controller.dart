import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../../data/learner_debrief_repository.dart';

/// Port of the web helpline's `useLearnerDebrief` hook (plus its RTK Query
/// endpoints): the Debrief agent's debrief for one session, or `null` when
/// today's debrief should be shown instead.
///
/// [view] stays `null` in every case where the new debrief must stay
/// invisible: the learner's organisation isn't switched on
/// (`not_available`), the request never succeeded (network, 403, 500), or
/// the first answer hasn't arrived yet. Falling back is silent on purpose —
/// an org that isn't on the new debrief must see exactly today's screen.
///
/// Polls every [pollInterval] (3 s) while the state is `working`, for up to
/// [fastPollFor] (4 minutes), then every [slowPollInterval] (30 s); every
/// [slowPollInterval] while a person finishes one (`on_its_way`); and not at
/// all otherwise (v9 FR-33, web `useLearnerDebrief`). Once an answer has landed, a later failed request keeps it
/// (like RTK Query keeps the last good `data`), so a blip mid-poll doesn't
/// swap the learner back to the old view.
class LearnerDebriefController extends ChangeNotifier {
  LearnerDebriefController({
    required LearnerDebriefRepository repository,
    required this.sessionId,
    this.pollInterval = const Duration(seconds: 3),
    this.slowPollInterval = const Duration(seconds: 30),
    this.fastPollFor = const Duration(minutes: 4),
    this.supervisor = false,
  }) : _repository = repository;

  /// Roleplay Logs: read the supervisor's view
  /// (`GET /debriefs/sessions/:id/supervisor`, v9 FR-26) instead of the
  /// learner's, and send nothing back (no read, opened or XP).
  final bool supervisor;

  final LearnerDebriefRepository _repository;
  final String sessionId;
  final Duration pollInterval;
  final Duration slowPollInterval;
  final Duration fastPollFor;

  LearnerDebriefView? _latest;
  Timer? _pollTimer;

  /// Runs out [fastPollFor] after `working` is seen; like the web, it
  /// restarts if `working` comes back, but once slow, polling stays slow.
  Timer? _fastTimer;
  bool _slow = false;
  bool _disposed = false;
  bool _helpfulSending = false;

  /// What to render, or `null` to keep today's debrief.
  LearnerDebriefView? get view => (_latest?.isShowable ?? false) ? _latest : null;

  bool get helpfulSending => _helpfulSending;

  /// First load. A blank [sessionId] never asks.
  Future<void> load() async {
    if (sessionId.isEmpty) return;
    await _fetch();
  }

  Future<void> _fetch() async {
    _pollTimer?.cancel();
    try {
      final next = supervisor
          ? await _repository.getSupervisorDebrief(sessionId)
          : await _repository.getDebrief(sessionId);
      if (_disposed) return;
      _latest = next;
      notifyListeners();
    } catch (_) {
      // Keep whatever we had (null → today's debrief stays).
      if (_disposed) return;
    }
    if (_disposed) return;
    if (_latest?.state != LearnerDebriefState.working) {
      _fastTimer?.cancel();
      _fastTimer = null;
    }
    switch (_latest?.state) {
      case LearnerDebriefState.working:
        _fastTimer ??= Timer(fastPollFor, () => _slow = true);
        _pollTimer = Timer(_slow ? slowPollInterval : pollInterval, _fetch);
      case LearnerDebriefState.onItsWay:
        _pollTimer = Timer(slowPollInterval, _fetch);
      default:
        break;
    }
  }

  /// "Was this helpful?" — answering again changes it. Shows the pressed
  /// state as soon as the server accepts, then re-reads the debrief.
  Future<void> setHelpful(bool helpful) async {
    final current = _latest;
    if (current == null || _helpfulSending) return;
    _helpfulSending = true;
    notifyListeners();
    try {
      await _repository.setHelpful(sessionId, helpful: helpful);
      if (_disposed) return;
      _latest = (_latest ?? current).copyWith(helpful: helpful);
    } catch (_) {
      // Leave the previous answer showing.
    } finally {
      if (!_disposed) {
        _helpfulSending = false;
        notifyListeners();
      }
    }
    if (!_disposed) unawaited(_refresh());
  }

  /// "This isn't right" on one card. Throws when the request fails so the
  /// form can say so; on success the card shows the sent state at once.
  Future<void> flagCard({required String section, required DebriefFlagReason reason, String? note}) async {
    final result = await _repository.flagCard(sessionId, section: section, reason: reason, note: note);
    if (_disposed) return;
    final current = _latest;
    if (current != null) {
      _latest = current.copyWith(
        flags: [
          ...current.flags.where((f) => f.section != section),
          DebriefMyFlag(id: result.id, section: section, status: 'open', canUndoUntil: result.undoUntil),
        ],
      );
      notifyListeners();
    }
    unawaited(_refresh());
  }

  /// Read-aloud: one card's audio link (see [LearnerDebriefRepository.getCardAudioUrl]).
  Future<String> cardAudioUrl(String section) => _repository.getCardAudioUrl(sessionId, section);

  bool _readSent = false;

  /// DEBRIEF_READ XP, at most once per controller; a failure is silent (the
  /// web fires and forgets too).
  Future<void> markRead() async {
    if (_readSent || supervisor) return;
    _readSent = true;
    try {
      await _repository.markRead(sessionId);
    } catch (_) {
      // Nothing to show: XP is a bonus, not part of the debrief.
    }
  }

  bool _openedSent = false;

  /// v9 FR-31 `openedAt`, at most once per controller (one screen visit); a
  /// failure is silent, as [markRead].
  Future<void> markOpened() async {
    if (_openedSent || supervisor) return;
    _openedSent = true;
    try {
      await _repository.markOpened(sessionId);
    } catch (_) {
      // Nothing to show: the learner sees the same debrief either way.
    }
  }

  final _eventsSent = <DebriefLearnerEvent>{};

  /// A learner event for the experience metrics, at most once per kind per
  /// controller (one screen visit). Fire and forget: never awaited by the
  /// UI, and every failure (an older server's 404/400 included) is swallowed.
  void recordEvent(DebriefLearnerEvent kind) {
    if (supervisor || sessionId.isEmpty || !_eventsSent.add(kind)) return;
    unawaited(_sendEvent(kind));
  }

  Future<void> _sendEvent(DebriefLearnerEvent kind) async {
    try {
      await _repository.recordEvent(sessionId, kind);
    } catch (_) {
      // Nothing to show: the metrics are ours, the debrief is the learner's.
    }
  }

  /// Takes a flag back. A failure leaves the flag as it was.
  Future<void> undoFlag(String flagId) async {
    try {
      await _repository.undoFlag(sessionId, flagId);
    } catch (_) {
      return;
    }
    if (_disposed) return;
    final current = _latest;
    if (current != null) {
      _latest = current.copyWith(flags: current.flags.where((f) => f.id != flagId).toList());
      notifyListeners();
    }
    unawaited(_refresh());
  }

  /// Re-read after a change (the web invalidates its query tag). Only
  /// replaces the shown answer when it is still showable.
  Future<void> _refresh() async {
    try {
      final next = await _repository.getDebrief(sessionId);
      if (_disposed || !next.isShowable) return;
      _latest = next;
      notifyListeners();
    } catch (_) {
      // Keep the local update.
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _pollTimer?.cancel();
    _fastTimer?.cancel();
    super.dispose();
  }
}
