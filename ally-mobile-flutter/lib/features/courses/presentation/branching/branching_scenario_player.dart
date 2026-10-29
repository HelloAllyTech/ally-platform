import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/localization/translate_ref.dart';
import '../../../../core/theme/app_colors.dart';
import '../course_button.dart';
import '../course_styles.dart';
import '../../data/course_models.dart';
import '../../data/courses_repository.dart';
import '../../data/start_item_payload.dart';
import '../../../../core/widgets/sized_network_image.dart';

/// The server refuses a finished run once the attempts are gone.
bool _isAttemptsExhaustedError(Object error) {
  if (error is! DioException) return false;
  if (error.response?.statusCode != 400) return false;
  final data = error.response?.data;
  final message = data is Map ? data['message'] : null;
  final text = message is List ? message.join(' ') : '$message';
  return RegExp('used all attempts', caseSensitive: false).hasMatch(text);
}

Color _outcomeBg(BranchingOutcome outcome) {
  switch (outcome) {
    case BranchingOutcome.positive:
      return AppColors.successContainer;
    case BranchingOutcome.mixed:
      return AppColors.warningContainer;
    case BranchingOutcome.negative:
      return AppColors.errorContainer;
  }
}

Color _outcomeFg(BranchingOutcome outcome) {
  switch (outcome) {
    case BranchingOutcome.positive:
      return AppColors.onSuccessContainer;
    case BranchingOutcome.mixed:
      return AppColors.amber900; // ds.amber[900]
    case BranchingOutcome.negative:
      return AppColors.onErrorContainer;
  }
}

String _outcomeKey(BranchingOutcome outcome) {
  switch (outcome) {
    case BranchingOutcome.positive:
      return 'courses.branching.outcome.POSITIVE';
    case BranchingOutcome.mixed:
      return 'courses.branching.outcome.MIXED';
    case BranchingOutcome.negative:
      return 'courses.branching.outcome.NEGATIVE';
  }
}

/// The round is spent: what the learner reached, and when more opens.
class _Pause {
  _Pause({required this.nextRoundAt, required this.recap});

  final String? nextRoundAt;
  final List<BranchingRecapEntry> recap;
}

_Pause? _pauseFrom(_BranchingRound round) =>
    round.exhausted ? _Pause(nextRoundAt: round.nextRoundAt, recap: round.recap) : null;

/// The branching subset of a [StartItemPayload], replaced wholesale whenever
/// a new round is fetched — mirrors ally-mobile (React Native)'s own local
/// `data` state in `BranchingScenarioPlayer.tsx`.
class _BranchingRound {
  _BranchingRound({
    required this.intro,
    required this.startNodeId,
    required this.nodes,
    required this.passScore,
    required this.bestScore,
    required this.completed,
    required this.endingsReached,
    required this.exhausted,
    required this.nextRoundAt,
    required this.recap,
  });

  factory _BranchingRound.fromPayload(StartItemPayload p) => _BranchingRound(
    intro: p.branchingIntro,
    startNodeId: p.branchingStartNodeId!,
    nodes: p.branchingNodes!,
    passScore: p.branchingPassScore,
    bestScore: p.branchingBestScore,
    completed: p.branchingCompleted ?? false,
    endingsReached: p.branchingEndingsReached ?? const [],
    exhausted: p.branchingExhausted ?? false,
    nextRoundAt: p.branchingNextRoundAt,
    recap: p.branchingRecap ?? const [],
  );

  final String? intro;
  final String startNodeId;
  final List<BranchingNode> nodes;
  final int? passScore;
  final int? bestScore;
  final bool completed;
  final List<String> endingsReached;
  final bool exhausted;
  final String? nextRoundAt;
  final List<BranchingRecapEntry> recap;
}

