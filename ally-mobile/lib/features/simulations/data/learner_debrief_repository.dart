import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart' show TargetPlatform, defaultTargetPlatform;
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';

/// The learner's view of the Debrief agent's debrief for one practice
/// session, as served by `GET /api/v1/debriefs/sessions/:sessionId`. Mirrors the
/// web helpline's `types/learnerDebrief.ts`.
///
/// `notAvailable` means the learner's organisation isn't switched on for the
/// new debrief — callers then keep showing the existing debrief unchanged —
/// unless the view is `stopped` (an emergency stop, FR-46): then the tab
/// says "not available".
///
/// `failed` and `offline` are never sent by the server: the controller sets
/// them when the request itself failed (a 5xx; no connection), so the
/// learner sees "didn't load" / "You're offline" with Try again rather than
/// the old note (PRD §6.12).
enum LearnerDebriefState {
  ready,
  working,

  /// A person is finishing it, no risk cue (plan §10.3): "taking longer"
  /// with Check again. With a risk cue the server says [onItsWay].
  takingLonger,
  onItsWay,
  tooShort,
  notAvailable,
  failed,
  offline;

  static LearnerDebriefState parse(Object? value) => switch (value) {
    'ready' => ready,
    'working' => working,
    'taking_longer' => takingLonger,
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

/// What a learner did with a debrief that only the app can see, for the
/// experience metrics (`POST /debriefs/sessions/:id/events`). The wire value
/// is the body's `kind`. Listening and replies are recorded by the server.
enum DebriefLearnerEvent {
  /// The end of the first Work-on-this point was on screen.
  readThrough('read_through'),

  /// "Practise this next" was tapped.
  practiseNextClick('practise_next_click'),

  /// The working screen (debrief still being written) was shown.
  waited('waited'),

  /// The learner left the working screen before the debrief was ready.
  leftBeforeReady('left_before_ready');

  const DebriefLearnerEvent(this.wire);
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

/// How a skill has moved over the learner's recent sessions (post-veto). The
/// wire value doubles as the translation-key suffix
/// (`postSim.debriefCards.progressCard.trends.<wire>`).
enum DebriefProgressTrend {
  moreConsistent('more_consistent'),
  aboutTheSame('about_the_same'),
  worthAnotherLook('worth_another_look'),
  tooEarly('too_early');

  const DebriefProgressTrend(this.wire);
  final String wire;

  static DebriefProgressTrend? parse(Object? value) {
    for (final trend in values) {
      if (trend.wire == value) return trend;
    }
    return null;
  }
}

class DebriefProgressSkill {
  const DebriefProgressSkill({required this.skill, required this.trend, required this.line});

  /// A foundational skill key (`empathy`, `harm`, …).
  final String skill;
  final DebriefProgressTrend trend;
  final String line;
}

class DebriefProgressFocus {
  const DebriefProgressFocus({required this.skill, required this.line});

  final String skill;
  final String line;
}

/// `cards.progress_card`, "Your last {n} sessions" (progress contract §2):
/// only on the debrief where the card is due.
class DebriefProgressCard {
  const DebriefProgressCard({required this.sessions, this.skills = const [], this.focus});

  /// The card, or null when it is absent or has nothing a learner can read.
  /// Skills without a line or with an unknown trend are dropped rather than
  /// shown half-empty.
  static DebriefProgressCard? parse(Object? json) {
    if (json is! Map<String, dynamic>) return null;
    final sessions = json['sessions'];
    if (sessions is! num || sessions != sessions.roundToDouble() || sessions < 1) return null;
    final skills = [
      for (final entry in _maps(json['skills']))
        if ((_optStr(entry['skill']), _optStr(entry['line']), DebriefProgressTrend.parse(entry['trend']))
            case (final skill?, final line?, final trend?))
          DebriefProgressSkill(skill: skill.trim(), trend: trend, line: line.trim()),
    ];
    final focusJson = json['focus'];
    final focus = focusJson is Map<String, dynamic>
        ? switch ((_optStr(focusJson['skill']), _optStr(focusJson['line']))) {
            (final skill?, final line?) => DebriefProgressFocus(skill: skill.trim(), line: line.trim()),
            _ => null,
          }
        : null;
    if (focus == null && skills.isEmpty) return null;
    return DebriefProgressCard(sessions: sessions.toInt(), skills: skills, focus: focus);
  }

  final int sessions;
  final List<DebriefProgressSkill> skills;
  final DebriefProgressFocus? focus;
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
    this.progressCard,
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
      progressCard: DebriefProgressCard.parse(json['progress_card']),
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

  /// "Your last {n} sessions", when the card is due on this debrief.
  final DebriefProgressCard? progressCard;
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

/// Which pulse question (PRD §9); the wire value is the body's `question`
/// and the translation-key suffix (`postSim.debriefCards.pulse.<wire>`).
enum DebriefPulseQuestion {
  knewNext('knew_next'),
  fair('fair');

  const DebriefPulseQuestion(this.wire);
  final String wire;
}

/// The post-launch pulse (PRD §9): on a debrief the server picked (1 in 10,
/// for 8 weeks), two yes/no questions and the answers so far.
class DebriefPulse {
  const DebriefPulse({this.knewNext, this.fair});

  static DebriefPulse? parse(Object? json) {
    if (json is! Map<String, dynamic>) return null;
    final knewNext = json['knew_next'];
    final fair = json['fair'];
    return DebriefPulse(knewNext: knewNext is bool ? knewNext : null, fair: fair is bool ? fair : null);
  }

  final bool? knewNext;
  final bool? fair;

  bool? answerTo(DebriefPulseQuestion question) => switch (question) {
    DebriefPulseQuestion.knewNext => knewNext,
    DebriefPulseQuestion.fair => fair,
  };

  DebriefPulse withAnswer(DebriefPulseQuestion question, bool answer) => switch (question) {
    DebriefPulseQuestion.knewNext => DebriefPulse(knewNext: answer, fair: fair),
    DebriefPulseQuestion.fair => DebriefPulse(knewNext: knewNext, fair: answer),
  };
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
    this.riskCue = false,
    this.supportLines = const [],
    this.practice = const [],
    this.supervisor,
    this.pulse,
    this.stopped = false,
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
      riskCue: json['riskCue'] == true,
      supportLines: _maps(json['supportLines'])
          .map(DebriefSupportLine.fromJson)
          .where((l) => l.phone.isNotEmpty)
          .toList(),
      practice: [
        for (final p in _maps(json['practice']))
          if (_optInt(p['id']) case final id?) DebriefPracticeScenario(id: id, title: _str(p['title'])),
      ],
      pulse: DebriefPulse.parse(json['pulse']),
      stopped: json['stopped'] == true,
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

  /// The safety reading found a risk cue: the [supportLines] show even when
  /// the debrief has no important-moment card.
  final bool riskCue;
  final List<DebriefSupportLine> supportLines;

  /// The roleplays a card may link to; anything else gets no button.
  final List<DebriefPracticeScenario> practice;

  /// Set when a supervisor reads the debrief from Roleplay Logs: the cards
  /// are read-only and show the learner's feedback instead of controls.
  final SupervisorDebriefExtras? supervisor;

  /// Present only on a debrief picked for the pulse.
  final DebriefPulse? pulse;

  /// `notAvailable` only: the organisation's debriefs were stopped (FR-46),
  /// so the tab says "not available" instead of today's debrief.
  final bool stopped;

  DebriefPracticeScenario? practiceFor(int? scenarioId) =>
      scenarioId == null ? null : practice.where((p) => p.id == scenarioId).firstOrNull;

  /// Whether this answer replaces today's debrief. False for `not_available`
  /// (unless [stopped]: then the tab says "not available") and for a `ready`
  /// answer with no cards (nothing to render).
  bool get isShowable =>
      (state != LearnerDebriefState.notAvailable || stopped) && !(state == LearnerDebriefState.ready && cards == null);

  LearnerDebriefView copyWith({bool? helpful, List<DebriefMyFlag>? flags, DebriefPulse? pulse}) => LearnerDebriefView(
    state: state,
    cards: cards,
    language: language,
    steps: steps,
    progress: progress,
    corrections: corrections,
    helpful: helpful ?? this.helpful,
    flags: flags ?? this.flags,
    distress: distress,
    riskCue: riskCue,
    supportLines: supportLines,
    practice: practice,
    supervisor: supervisor,
    pulse: pulse ?? this.pulse,
    stopped: stopped,
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

  /// The pulse (PRD §9): one yes/no answer per question; answering again changes it.
  Future<void> answerPulse(String sessionId, DebriefPulseQuestion question, {required bool answer}) async {
    await _dio.put<void>(
      '/debriefs/sessions/$sessionId/pulse',
      data: {'question': question.wire, 'answer': answer, 'platform': platform},
    );
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
    await _dio.post<void>('/debriefs/sessions/$sessionId/opened', data: {'platform': platform});
  }

  /// One learner event (see [DebriefLearnerEvent]); the server keeps one per
  /// session, learner and kind. An older server answers 404/400 — callers
  /// fire and forget.
  Future<void> recordEvent(String sessionId, DebriefLearnerEvent kind) async {
    await _dio.post<void>('/debriefs/sessions/$sessionId/events', data: {'kind': kind.wire, 'platform': platform});
  }

  /// The body's `platform`. `defaultTargetPlatform`, not `dart:io`'s
  /// `Platform`, so it also answers under tests.
  static String get platform => defaultTargetPlatform == TargetPlatform.iOS ? 'ios' : 'android';

  /// Ask Ally: the debrief chat's thread, answered by the Debrief agent.
  /// Same SSE events as the scenario-session chat stream; the history is shared.
  static String replyStreamPath(String sessionId) => '/debriefs/sessions/$sessionId/reply/stream';
}

final learnerDebriefRepositoryProvider = Provider<LearnerDebriefRepository>((ref) {
  return LearnerDebriefRepository(ref.watch(apiClientProvider));
});
