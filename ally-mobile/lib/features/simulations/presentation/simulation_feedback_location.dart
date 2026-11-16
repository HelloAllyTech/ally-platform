/// Route location for SimulationFeedbackScreen carrying RN's
/// `SimulationFeedback` params (`scenarioSessionId`, `fromLogs`, `pathId`,
/// `caseId`, `languageId`) — one builder so every caller (live role play,
/// path/case details, call logs) threads the same params.
///
/// [trackId] / [trackItemId]: the roleplay was played inside a course
/// (web `ActiveTrackContext`), so Feedback's back returns to the course and
/// it offers "Continue the course". Carried in the location, never in global
/// state, so it can't leak into a later standalone roleplay.
String simulationFeedbackLocation(
  String scenarioSessionId, {
  bool fromLogs = false,
  String? pathId,
  String? caseId,
  int? languageId,
  String? trackId,
  String? trackItemId,
}) {
  final hasTrack = trackId != null && trackId.isNotEmpty;
  final query = <String, String>{
    if (fromLogs) 'fromLogs': 'true',
    if (pathId != null && pathId.isNotEmpty) 'pathId': pathId,
    if (caseId != null && caseId.isNotEmpty) 'caseId': caseId,
    'languageId': ?languageId?.toString(),
    if (hasTrack) 'trackId': trackId,
    if (hasTrack && trackItemId != null && trackItemId.isNotEmpty) 'trackItemId': trackItemId,
  };
  return Uri(
    path: '/simulations/feedback/$scenarioSessionId',
    queryParameters: query.isEmpty ? null : query,
  ).toString();
}
