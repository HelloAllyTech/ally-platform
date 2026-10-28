import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:livekit_client/livekit_client.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/realtime/livekit_room_service.dart';
import 'package:ally_mobile_flutter/features/simulations/data/simulations_repository.dart';

/// `dataMessages`/`activeSpeakers` are implemented concretely (not left to
/// mocktail's `noSuchMethod` stubbing) so every existing roleplay test —
/// none of which care about data-channel messages or speaking state — keeps
/// working unchanged: a mocktail-stubbed getter throws `MissingStubError`
/// the moment it's read without an explicit `when(...)`, which
/// `RoleplayVoiceScreen._connect()` now does unconditionally for both.
/// Tests that DO care call [emitData]/[emitActiveSpeakers].
class MockLiveKitRoomService extends Mock implements LiveKitRoomService {
  final _dataController = StreamController<LiveKitDataMessage>.broadcast();
  final _activeSpeakersController = StreamController<List<Participant>>.broadcast();

  @override
  Stream<LiveKitDataMessage> get dataMessages => _dataController.stream;

  @override
  Stream<List<Participant>> get activeSpeakers => _activeSpeakersController.stream;

  void emitData(Map<String, dynamic> json, {String? topic}) {
    _dataController.add(LiveKitDataMessage(topic: topic, raw: const [], json: json));
  }

  void emitActiveSpeakers(List<Participant> speakers) {
    _activeSpeakersController.add(speakers);
  }
}

class MockSimulationsRepository extends Mock implements SimulationsRepository {}

/// The live-call controls start collapsed behind a chevron, as RN's
/// `CollapsibleButtonGroup` does; open them before tapping a control.
Future<void> expandRoleplayControls(WidgetTester tester) async {
  final toggle = find.byKey(const ValueKey('simulation-control-buttons-toggle'));
  if (toggle.evaluate().isEmpty) return;
  if (find.byKey(const ValueKey('simulation-control-buttons')).evaluate().isNotEmpty &&
      find.descendant(
        of: find.byKey(const ValueKey('simulation-control-buttons')),
        matching: find.byType(Text),
      ).evaluate().isNotEmpty) {
    return;
  }
  await tester.tap(toggle);
  await tester.pump();
}
