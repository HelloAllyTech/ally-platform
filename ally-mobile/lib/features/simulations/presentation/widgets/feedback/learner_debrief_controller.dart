import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import '../../../data/learner_debrief_repository.dart';

/// Port of the web helpline's `useLearnerDebrief` hook (plus its RTK Query
/// endpoints): the Debrief agent's debrief for one session, or `null` when
/// today's debrief should be shown instead.
///
/// [view] stays `null` where the new debrief must stay invisible: the
/// learner's organisation isn't switched on (`not_available`), the server
/// refused (401/403/404), or the first answer hasn't arrived yet. A first
/// request that failed outright is a state of its own (PRD §6.12): no
/// connection → `offline`, a 5xx → `failed`, both with Try again ([retry]),
/// never the old note silently in its place. A supervisor's view keeps the
/// note on any failure.
///
/// Polls every [pollInterval] (3 s) while the state is `working`, for up to
/// [fastPollFor] (4 minutes), then every [slowPollInterval] (30 s); every
/// [slowPollInterval] while a person finishes one (`on_its_way`,
/// `taking_longer`); and not at
/// all otherwise (v9 FR-33, web `useLearnerDebrief`). After [waitingGiveUpAfter]
/// (30 minutes) still waiting, it stops and [view] goes back to `null`, so
/// today's debrief shows (the server answers `not_available` by then too).
///
/// A ready debrief with a flag still waiting on Ally's answer is re-read
/// every [flagPollInterval] (5 s), for up to [flagPollFor] (2 minutes) after
/// the flag (or after the screen opened on one), so Ally's reply shows
/// without leaving the screen.
///
/// Once an answer has landed, a later failed request keeps it
/// (like RTK Query keeps the last good `data`), so a blip mid-poll doesn't
/// swap the learner back to the old view.
class LearnerDebriefController extends ChangeNotifier {
  LearnerDebriefController({
    required LearnerDebriefRepository repository,
    required this.sessionId,
    this.pollInterval = const Duration(seconds: 3),
    this.slowPollInterval = const Duration(seconds: 30),
    this.fastPollFor = const Duration(minutes: 4),
    this.waitingGiveUpAfter = const Duration(minutes: 30),
    this.flagPollInterval = const Duration(seconds: 5),
    this.flagPollFor = const Duration(minutes: 2),
    this.supervisor = false,
  }) : _repository = repository;

  /// Roleplay Logs: read the supervisor's view
  /// (`GET /debriefs/sessions/:id/supervisor`, v9 FR-26) instead of the
  /// learner's, and send nothing back (no read, opened or XP).
  final bool supervisor;

  /// Roleplay Logs on the reader's own session: the learner view answered
  /// `ready` (it answers only the session's own learner), so it shows as
  /// their debrief, "Practise this next" included (web `DebriefTab`'s
  /// `ownReady`). Still read-only: nothing is sent back.
  bool _ownView = false;
  bool get ownView => _ownView;

  /// Which view [_fetch] reads: the supervisor's, unless [ownView].
  bool get _readsSupervisor => supervisor && !_ownView;

  final LearnerDebriefRepository _repository;
  final String sessionId;
  final Duration pollInterval;
  final Duration slowPollInterval;
  final Duration fastPollFor;
  final Duration waitingGiveUpAfter;
  final Duration flagPollInterval;
  final Duration flagPollFor;

  LearnerDebriefView? _latest;

  /// Started when a waiting state is first seen; when it fires, polling
  /// stops for good and today's debrief shows.
  Timer? _giveUpTimer;
  bool _gaveUp = false;

  /// Polls left for an open flag's answer (0: not polling for one).
  int _flagPollsLeft = 0;
  bool _flagWindowStarted = false;

  int get _flagPollBudget =>
      flagPollInterval.inMilliseconds <= 0 ? 0 : flagPollFor.inMilliseconds ~/ flagPollInterval.inMilliseconds;

  /// True once polling gave up on a debrief that never finished.
  bool get gaveUp => _gaveUp;

  /// True once the first request has answered or failed, so "not available"
  /// is never shown while it is still in flight.
  bool get settled => _settled;
  bool _settled = false;
  Timer? _pollTimer;

  /// Runs out [fastPollFor] after `working` is seen; like the web, it
  /// restarts if `working` comes back, but once slow, polling stays slow.
  Timer? _fastTimer;
  bool _slow = false;
  bool _disposed = false;
  bool _helpfulSending = false;
  bool _pulseSending = false;

  /// Set when the first request failed outright and nothing has landed yet.
  LearnerDebriefState? _loadFailure;
  bool _retrying = false;

  /// What to render, or `null` to keep today's debrief.
  LearnerDebriefView? get view {
    if (_gaveUp) return null;
    if (_latest?.isShowable ?? false) return _latest;
    if (_latest == null && _loadFailure != null) return LearnerDebriefView(state: _loadFailure!);
    return null;
  }

  bool get helpfulSending => _helpfulSending;
  bool get pulseSending => _pulseSending;

  /// True while a [retry] is in flight.
  bool get retrying => _retrying;

  /// Which failure a request error is: no connection, a server error, or
  /// neither (a refusal — keep today's debrief).
  static LearnerDebriefState? failureOf(Object error) {
    if (error is! DioException) return null;
    switch (error.type) {
      case DioExceptionType.connectionError:
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
        return LearnerDebriefState.offline;
      case DioExceptionType.badResponse:
        final status = error.response?.statusCode ?? 0;
        return status >= 500 ? LearnerDebriefState.failed : null;
      case DioExceptionType.unknown:
        // A socket error with no response is a lost connection.
        return error.response == null ? LearnerDebriefState.offline : null;
      default:
        return null;
    }
  }

