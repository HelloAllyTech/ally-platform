import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/localization/translate_ref.dart';
import '../../../../core/theme/app_colors.dart';
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

/// One line per failure reason, in the order the backend sent them.
List<String> roleplayFailureLines(LastRoleplayAttempt attempt, RoleplayTranslate t) {
  final lines = <String>[];
  for (final reason in attempt.failureReasons) {
    switch (reason) {
      case RoleplayFailureReason.insufficientDuration:
        lines.add(
          t('courses.roleplay.lastAttemptDuration', {
            'actual': formatRoleplayDuration(attempt.durationSeconds, t),
            'required': formatRoleplayDuration(attempt.requiredDurationSeconds ?? 0, t),
          }),
        );
      case RoleplayFailureReason.insufficientScore:
        final required = _fmt(attempt.requiredScore ?? 0);
        lines.add(
          attempt.score == null
              ? t('courses.roleplay.lastAttemptScoreUnknown', {'required': required})
              : t('courses.roleplay.lastAttemptScore', {'score': _fmt(attempt.score!), 'required': required}),
        );
    }
  }
  return lines;
}

/// Why the learner's last roleplay attempt didn't count (same amber notice
/// styling as the assessment-mode notice).
class RoleplayAttemptNotice extends ConsumerWidget {
  const RoleplayAttemptNotice({super.key, required this.attempt});

  final LastRoleplayAttempt attempt;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final lines = roleplayFailureLines(attempt, ref.t);
    const base = TextStyle(fontFamily: 'CupertinoSystemText', fontSize: 13, color: AppColors.amber900);
    return Container(
      key: const Key('roleplay-last-attempt-notice'),
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(color: AppColors.amber50, borderRadius: BorderRadius.circular(12)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            ref.t('courses.roleplay.lastAttemptTitle'),
            style: base.copyWith(fontFamily: 'CupertinoSystemText', fontWeight: FontWeight.w600),
          ),
          for (final line in lines) ...[const SizedBox(height: 4), Text(line, style: base)],
          const SizedBox(height: 4),
          Text(ref.t('courses.roleplay.lastAttemptFooter'), style: base),
        ],
      ),
    );
  }
}
