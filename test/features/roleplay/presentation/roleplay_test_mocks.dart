import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/realtime/livekit_room_service.dart';
import 'package:ally_mobile_flutter/features/simulations/data/simulations_repository.dart';

class MockLiveKitRoomService extends Mock implements LiveKitRoomService {}

class MockSimulationsRepository extends Mock implements SimulationsRepository {}
