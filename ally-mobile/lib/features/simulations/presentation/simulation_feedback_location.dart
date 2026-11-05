/// Route location for SimulationFeedbackScreen carrying RN's
/// `SimulationFeedback` params (`scenarioSessionId`, `fromLogs`, `pathId`,
/// `caseId`, `languageId`) — one builder so every caller (live role play,
/// path/case details, call logs) threads the same params.
String simulationFeedbackLocation(
  String scenarioSessionId, {
  bool fromLogs = false,
  String? pathId,
  String? caseId,
  int? languageId,
}) {
  final query = <String, String>{
    if (fromLogs) 'fromLogs': 'true',
    if (pathId != null && pathId.isNotEmpty) 'pathId': pathId,
    if (caseId != null && caseId.isNotEmpty) 'caseId': caseId,
    'languageId': ?languageId?.toString(),
  };
  return Uri(
    path: '/simulations/feedback/$scenarioSessionId',
    queryParameters: query.isEmpty ? null : query,
  ).toString();
}
