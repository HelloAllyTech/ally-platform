import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';

/// The learner's view of the Debrief agent's debrief for one practice
/// session, as served by `GET /api/v1/debriefs/sessions/:sessionId`. Mirrors the
/// web helpline's `types/learnerDebrief.ts`.
///
/// `notAvailable` means the learner's organisation isn't switched on for the
/// new debrief — callers then keep showing the existing debrief unchanged.
enum LearnerDebriefState {
  ready,
  working,
  onItsWay,
  tooShort,
  notAvailable;

  static LearnerDebriefState parse(Object? value) => switch (value) {
    'ready' => ready,
    'working' => working,
    'on_its_way' => onItsWay,
    'too_short' => tooShort,
    _ => notAvailable,
  };
}

/// The wire value doubles as the translation-key suffix
/// (`postSim.debriefCards.skillWords.<wire>`).
enum DebriefSkillWord {
  strength('strength'),
  keepPractising('keep_practising'),
  didntComeUp('didnt_come_up');

  const DebriefSkillWord(this.wire);
  final String wire;

  static DebriefSkillWord? parse(Object? value) {
    for (final word in values) {
      if (word.wire == value) return word;
    }
    return null;
  }
}

/// Why a learner flags a card. The wire value is the request body's
/// `reason` and the translation-key suffix.
enum DebriefFlagReason {
  didntSay('didnt_say'),
  describedWrongly('described_wrongly'),
  adviceDoesntFit('advice_doesnt_fit'),
  somethingElse('something_else');

  const DebriefFlagReason(this.wire);
  final String wire;
}

String _str(Object? value) => value is String ? value : '';
String? _optStr(Object? value) => value is String && value.trim().isNotEmpty ? value : null;
int _int(Object? value) => value is num ? value.toInt() : 0;
int? _optInt(Object? value) => value is num ? value.toInt() : null;
List<Map<String, dynamic>> _maps(Object? value) =>
    value is List ? value.whereType<Map<String, dynamic>>().toList() : const [];

class DebriefOtherMoment {
  const DebriefOtherMoment({required this.turnIndex, required this.quote, required this.note});

  factory DebriefOtherMoment.fromJson(Map<String, dynamic> json) =>
      DebriefOtherMoment(turnIndex: _int(json['turn_index']), quote: _str(json['quote']), note: _str(json['note']));

  final int turnIndex;
  final String quote;
  final String note;
}

class DebriefImportantMoment {
  const DebriefImportantMoment({
    required this.turnIndex,
    required this.quote,
    required this.handledWell,
    required this.lead,
    required this.body,
    this.others = const [],
  });

  factory DebriefImportantMoment.fromJson(Map<String, dynamic> json) => DebriefImportantMoment(
    turnIndex: _int(json['turn_index']),
    quote: _str(json['quote']),
    handledWell: json['handled_well'] == true,
    lead: _str(json['lead']),
    body: _str(json['body']),
    others: _maps(json['others']).map(DebriefOtherMoment.fromJson).toList(),
  );

  final int turnIndex;
  final String quote;
  final bool handledWell;
  final String lead;
  final String body;

  /// Every other risk cue in the session, one line each.
  final List<DebriefOtherMoment> others;
}

class DebriefWhatWorked {
  const DebriefWhatWorked({
    required this.skill,
    required this.turnIndex,
    required this.quote,
    required this.lead,
    required this.body,
  });

  factory DebriefWhatWorked.fromJson(Map<String, dynamic> json) => DebriefWhatWorked(
    skill: _str(json['skill']),
    turnIndex: _int(json['turn_index']),
    quote: _str(json['quote']),
    lead: _str(json['lead']),
    body: _str(json['body']),
  );

  final String skill;
  final int turnIndex;
  final String quote;
  final String lead;
  final String body;
}

class DebriefWorkOnThis {
  const DebriefWorkOnThis({
    required this.skill,
    required this.turnIndex,
    required this.quote,
    required this.lead,
    required this.why,
    required this.trySaying,
    this.scenarioId,
  });

  factory DebriefWorkOnThis.fromJson(Map<String, dynamic> json) => DebriefWorkOnThis(
    skill: _str(json['skill']),
    turnIndex: _int(json['turn_index']),
    quote: _str(json['quote']),
    lead: _str(json['lead']),
    why: _str(json['why']),
    trySaying: _str(json['try_saying']),
    scenarioId: _optInt(json['scenario_id']),
  );

