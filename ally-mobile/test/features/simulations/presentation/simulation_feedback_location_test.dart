import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/simulations/presentation/simulation_feedback_location.dart';

void main() {
  test('a fresh session has no query', () {
    expect(simulationFeedbackLocation('s1'), '/simulations/feedback/s1');
  });

  test('carries RN SimulationFeedback params', () {
    final uri = Uri.parse(simulationFeedbackLocation('s1', fromLogs: true, pathId: 'p1', languageId: 3));
    expect(uri.path, '/simulations/feedback/s1');
    expect(uri.queryParameters, {'fromLogs': 'true', 'pathId': 'p1', 'languageId': '3'});
  });

  test('empty ids are dropped', () {
    expect(simulationFeedbackLocation('s1', caseId: ''), '/simulations/feedback/s1');
  });
}