/// Coarse time left until a future moment, for "opens in about 23 hours".
/// Rounds to the nearest minute, hour or day (never zero); `null` once the
/// moment has passed. Direct port of ally-mobile (React Native)'s
/// `getTimeUntil` (`src/utils/date.ts`).
({String unit, int count})? _getTimeUntil(int targetMs, int nowMs) {
  final seconds = (targetMs - nowMs) / 1000;
  if (seconds <= 0) return null;
  if (seconds < 3600) {
    final minutes = (seconds / 60).round();
    return (unit: 'minute', count: minutes < 1 ? 1 : minutes);
  }
  if (seconds < 86400) return (unit: 'hour', count: (seconds / 3600).round());
  return (unit: 'day', count: (seconds / 86400).round());
}

const _unitKeys = {
  'minute': 'courses.branching.untilMinutes',
  'hour': 'courses.branching.untilHours',
  'day': 'courses.branching.untilDays',
};

BranchingChoice? _findChoice(List<BranchingChoice>? choices, String id) {
  if (choices == null) return null;
  for (final choice in choices) {
    if (choice.id == id) return choice;
  }
  return null;
}

/// Branching scenario: the learner reads a scene, picks a reply, and lives
/// the next scene. The whole graph arrives in the start payload and is
/// walked locally; only the finished path goes back, and the server's score
/// (never a local one) is what this shows.
///
/// A choice is final within a run — there is no back, so the consequence
/// lands. "Try again" restarts from the first scene.
///
/// Running out of attempts is a pause, not a dead end: the learner sees what
/// they reached, and once `nextRoundAt` passes a fresh round of attempts
/// opens (re-fetched from the server, never assumed locally).
///
/// Direct port of ally-mobile (React Native)'s `BranchingScenarioPlayer.tsx`.
class BranchingScenarioPlayer extends ConsumerStatefulWidget {
  const BranchingScenarioPlayer({
    super.key,
    required this.payload,
    required this.itemId,
    required this.onCompleted,
    required this.onRequestNext,
    required this.onBack,
  });

  final StartItemPayload payload;
  final String itemId;
  final void Function(TrackItemCompletionResult result) onCompleted;
  final VoidCallback onRequestNext;

  /// Leave the item for the course overview (the exhausted screen's exit).
  final VoidCallback onBack;

  @override
  ConsumerState<BranchingScenarioPlayer> createState() => _BranchingScenarioPlayerState();
}

class _BranchingScenarioPlayerState extends ConsumerState<BranchingScenarioPlayer> {
  late _BranchingRound _data = _BranchingRound.fromPayload(widget.payload);
  late String _nodeId = _data.startNodeId;
  List<String> _path = [];
  BranchingResult? _result;
  bool _saveFailed = false;
  bool _isSaving = false;
  bool _isStarting = false;

  /// Exhausted but the start payload could not be re-fetched: say it plainly.
  bool _plainExhausted = false;
  late _Pause? _pause = _pauseFrom(_data);
  bool _roundLoadFailed = false;
  DateTime _now = DateTime.now();
  late int _endingsSeen = _data.endingsReached.length;

  /// Once the item is complete a replay costs nothing, so it is never gated.
  late bool _replayFree = _data.completed;
  Timer? _roundTimer;

  Map<String, BranchingNode> get _nodesById => {for (final n in _data.nodes) n.id: n};
  int get _endingCount => _data.nodes.where((n) => n.isEnding).length;
  BranchingNode? get _node => _nodesById[_nodeId];
  bool get _isEnding => _node?.isEnding ?? false;
  bool get _gated => _data.passScore != null;

  int? get _nextRoundMs {
    final at = _pause?.nextRoundAt;
    if (at == null) return null;
    return DateTime.tryParse(at)?.millisecondsSinceEpoch;
  }

  bool get _roundOpen {
    final ms = _nextRoundMs;
    return ms != null && _now.millisecondsSinceEpoch >= ms;
  }

  @override
  void initState() {
    super.initState();
    _armRoundTimer();
  }

  @override
  void dispose() {
    _roundTimer?.cancel();
    super.dispose();
  }

  // Minute resolution is enough for "about 23 hours"; the timer also lands
  // on the exact moment the new round opens.
  void _armRoundTimer() {
    _roundTimer?.cancel();
    final ms = _nextRoundMs;
    if (ms == null) return;
    final remaining = ms - DateTime.now().millisecondsSinceEpoch;
    if (remaining <= 0) return;
    final delayMs = remaining < 60000 ? remaining : 60000;
    _roundTimer = Timer(Duration(milliseconds: delayMs), () {
      if (!mounted) return;
      setState(() => _now = DateTime.now());
      _armRoundTimer();
    });
  }