  final String skill;
  final int turnIndex;
  final String quote;
  final String lead;
  final String why;
  final String trySaying;

  /// The roleplay that practises this, when there is one. "Practise this"
  /// shows only when it is also in [LearnerDebriefView.practice].
  final int? scenarioId;
}

class DebriefPractiseNext {
  const DebriefPractiseNext({required this.skill, required this.reason, this.scenarioId});

  final String skill;
  final String reason;

  /// As [DebriefWorkOnThis.scenarioId], for "Practise this next".
  final int? scenarioId;
}

class DebriefSkillWordEntry {
  const DebriefSkillWordEntry({required this.skill, required this.word});

  final String skill;
  final DebriefSkillWord word;
}

class DebriefCardsData {
  const DebriefCardsData({
    required this.opening,
    this.importantMoment,
    this.whatWorked = const [],
    this.workOnThis = const [],
    this.practiseNext,
    this.skillWords = const [],
    required this.reflectiveQuestion,
    this.progressNote,
  });

  factory DebriefCardsData.fromJson(Map<String, dynamic> json) {
    final moment = json['important_moment'];
    final practise = json['practise_next'];
    return DebriefCardsData(
      opening: _str(json['opening']),
      importantMoment: moment is Map<String, dynamic> ? DebriefImportantMoment.fromJson(moment) : null,
      whatWorked: _maps(json['what_worked']).map(DebriefWhatWorked.fromJson).toList(),
      workOnThis: _maps(json['work_on_this']).map(DebriefWorkOnThis.fromJson).toList(),
      practiseNext: practise is Map<String, dynamic>
          ? DebriefPractiseNext(
              skill: _str(practise['skill']),
              reason: _str(practise['reason']),
              scenarioId: _optInt(practise['scenario_id']),
            )
          : null,
      skillWords: [
        for (final entry in _maps(json['skill_words']))
          if (DebriefSkillWord.parse(entry['word']) case final word?)
            DebriefSkillWordEntry(skill: _str(entry['skill']), word: word),
      ],
      reflectiveQuestion: _str(json['reflective_question']),
      progressNote: _optStr(json['progress_note']),
    );
  }

  final String opening;
  final DebriefImportantMoment? importantMoment;
  final List<DebriefWhatWorked> whatWorked;
  final List<DebriefWorkOnThis> workOnThis;
  final DebriefPractiseNext? practiseNext;
  final List<DebriefSkillWordEntry> skillWords;
  final String reflectiveQuestion;
  final String? progressNote;
}

/// What the Ally team decided about a flagged card.
enum DebriefCorrectionOutcome {
  kept,
  removed,

  /// The card now shows the team's new words (v9 FR-31).
  corrected;

  /// Anything unrecognised reads as `kept`: the card stays as it is.
  static DebriefCorrectionOutcome parse(Object? value) => switch (value) {
    'removed' => removed,
    'corrected' => corrected,
    _ => kept,
  };
}

/// The Ally team's answer to a flag: the card stays (with why), is
/// rewritten (with when and why), or is taken out.
class DebriefCorrection {
  const DebriefCorrection({required this.section, required this.outcome, this.note, this.at});

  factory DebriefCorrection.fromJson(Map<String, dynamic> json) => DebriefCorrection(
    section: _str(json['section']),
    outcome: DebriefCorrectionOutcome.parse(json['outcome']),
    note: _optStr(json['note']),
    at: json['at'] is String ? DateTime.tryParse(json['at'] as String) : null,
  );

  final String section;
  final DebriefCorrectionOutcome outcome;
  final String? note;
  final DateTime? at;

  bool get removed => outcome == DebriefCorrectionOutcome.removed;
}

/// What a `working` debrief is doing now (v9 FR-27), as a key the app words
/// in the learner's language (`postSim.debriefCards.working.steps.<key>`).
/// [parse] returns null for an unknown key, so the card falls back to the
/// latest `steps` line.
class DebriefProgress {
  const DebriefProgress._(this.key, {this.topic, this.round});

  static const _plainKeys = {'reading', 'past_sessions', 'writing', 'reviewing', 'care'};

