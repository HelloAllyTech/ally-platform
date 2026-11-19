import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/courses/data/course_models.dart';
import 'package:ally_mobile_flutter/features/courses/presentation/track_blocker.dart';

String _t(String key, [Map<String, Object?>? params]) =>
    params == null ? key : '$key${params.entries.map((e) => '${e.key}=${e.value}').toList()}';

TrackBlocker _b(
  TrackBlockerReasonCode code, {
  double? actual,
  double? required,
  String type = 'QUIZ',
  String? retryAt,
}) =>
    TrackBlocker(
      itemId: 'p1',
      title: 'Prev',
      type: type,
      reasons: [TrackBlockerReason(code: code, actual: actual, required: required)],
      action: TrackBlockerAction.none,
      retryAt: retryAt,
    );

void main() {
  test('notFinished, notScored, assessmentFailed, gradingPending, keepReading pass the title', () {
    for (final (code, key) in [
      (TrackBlockerReasonCode.notFinished, 'notFinished'),
      (TrackBlockerReasonCode.notScored, 'notScored'),
      (TrackBlockerReasonCode.assessmentFailed, 'assessmentFailed'),
      (TrackBlockerReasonCode.gradingPending, 'gradingPending'),
      (TrackBlockerReasonCode.keepReading, 'keepReading'),
    ]) {
      expect(trackBlockerLines(_b(code), _t), ['courses.blocker.$key[title=Prev]']);
    }
  });

  test('belowScore is points for roleplay/case and percent otherwise', () {
    expect(
      trackBlockerLines(_b(TrackBlockerReasonCode.belowScore, actual: 55, required: 70, type: 'ROLEPLAY'), _t),
      ['courses.blocker.belowScore[title=Prev, actual=55, required=70]'],
    );
    expect(
      trackBlockerLines(_b(TrackBlockerReasonCode.belowScore, actual: 40, required: 70.5), _t),
      ['courses.blocker.belowScore[title=Prev, actual=40%, required=70.5%]'],
    );
  });

  test('tooShort formats seconds as durations', () {
    expect(
      trackBlockerLines(_b(TrackBlockerReasonCode.tooShort, actual: 90, required: 180, type: 'ROLEPLAY'), _t),
      [
        'courses.blocker.tooShort[title=Prev, actual=courses.meta.durationMinSec[min=1, sec=30], '
            'required=courses.meta.durationMin[min=3]]',
      ],
    );
  });

  test('outOfAttempts shows the date only when retryAt parses', () {
    expect(
      trackBlockerLines(_b(TrackBlockerReasonCode.outOfAttempts), _t),
      ['courses.blocker.outOfAttempts[title=Prev]'],
    );
    final withDate = trackBlockerLines(
      _b(TrackBlockerReasonCode.outOfAttempts, retryAt: '2026-12-15T12:00:00.000Z'),
      _t,
    ).single;
    expect(withDate, startsWith('courses.blocker.outOfAttemptsUntil[title=Prev, date='));
    expect(withDate, contains('Dec'));
  });

  test('watchMore passes percentages', () {
    expect(
      trackBlockerLines(_b(TrackBlockerReasonCode.watchMore, actual: 30, required: 80, type: 'VIDEO'), _t),
      ['courses.blocker.watchMore[title=Prev, actual=30, required=80]'],
    );
  });

  test('two reasons give two lines in order', () {
    final b = TrackBlocker(
      itemId: 'p1',
      title: 'Prev',
      type: 'ROLEPLAY',
      reasons: const [
        TrackBlockerReason(code: TrackBlockerReasonCode.belowScore, actual: 1, required: 2),
        TrackBlockerReason(code: TrackBlockerReasonCode.tooShort, actual: 3, required: 4),
      ],
      action: TrackBlockerAction.retry,
    );
    expect(trackBlockerLines(b, _t).length, 2);
  });
}
