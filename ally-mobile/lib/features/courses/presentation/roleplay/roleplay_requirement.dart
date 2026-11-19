import '../../data/course_models.dart';

typedef RoleplayTranslate = String Function(String, [Map<String, Object?>?]);

String _fmt(num n) => n == n.roundToDouble() ? n.toInt().toString() : n.toStringAsFixed(1);

/// "1 min 30 sec", "3 min", "45 sec".
String formatRoleplayDuration(int totalSeconds, RoleplayTranslate t) {
  final seconds = totalSeconds < 0 ? 0 : totalSeconds;
  final min = seconds ~/ 60;
  final sec = seconds % 60;
  if (min > 0 && sec > 0) return t('courses.meta.durationMinSec', {'min': min, 'sec': sec});
  if (min > 0) return t('courses.meta.durationMin', {'min': min});
  return t('courses.meta.durationSec', {'sec': sec});
}

/// The requirement line for a roleplay item, from the effective
/// `roleplayGate`; null when there is nothing to show.
String? roleplayRequirementText(RoleplayGate? gate, RoleplayTranslate t) {
  if (gate == null) return null;
  final score = (gate.minScore ?? 0) > 0 ? gate.minScore : null;
  final duration = (gate.minDurationSeconds ?? 0) > 0 ? gate.minDurationSeconds : null;
  String scoreText() => t('courses.meta.requireScore', {'score': _fmt(score!)});
  String durationText() =>
      t('courses.meta.requireDuration', {'duration': formatRoleplayDuration(duration!, t)});
  switch (gate.completionLogic) {
    case RoleplayCompletionLogic.participation:
      return t('courses.meta.requireParticipation');
    case RoleplayCompletionLogic.score:
      return score == null ? null : scoreText();
    case RoleplayCompletionLogic.duration:
      return duration == null ? null : durationText();
    case RoleplayCompletionLogic.scoreAndDuration:
      if (score != null && duration != null) {
        return t('courses.meta.requireScoreAndDuration', {
          'score': _fmt(score),
          'duration': formatRoleplayDuration(duration, t),
        });
      }
      if (score != null) return scoreText();
      if (duration != null) return durationText();
      return null;
  }
}