  /// "Try again" on a debrief that didn't load (and on reconnecting).
  Future<void> retry() async {
    if (sessionId.isEmpty || _retrying || _disposed) return;
    _retrying = true;
    notifyListeners();
    await _fetch();
    if (_disposed) return;
    _retrying = false;
    notifyListeners();
  }

  /// First load. A blank [sessionId] never asks.
  Future<void> load() async {
    if (sessionId.isEmpty) return;
    await _fetch();
  }

  static bool _isWaiting(LearnerDebriefState? state) =>
      state == LearnerDebriefState.working ||
      state == LearnerDebriefState.onItsWay ||
      state == LearnerDebriefState.takingLonger;

  void _giveUp() {
    if (_disposed || !_isWaiting(_latest?.state)) return;
    _gaveUp = true;
    _pollTimer?.cancel();
    _fastTimer?.cancel();
    notifyListeners();
  }

  /// Re-reads while a flag waits on Ally's answer, within its budget.
  void _scheduleFlagPoll() {
    if (_pollTimer?.isActive ?? false) return;
    if (_flagPollsLeft <= 0 || _latest?.state != LearnerDebriefState.ready || !(_latest?.hasOpenFlag ?? false)) {
      return;
    }
    _flagPollsLeft--;
    _pollTimer = Timer(flagPollInterval, _fetch);
  }

  Future<void> _fetch() async {
    if (_gaveUp) return;
    _pollTimer?.cancel();
    try {
      final next = _readsSupervisor
          ? await _ownOrSupervisor()
          : await _repository.getDebrief(sessionId);
      if (_disposed) return;
      _settled = true;
      _latest = next;
      _loadFailure = null;
      notifyListeners();
    } catch (error) {
      // Keep whatever we had: a blip mid-poll keeps the last good answer.
      if (_disposed) return;
      final wasSettled = _settled;
      _settled = true;
      if (!wasSettled) notifyListeners();
      if (_latest == null && !supervisor) {
        final failure = failureOf(error);
        if (failure != null || _loadFailure != null) {
          // A retry that fails differently (back online, server still down) says so.
          _loadFailure = failure ?? _loadFailure;
          notifyListeners();
        }
      }
    }
    if (_disposed || _gaveUp) return;
    if (_latest?.state != LearnerDebriefState.working) {
      _fastTimer?.cancel();
      _fastTimer = null;
    }
    if (_isWaiting(_latest?.state)) {
      _giveUpTimer ??= Timer(waitingGiveUpAfter, _giveUp);
    } else {
      _giveUpTimer?.cancel();
      _giveUpTimer = null;
    }
    // A screen opened on a debrief whose flag is still waiting gets one
    // window too.
    if (!_flagWindowStarted && !_readsSupervisor && (_latest?.hasOpenFlag ?? false)) {
      _flagWindowStarted = true;
      _flagPollsLeft = _flagPollBudget;
    }
    switch (_latest?.state) {
      case LearnerDebriefState.working:
        _fastTimer ??= Timer(fastPollFor, () => _slow = true);
        _pollTimer = Timer(_slow ? slowPollInterval : pollInterval, _fetch);
      case LearnerDebriefState.onItsWay:
      case LearnerDebriefState.takingLonger:
        _pollTimer = Timer(slowPollInterval, _fetch);
      case LearnerDebriefState.ready:
        _scheduleFlagPoll();
      default:
        break;
    }
  }

  /// Roleplay Logs: the reader's own debrief when the learner view has a
  /// ready one, else the supervisor's view. Asked once: after an own view
  /// is found, [_fetch] keeps reading the learner view.
  Future<LearnerDebriefView> _ownOrSupervisor() async {
    if (_latest == null) {
      try {
        final own = await _repository.getDebrief(sessionId);
        if (own.state == LearnerDebriefState.ready && own.cards != null) {
          _ownView = true;
          return own;
        }
      } catch (_) {
        // Not theirs (403/404) or a blip: the supervisor's view.
      }
    }
    return _repository.getSupervisorDebrief(sessionId);
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

  /// The pulse (PRD §9): shows the answer as soon as the server accepts it.
  Future<void> answerPulse(DebriefPulseQuestion question, bool answer) async {
    final current = _latest;
    if (current?.pulse == null || _pulseSending) return;
    _pulseSending = true;
    notifyListeners();
    try {
      await _repository.answerPulse(sessionId, question, answer: answer);
      if (_disposed) return;
      final latest = _latest ?? current!;
      _latest = latest.copyWith(pulse: (latest.pulse ?? const DebriefPulse()).withAnswer(question, answer));
    } catch (_) {
      // Leave the previous answer showing.
    } finally {
      if (!_disposed) {
        _pulseSending = false;
        notifyListeners();
      }
    }
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
    // Ally answers within a minute: re-read until it has (a fresh window per flag).
    _flagWindowStarted = true;
    _flagPollsLeft = _flagPollBudget;
    _pollTimer?.cancel();
    _pollTimer = null;
    unawaited(_refresh().then((_) {
      if (!_disposed) _scheduleFlagPoll();
    }));
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
    _giveUpTimer?.cancel();
    super.dispose();
  }
}
