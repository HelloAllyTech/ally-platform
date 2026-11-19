import '../../../core/localization/cached_date_format.dart';
import '../data/course_models.dart';
import 'roleplay/roleplay_requirement.dart';

String _num(double n) => n == n.roundToDouble() ? n.toInt().toString() : n.toStringAsFixed(1);

/// BELOW_SCORE is in points for ROLEPLAY/CASE and a percentage otherwise.
bool _scoreIsPoints(String type) => type == 'ROLEPLAY' || type == 'CASE';

/// One line per blocker reason, telling the learner what the item before the
/// locked one still needs. Pure so it can be tested without a widget tree.
List<String> trackBlockerLines(TrackBlocker b, RoleplayTranslate t) {
  final lines = <String>[];
  for (final r in b.reasons) {
    final base = <String, Object?>{'title': b.title};
    switch (r.code) {
      case TrackBlockerReasonCode.notFinished:
        lines.add(t('courses.blocker.notFinished', base));
      case TrackBlockerReasonCode.belowScore:
        final suffix = _scoreIsPoints(b.type) ? '' : '%';
        lines.add(
          t('courses.blocker.belowScore', {
            ...base,
            'actual': r.actual == null ? '0$suffix' : '${_num(r.actual!)}$suffix',
            'required': r.required == null ? '' : '${_num(r.required!)}$suffix',
          }),
        );
      case TrackBlockerReasonCode.tooShort:
        lines.add(
          t('courses.blocker.tooShort', {
            ...base,
            'actual': formatRoleplayDuration((r.actual ?? 0).round(), t),
            'required': formatRoleplayDuration((r.required ?? 0).round(), t),
          }),
        );
      case TrackBlockerReasonCode.notScored:
        lines.add(t('courses.blocker.notScored', base));
      case TrackBlockerReasonCode.assessmentFailed:
        lines.add(t('courses.blocker.assessmentFailed', base));
      case TrackBlockerReasonCode.gradingPending:
        lines.add(t('courses.blocker.gradingPending', base));
      case TrackBlockerReasonCode.outOfAttempts:
        final date = b.retryAt == null ? null : DateTime.tryParse(b.retryAt!);
        lines.add(
          date == null
              ? t('courses.blocker.outOfAttempts', base)
              : t('courses.blocker.outOfAttemptsUntil', {
                  ...base,
                  'date': cachedDateFormat('MMM dd').format(date.toLocal()),
                }),
        );
      case TrackBlockerReasonCode.watchMore:
        lines.add(
          t('courses.blocker.watchMore', {
            ...base,
            'actual': _num(r.actual ?? 0),
            'required': _num(r.required ?? 0),
          }),
        );
      case TrackBlockerReasonCode.keepReading:
        lines.add(t('courses.blocker.keepReading', base));
    }
  }
  return lines;
}