  String _chosenText(int index) {
    BranchingNode? current = _nodesById[_data.startNodeId];
    for (var i = 0; i <= index && current != null; i++) {
      final choice = _findChoice(current.choices, _path[i]);
      if (i == index) return choice?.text ?? '';
      current = choice != null ? _nodesById[choice.nextNodeId] : null;
    }
    return '';
  }

  // Adopt a freshly fetched start payload: a spent round pauses, an open one
  // starts over from the first scene.
  void _applyFresh(StartItemPayload fresh) {
    if (fresh.type != 'BRANCHING_SCENARIO') return;
    final round = _BranchingRound.fromPayload(fresh);
    final spent = _pauseFrom(round);
    setState(() {
      _data = round;
      _endingsSeen = round.endingsReached.length;
      _replayFree = round.completed;
      _pause = spent;
      _now = DateTime.now();
      _nodeId = round.startNodeId;
      _path = [];
      _result = null;
      _saveFailed = false;
      _plainExhausted = false;
    });
    _armRoundTimer();
  }

  Future<void> _handleStartNewRound() async {
    setState(() {
      _roundLoadFailed = false;
      _isStarting = true;
    });
    try {
      final fresh = await ref.read(coursesRepositoryProvider).startTrackItem(widget.itemId);
      if (!mounted) return;
      _applyFresh(fresh);
    } catch (_) {
      if (mounted) setState(() => _roundLoadFailed = true);
    } finally {
      if (mounted) setState(() => _isStarting = false);
    }
  }