  static DebriefProgress? parse(Object? json) {
    if (json is! Map<String, dynamic>) return null;
    final key = json['key'];
    if (key == 'guidance') return DebriefProgress._('guidance', topic: _optStr(json['topic']));
    if (key == 'revising') {
      final round = _optInt(json['round']);
      return round == null ? null : DebriefProgress._('revising', round: round);
    }
    return _plainKeys.contains(key) ? DebriefProgress._(key as String) : null;
  }

  final String key;

  /// `guidance` only: what the guidance is about, when the agent says.
  final String? topic;

  /// `revising` only: which pass of the reviewer's notes this is.
  final int? round;
}

/// One of the learner's own flags. [canUndoUntil] is null once the undo
/// window has closed (or the flag has been reviewed).
class DebriefMyFlag {
  const DebriefMyFlag({required this.id, required this.section, required this.status, this.canUndoUntil});

  factory DebriefMyFlag.fromJson(Map<String, dynamic> json) => DebriefMyFlag(
    id: '${json['id'] ?? ''}',
    section: _str(json['section']),
    status: _str(json['status']),
    canUndoUntil: json['canUndoUntil'] is String ? DateTime.tryParse(json['canUndoUntil'] as String) : null,
  );

  final String id;
  final String section;

  /// `open`, `kept`, `removed` or `corrected`; a reviewed flag's card shows
  /// its [DebriefCorrection] instead.
  final String status;
  final DateTime? canUndoUntil;

  bool canUndoAt(DateTime now) => canUndoUntil != null && canUndoUntil!.isAfter(now);
}

/// One of the learner's flags as a supervisor reads it (v9 FR-26): why,
/// their note, and where the Ally team's review stands. `withdrawn` flags
/// never arrive (the server drops them).
class SupervisorDebriefFlag {
  const SupervisorDebriefFlag({
    required this.section,
    required this.status,
    this.reason,
    this.note,
    this.resolutionNote,
  });

  factory SupervisorDebriefFlag.fromJson(Map<String, dynamic> json) => SupervisorDebriefFlag(
    section: _str(json['section']),
    status: _str(json['status']),
    reason: _flagReason(json['reason']),
    note: _optStr(json['note']),
    resolutionNote: _optStr(json['resolutionNote']),
  );

  final String section;

  /// `open`, `escalated`, `kept`, `removed` or `corrected`.
  final String status;
  final DebriefFlagReason? reason;
  final String? note;
  final String? resolutionNote;
}

DebriefFlagReason? _flagReason(Object? value) {
  for (final reason in DebriefFlagReason.values) {
    if (reason.wire == value) return reason;
  }
  return null;
}

/// One turn of the learner's Ask Ally thread, as a supervisor reads it.
class SupervisorThreadMessage {
  const SupervisorThreadMessage({required this.fromLearner, required this.content, required this.at});

  factory SupervisorThreadMessage.fromJson(Map<String, dynamic> json) => SupervisorThreadMessage(
    fromLearner: json['role'] == 'learner',
    content: _str(json['content']),
    at: _str(json['at']),
  );

  final bool fromLearner;
  final String content;
  final String at;
}

/// What a supervisor sees besides the cards (web `SupervisorView`): the
/// learner's flags, their "Was this helpful?" answer and their thread.
class SupervisorDebriefExtras {
  const SupervisorDebriefExtras({this.flags = const [], this.helpful, this.thread = const []});

  final List<SupervisorDebriefFlag> flags;
  final bool? helpful;
  final List<SupervisorThreadMessage> thread;

  SupervisorDebriefFlag? flagFor(String section) => flags.where((f) => f.section == section).firstOrNull;
}

/// One of the organisation's support lines, shown with the important
/// moment and when the learner stepped out of the role in distress.
class DebriefSupportLine {
  const DebriefSupportLine({required this.name, required this.phone, this.hours, this.url, this.isCrisis = false});

  factory DebriefSupportLine.fromJson(Map<String, dynamic> json) => DebriefSupportLine(
    name: _str(json['name']),
    phone: _str(json['phone']),
    hours: _optStr(json['hours']),
    url: _optStr(json['url']),
    isCrisis: json['isCrisis'] == true,
  );

  final String name;
  final String phone;
  final String? hours;
  final String? url;
  final bool isCrisis;

