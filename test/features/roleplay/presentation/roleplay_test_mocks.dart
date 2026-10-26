import 'dart:async';

import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/realtime/livekit_room_service.dart';
import 'package:ally_mobile_flutter/features/simulations/data/simulations_repository.dart';

/// `dataMessages` is implemented concretely (not left to mocktail's
/// `noSuchMethod` stubbing) so every existing roleplay test — none of which
/// care about data-channel messages — keeps working unchanged: a
/// mocktail-stubbed getter throws `MissingStubError` the moment it's read
/// without an explicit `when(...)`, which `RoleplayVoiceScreen._connect()`
/// now does unconditionally. Tests that DO care call [emitData].
class MockLiveKitRoomService extends Mock implements LiveKitRoomService {
  final _dataController = StreamController<LiveKitDataMessage>.broadcast();

  @override
  Stream<LiveKitDataMessage> get dataMessages => _dataController.stream;

  void emitData(Map<String, dynamic> json, {String? topic}) {
    _dataController.add(LiveKitDataMessage(topic: topic, raw: const [], json: json));
  }
}

class MockSimulationsRepository extends Mock implements SimulationsRepository {}