  Future<void> _submit(List<String> finalPath) async {
    setState(() {
      _saveFailed = false;
      _isSaving = true;
    });
    try {
      final res = await ref
          .read(coursesRepositoryProvider)
          .recordBranchingResult(itemId: widget.itemId, path: finalPath);
      if (!mounted) return;
      final spent = _pauseFrom(_BranchingRound(
        intro: _data.intro,
        startNodeId: _data.startNodeId,
        nodes: _data.nodes,
        passScore: _data.passScore,
        bestScore: _data.bestScore,
        completed: _data.completed,
        endingsReached: res.endingsReached,
        exhausted: res.exhausted,
        nextRoundAt: res.nextRoundAt,
        recap: res.recap,
      ));
      setState(() {
        if (spent != null) _pause = spent;
        _result = res;
        _endingsSeen = res.endingsReached.length;
        if (res.itemCompleted) _replayFree = true;
      });
      if (spent != null) _armRoundTimer();
      if ((res.passed || res.itemCompleted) && res.completion != null) {
        widget.onCompleted(res.completion!);
      }
    } catch (error) {
      if (!mounted) return;
      if (_isAttemptsExhaustedError(error)) {
        // The start payload carries nextRoundAt and the recap.
        try {
          final fresh = await ref.read(coursesRepositoryProvider).startTrackItem(widget.itemId);
          if (!mounted) return;
          _applyFresh(fresh);
        } catch (_) {
          if (mounted) setState(() => _plainExhausted = true);
        }
      } else {
        setState(() => _saveFailed = true);
      }
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  void _handleChoose(String choiceId, String nextNodeId) {
    if (!_nodesById.containsKey(nextNodeId)) return;
    final nextPath = [..._path, choiceId];
    setState(() {
      _path = nextPath;
      _nodeId = nextNodeId;
    });
    final next = _nodesById[nextNodeId];
    if (next != null && next.isEnding) {
      _submit(nextPath);
    }
  }

  void _handleRestart() {
    setState(() {
      _nodeId = _data.startNodeId;
      _path = [];
      _result = null;
      _saveFailed = false;
      _plainExhausted = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    final pause = _pause;
    if (pause != null) return _buildPause(pause);

    final node = _node;
    // A payload whose graph does not resolve (bad start id) has nothing to
    // play.
    if (node == null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24),
          child: Text(
            ref.t('courses.player.unsupportedBody'),
            textAlign: TextAlign.center,
            style: CourseText.serif(CourseType.bodyMedium, AppColors.mediumEmphasis),
          ),
        ),
      );
    }

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if (_path.isEmpty && _data.intro != null) ...[
          Text(_data.intro!, style: CourseText.serif(CourseType.bodyMedium, AppColors.mediumEmphasis)),
          const SizedBox(height: 12),
        ],
        if (_path.isEmpty && _endingsSeen > 0 && _endingCount > 0) ...[
          Text(
            ref.t('courses.branching.endingsSeen', {'seen': _endingsSeen, 'total': _endingCount}) +
                (_gated && _data.bestScore != null
                    ? ' · ${ref.t('courses.branching.bestScore', {'score': _data.bestScore})}'
                    : ''),
            key: const Key('branching-endings-seen'),
            style: CourseText.serif(CourseType.bodySmall, AppColors.mediumEmphasis),
          ),
          const SizedBox(height: 12),
        ],
        if (_isEnding) _buildEnding(node) else _buildChoiceScene(node),
      ],
    );
  }

  Widget _buildChoiceScene(BranchingNode node) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _buildTrail(),
        _buildScene(node),
        const SizedBox(height: 8),
        Text(
          ref.t('courses.branching.choicePrompt'),
          style: CourseText.serif(CourseType.bodyMedium, AppColors.mediumEmphasis, weight: FontWeight.w500),
        ),
        const SizedBox(height: 8),
        for (final choice in node.choices ?? const <BranchingChoice>[])
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            // RN `accessibilityRole="button"`, label = the choice text.
            child: Semantics(
              button: true,
              child: InkWell(
              key: Key('branching-choice-${choice.id}'),
              borderRadius: BorderRadius.circular(12),
              onTap: () => _handleChoose(choice.id, choice.nextNodeId),
              child: Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                decoration: BoxDecoration(
                  border: Border.all(color: AppColors.strokePrimary, width: 1.5),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(choice.text, style: CourseText.serif(CourseType.bodyMedium, AppColors.highEmphasis)),
              ),
            ),
            ),
          ),
      ],
    );
  }

  Widget _buildScene(BranchingNode scene) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (scene.image != null)
          ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: SizedNetworkImage(
              scene.image!.url,
              height: 180,
              width: double.infinity,
              fit: BoxFit.cover,
              semanticLabel: scene.image!.alt,
              errorBuilder: (_, _, _) => Container(height: 180, color: AppColors.grey100),
            ),
          ),
        if (scene.image != null) const SizedBox(height: 12),
        if (scene.title != null) ...[
          Semantics(
            header: true,
            child: Text(
              scene.title!,
              style: CourseText.serif(CourseType.bodyLarge, AppColors.highEmphasis, weight: FontWeight.w500),
            ),
          ),
          const SizedBox(height: 4),
        ],
        Text(scene.text, style: CourseText.serif(CourseType.bodyMedium, AppColors.highEmphasis)),
      ],
    );
  }

  Widget _buildTrail() {
    if (_path.isEmpty) return const SizedBox.shrink();
    // RN: one `accessible` view labelled `trailLabel` ("Your choices so
    // far") — the chips are read as that single label.
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Semantics(
        key: const Key('branching-trail'),
        container: true,
        label: ref.t('courses.branching.trailLabel'),
        excludeSemantics: true,
        child: Wrap(
        spacing: 6,
        runSpacing: 6,
        children: [
          for (var i = 0; i < _path.length; i++)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(
                color: AppColors.blue50,
                borderRadius: BorderRadius.circular(99),
              ),
              child: Text(
                ref.t('courses.branching.youChose', {'text': _chosenText(i)}),
                style: CourseText.serif(CourseType.bodySmall, AppColors.primary),
              ),
            ),
        ],
      ),
      ),
    );
  }

  Widget _buildOutcomeBadge(BranchingOutcome? outcome) {
    if (outcome == null) return const SizedBox.shrink();
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(color: _outcomeBg(outcome), borderRadius: BorderRadius.circular(99)),
      child: Text(
        ref.t(_outcomeKey(outcome)),
        style: CourseText.serif(CourseType.bodySmall, _outcomeFg(outcome), weight: FontWeight.w500),
      ),
    );
  }

  Widget _buildEnding(BranchingNode ending) {
    final outcome = ending.outcome;
    // Server response is the truth; before it lands there is nothing to
    // score.
    final passScore = _result?.passScore ?? _data.passScore;
    final result = _result;
    final canRetry =
        _replayFree || result == null || result.attemptsLeft == null || result.attemptsLeft! > 0;
    final showScore = result != null && passScore != null;
    final done = result != null && (result.passed || result.itemCompleted);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _buildOutcomeBadge(outcome),
        _buildScene(ending),
        if (showScore) ...[
          const SizedBox(height: 12),
          Container(
            key: const Key('branching-score'),
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              border: Border.all(color: AppColors.strokePrimary, width: 1.5),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  ref.t('courses.branching.score', {'score': result.score}),
                  style: CourseText.serif(CourseType.bodyMedium, AppColors.highEmphasis, weight: FontWeight.w500),
                ),
                Text(
                  ref.t('courses.branching.passMark', {'score': passScore}) +
                      (result.attemptsLeft != null && !result.itemCompleted
                          ? ' · ${ref.t(
                              result.attemptsLeft == 1
                                  ? 'courses.branching.attemptsLeft_one'
                                  : 'courses.branching.attemptsLeft_other',
                              {'count': result.attemptsLeft},
                            )}'
                          : ''),
                  style: CourseText.serif(CourseType.bodySmall, AppColors.mediumEmphasis),
                ),
                // A replay that scores under the pass mark must not say the
                // item "stays open" when an earlier run already completed it.
                if (result.passed || !result.itemCompleted)
                  Text(
                    result.passed
                        ? ref.t('courses.branching.passed')
                        : ref.t('courses.branching.notPassed'),
                    style: CourseText.serif(CourseType.bodySmall, AppColors.mediumEmphasis),
                  ),
              ],
            ),
          ),
        ],
        if (ending.takeaway != null) ...[
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.only(left: 12),
            decoration: const BoxDecoration(
              border: Border(left: BorderSide(color: AppColors.primary, width: 3)),
            ),
            child: Text(
              ending.takeaway!,
              style: CourseText.serif(CourseType.bodySmall, AppColors.mediumEmphasis),
            ),
          ),
        ],
        _buildTrail(),
        if (_saveFailed) ...[
          const SizedBox(height: 12),
          Semantics(
            liveRegion: true,
            child: Text(
              ref.t('courses.branching.saveFailed'),
              textAlign: TextAlign.center,
              style: CourseText.serif(CourseType.bodyMedium, AppColors.mediumEmphasis),
            ),
          ),
          const SizedBox(height: 10),
          CourseButton(
            key: const Key('branching-retry-save'),
            label: ref.t('courses.branching.retrySave'),
            isLoading: _isSaving,
            onPressed: () => _submit(_path),
          ),
        ],
        if (_plainExhausted) _exhaustedMessage(),
        if (result != null) ...[
          const SizedBox(height: 8),
          if (done)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: CourseButton(
                key: const Key('branching-continue'),
                label: ref.t('courses.branching.continue'),
                onPressed: widget.onRequestNext,
              ),
            ),
          if (canRetry)
            CourseButton(
              key: const Key('branching-try-again'),
              label: ref.t('courses.branching.tryAgain'),
              variant: done ? CourseButtonVariant.secondary : CourseButtonVariant.primary,
              onPressed: _handleRestart,
            )
          else
            _exhaustedMessage(),
        ],
      ],
    );
  }

  Widget _exhaustedMessage() => Padding(
    padding: const EdgeInsets.symmetric(vertical: 4),
    child: Text(
      ref.t('courses.branching.attemptsUsedUp'),
      key: const Key('branching-exhausted-plain'),
      textAlign: TextAlign.center,
      style: CourseText.serif(CourseType.bodyMedium, AppColors.mediumEmphasis),
    ),
  );

  Widget _buildPause(_Pause pause) {
    final nextRoundMs = _nextRoundMs;
    final until = _roundOpen || nextRoundMs == null
        ? null
        : _getTimeUntil(nextRoundMs, _now.millisecondsSinceEpoch);
    final nextRoundLine = until != null
        ? ref.t('courses.branching.newRoundIn', {
            'time': ref.t(_unitKeys[until.unit]!, {'count': until.count}),
          })
        : _roundOpen
        ? ref.t('courses.branching.newRoundReady')
        : ref.t('courses.branching.newRoundLater');

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Semantics(
          header: true,
          child: Text(
            ref.t('courses.branching.exhaustedTitle'),
            key: const Key('branching-exhausted'),
            style: CourseText.serif(CourseType.bodyLarge, AppColors.highEmphasis, weight: FontWeight.w500),
          ),
        ),
        const SizedBox(height: 8),
        Text(nextRoundLine, style: CourseText.serif(CourseType.bodyMedium, AppColors.highEmphasis)),
        if (pause.recap.isNotEmpty) ...[
          const SizedBox(height: 16),
          Semantics(
            header: true,
            child: Text(
              ref.t('courses.branching.whatYouReached'),
              style: CourseText.serif(CourseType.bodyMedium, AppColors.mediumEmphasis, weight: FontWeight.w500),
            ),
          ),
          const SizedBox(height: 10),
          // RN `accessibilityRole="list"` labelled `recapLabel`.
          Semantics(
            key: const Key('branching-recap-list'),
            container: true,
            label: ref.t('courses.branching.recapLabel'),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [for (final entry in pause.recap) _buildRecapRow(entry)],
            ),
          ),
        ],
        if (_roundLoadFailed) ...[
          const SizedBox(height: 12),
          Semantics(
            liveRegion: true,
            child: Text(
              ref.t('courses.player.loadFailed'),
              textAlign: TextAlign.center,
              style: CourseText.serif(CourseType.bodyMedium, AppColors.mediumEmphasis),
            ),
          ),
        ],
        const SizedBox(height: 16),
        if (_roundOpen)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: CourseButton(
              key: const Key('branching-start-round'),
              label: ref.t('courses.branching.startNewRound'),
              isLoading: _isStarting,
              onPressed: _handleStartNewRound,
            ),
          ),
        CourseButton(
          key: const Key('branching-back'),
          label: ref.t('courses.player.backToCourse'),
          variant: _roundOpen ? CourseButtonVariant.secondary : CourseButtonVariant.primary,
          onPressed: widget.onBack,
        ),
      ],
    );
  }

  Widget _buildRecapRow(BranchingRecapEntry entry) {
    final ending = _nodesById[entry.endingNodeId];
    final scoreLabel = _data.passScore != null
        ? ref.t('courses.branching.score', {'score': entry.score})
        : null;
    final outcome = ending?.outcome;
    // RN: one `accessible` row read as "outcome. text. score. takeaway".
    final rowLabel = [
      if (outcome != null) ref.t(_outcomeKey(outcome)),
      ?ending?.text,
      ?scoreLabel,
      ?ending?.takeaway,
    ].where((part) => part.isNotEmpty).join('. ');
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Semantics(
        container: true,
        label: rowLabel,
        excludeSemantics: true,
        child: Container(
        key: const Key('branching-recap-row'),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          border: Border.all(color: AppColors.strokePrimary, width: 1.5),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildOutcomeBadge(ending?.outcome),
            if (ending != null) Text(ending.text, style: CourseText.serif(CourseType.bodyMedium, AppColors.highEmphasis)),
            if (scoreLabel != null)
              Text(scoreLabel, style: CourseText.serif(CourseType.bodySmall, AppColors.mediumEmphasis)),
            if (ending?.takeaway != null)
              Text(
                ending!.takeaway!,
                style: CourseText.serif(CourseType.bodySmall, AppColors.mediumEmphasis),
              ),
          ],
        ),
      ),
      ),
    );
  }
}