  /// The `tel:` link: digits and a leading `+` only, as the web strips it.
  Uri get telUri => Uri(scheme: 'tel', path: phone.replaceAll(RegExp(r'[^\d+]'), ''));
}

/// A roleplay the learner can still open, for "Practise this (next)".
class DebriefPracticeScenario {
  const DebriefPracticeScenario({required this.id, required this.title});

  final int id;
  final String title;
}

class LearnerDebriefView {
  const LearnerDebriefView({
    required this.state,
    this.cards,
    this.language,
    this.steps = const [],
    this.progress,
    this.corrections = const [],
    this.helpful,
    this.flags = const [],
    this.distress = false,
    this.supportLines = const [],
    this.practice = const [],
    this.supervisor,
  });

  /// `GET /debriefs/sessions/:id/supervisor` (v9 FR-26), as a read-only
  /// view: `ready` or `not_available` only, so it never polls; no distress,
  /// support lines or roleplays (web `DebriefTab`'s supervisor branch).
  factory LearnerDebriefView.fromSupervisorJson(Map<String, dynamic> json) {
    final cards = json['cards'];
    final helpful = json['helpful'];
    return LearnerDebriefView(
      state: json['state'] == 'ready' ? LearnerDebriefState.ready : LearnerDebriefState.notAvailable,
      cards: cards is Map<String, dynamic> ? DebriefCardsData.fromJson(cards) : null,
      language: _optStr(json['language']),
      corrections: _maps(json['corrections']).map(DebriefCorrection.fromJson).toList(),
      supervisor: SupervisorDebriefExtras(
        flags: _maps(json['flags']).map(SupervisorDebriefFlag.fromJson).toList(),
        helpful: helpful is bool ? helpful : null,
        thread: _maps(json['thread']).map(SupervisorThreadMessage.fromJson).toList(),
      ),
    );
  }

  factory LearnerDebriefView.fromJson(Map<String, dynamic> json) {
    final cards = json['cards'];
    final feedback = json['feedback'];
    final helpful = feedback is Map<String, dynamic> ? feedback['helpful'] : null;
    return LearnerDebriefView(
      state: LearnerDebriefState.parse(json['state']),
      cards: cards is Map<String, dynamic> ? DebriefCardsData.fromJson(cards) : null,
      language: _optStr(json['language']),
      steps: json['steps'] is List ? (json['steps'] as List).whereType<String>().toList() : const [],
      progress: DebriefProgress.parse(json['progress']),
      corrections: _maps(json['corrections']).map(DebriefCorrection.fromJson).toList(),
      helpful: helpful is bool ? helpful : null,
      flags: feedback is Map<String, dynamic>
          ? _maps(feedback['flags']).map(DebriefMyFlag.fromJson).toList()
          : const [],
      distress: json['distress'] == true,
      supportLines: _maps(json['supportLines'])
          .map(DebriefSupportLine.fromJson)
          .where((l) => l.phone.isNotEmpty)
          .toList(),
      practice: [
        for (final p in _maps(json['practice']))
          if (_optInt(p['id']) case final id?) DebriefPracticeScenario(id: id, title: _str(p['title'])),
      ],
    );
  }

  final LearnerDebriefState state;
  final DebriefCardsData? cards;
  final String? language;
  final List<String> steps;

  /// `working` only: the current step as a key; null on older servers, so
  /// the card shows the latest of [steps] instead.
  final DebriefProgress? progress;
  final List<DebriefCorrection> corrections;
  final bool? helpful;
  final List<DebriefMyFlag> flags;

  /// The learner stepped out of the role in distress: care comes before
  /// coaching (an acknowledgement and [supportLines] first).
  final bool distress;
  final List<DebriefSupportLine> supportLines;

  /// The roleplays a card may link to; anything else gets no button.
  final List<DebriefPracticeScenario> practice;

  /// Set when a supervisor reads the debrief from Roleplay Logs: the cards
  /// are read-only and show the learner's feedback instead of controls.
  final SupervisorDebriefExtras? supervisor;

  DebriefPracticeScenario? practiceFor(int? scenarioId) =>
      scenarioId == null ? null : practice.where((p) => p.id == scenarioId).firstOrNull;

