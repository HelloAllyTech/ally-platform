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
  });

  factory DebriefWorkOnThis.fromJson(Map<String, dynamic> json) => DebriefWorkOnThis(
    skill: _str(json['skill']),
    turnIndex: _int(json['turn_index']),
    quote: _str(json['quote']),
    lead: _str(json['lead']),
    why: _str(json['why']),
    trySaying: _str(json['try_saying']),
  );

  final String skill;
  final int turnIndex;
  final String quote;
  final String lead;
  final String why;
  final String trySaying;
}

class DebriefPractiseNext {
  const DebriefPractiseNext({required this.skill, required this.reason});

  final String skill;
  final String reason;
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
          ? DebriefPractiseNext(skill: _str(practise['skill']), reason: _str(practise['reason']))
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

/// The Ally team's answer to a flag: the card stays (with why) or is taken out.
class DebriefCorrection {
  const DebriefCorrection({required this.section, required this.removed, this.note});

  factory DebriefCorrection.fromJson(Map<String, dynamic> json) => DebriefCorrection(
    section: _str(json['section']),
    removed: json['outcome'] == 'removed',
    note: _optStr(json['note']),
  );

  final String section;
  final bool removed;
  final String? note;
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
  final String status;
  final DateTime? canUndoUntil;

  bool canUndoAt(DateTime now) => canUndoUntil != null && canUndoUntil!.isAfter(now);
}

class LearnerDebriefView {
  const LearnerDebriefView({
    required this.state,
    this.cards,
    this.language,
    this.steps = const [],
    this.corrections = const [],
    this.helpful,
    this.flags = const [],
  });

  factory LearnerDebriefView.fromJson(Map<String, dynamic> json) {
    final cards = json['cards'];
    final feedback = json['feedback'];
    final helpful = feedback is Map<String, dynamic> ? feedback['helpful'] : null;
    return LearnerDebriefView(
      state: LearnerDebriefState.parse(json['state']),
      cards: cards is Map<String, dynamic> ? DebriefCardsData.fromJson(cards) : null,
      language: _optStr(json['language']),
      steps: json['steps'] is List ? (json['steps'] as List).whereType<String>().toList() : const [],
      corrections: _maps(json['corrections']).map(DebriefCorrection.fromJson).toList(),
      helpful: helpful is bool ? helpful : null,
      flags: feedback is Map<String, dynamic>
          ? _maps(feedback['flags']).map(DebriefMyFlag.fromJson).toList()
          : const [],
    );
  }

  final LearnerDebriefState state;
  final DebriefCardsData? cards;
  final String? language;
  final List<String> steps;
  final List<DebriefCorrection> corrections;
  final bool? helpful;
  final List<DebriefMyFlag> flags;

  /// Whether this answer replaces today's debrief. False for `not_available`
  /// and for a `ready` answer with no cards (nothing to render).
  bool get isShowable =>
      state != LearnerDebriefState.notAvailable && !(state == LearnerDebriefState.ready && cards == null);

  LearnerDebriefView copyWith({bool? helpful, List<DebriefMyFlag>? flags}) => LearnerDebriefView(
    state: state,
    cards: cards,
    language: language,
    steps: steps,
    corrections: corrections,
    helpful: helpful ?? this.helpful,
    flags: flags ?? this.flags,
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
}

final learnerDebriefRepositoryProvider = Provider<LearnerDebriefRepository>((ref) {
  return LearnerDebriefRepository(ref.watch(apiClientProvider));
});