  /// Whether this answer replaces today's debrief. False for `not_available`
  /// and for a `ready` answer with no cards (nothing to render).
  bool get isShowable =>
      state != LearnerDebriefState.notAvailable && !(state == LearnerDebriefState.ready && cards == null);

  LearnerDebriefView copyWith({bool? helpful, List<DebriefMyFlag>? flags}) => LearnerDebriefView(
    state: state,
    cards: cards,
    language: language,
    steps: steps,
    progress: progress,
    corrections: corrections,
    helpful: helpful ?? this.helpful,
    flags: flags ?? this.flags,
    distress: distress,
    supportLines: supportLines,
    practice: practice,
    supervisor: supervisor,
  );
}

/// The web helpline's `api/learnerDebrief.ts`: the Debrief agent's debrief
/// for one of the caller's own sessions, plus "Was this helpful?" and
/// "This isn't right" on a card.
class LearnerDebriefRepository {
  LearnerDebriefRepository(this._dio);

  final Dio _dio;

  Future<LearnerDebriefView> getDebrief(String sessionId) async {
    final response = await _dio.get<Map<String, dynamic>>('/debriefs/sessions/$sessionId');
    return LearnerDebriefView.fromJson(response.data ?? const {});
  }

  /// A supervisor's read-only view of a learner's debrief, from Roleplay
  /// Logs (needs VIEW_ADMIN_SCENARIO_SESSION; 403 for another organisation).
  Future<LearnerDebriefView> getSupervisorDebrief(String sessionId) async {
    final response = await _dio.get<Map<String, dynamic>>('/debriefs/sessions/$sessionId/supervisor');
    return LearnerDebriefView.fromSupervisorJson(response.data ?? const {});
  }

  /// One answer per debrief; answering again changes it.
  Future<void> setHelpful(String sessionId, {required bool helpful}) async {
    await _dio.put<void>('/debriefs/sessions/$sessionId/helpful', data: {'helpful': helpful});
  }

  /// "This isn't right" on one card. A 409 (already flagged) throws like
  /// any other failure.
  Future<({String id, DateTime? undoUntil})> flagCard(
    String sessionId, {
    required String section,
    required DebriefFlagReason reason,
    String? note,
  }) async {
    final response = await _dio.post<Map<String, dynamic>>(
      '/debriefs/sessions/$sessionId/flags',
      data: {'section': section, 'reason': reason.wire, 'note': ?note},
    );
    final data = response.data ?? const {};
    final undoUntil = data['undoUntil'];
    return (id: '${data['id'] ?? ''}', undoUntil: undoUntil is String ? DateTime.tryParse(undoUntil) : null);
  }

  /// Takes a flag back (only within its ten-minute undo window).
  Future<void> undoFlag(String sessionId, String flagId) async {
    await _dio.delete<void>('/debriefs/sessions/$sessionId/flags/$flagId');
  }

  /// Read-aloud: one card's audio (`important_moment`, `what_worked[0]`, …),
  /// made on the first request and cached by the server. The signed link
  /// lives an hour.
  Future<String> getCardAudioUrl(String sessionId, String section) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/debriefs/sessions/$sessionId/audio/${Uri.encodeComponent(section)}',
    );
    final url = response.data?['url'];
    if (url is! String || url.isEmpty) throw StateError('No audio url for $section');
    return url;
  }

  /// The learner read the debrief to the end: earns DEBRIEF_READ XP once
  /// (the server pays at most once per session).
  Future<void> markRead(String sessionId) async {
    await _dio.post<void>('/debriefs/sessions/$sessionId/read');
  }

  /// The learner had the ready debrief open (v9 FR-31 `openedAt`); the
  /// server records the first one only. 404 without a published debrief.
  Future<void> markOpened(String sessionId) async {
    await _dio.post<void>('/debriefs/sessions/$sessionId/opened');
  }

  /// Ask Ally: the debrief chat's thread, answered by the Debrief agent.
  /// Same SSE events as the scenario-session chat stream; the history is shared.
  static String replyStreamPath(String sessionId) => '/debriefs/sessions/$sessionId/reply/stream';
}

final learnerDebriefRepositoryProvider = Provider<LearnerDebriefRepository>((ref) {
  return LearnerDebriefRepository(ref.watch(apiClientProvider));
});
