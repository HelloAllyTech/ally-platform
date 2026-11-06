import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:permission_handler_platform_interface/permission_handler_platform_interface.dart';

import 'package:ally_mobile_flutter/features/simulations/data/simulations_repository.dart';
import 'package:ally_mobile_flutter/features/simulations/presentation/start_simulation/start_simulation_controller.dart';

import 'package:ally_mobile_flutter/core/localization/translate_ref.dart';

import '../../../support/fake_permission_platform.dart';
import '../../../support/pump_app.dart';

class _MockRepository extends Mock implements SimulationsRepository {}

class _Starter extends ConsumerStatefulWidget {
  const _Starter();

  @override
  ConsumerState<_Starter> createState() => _StarterState();
}

class _StarterState extends ConsumerState<_Starter> {
  late final controller = StartSimulationController(ref, launch: (_, _, _) {});

  @override
  void dispose() {
    controller.dispose();
    super.dispose();
  }

  @override
  // Watching a translation (as every real start surface does) loads them.
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(ref.t('common.continue'))),
    body: TextButton(
      onPressed: () => controller.start(context, const StartSimulationParams(scenarioId: 7)),
      child: const Text('START'),
    ),
  );
}

// RN useStartSimulation asks for the microphone BEFORE creating the
// session, so a blocked/denied mic never spends a credit.
void main() {
  testWidgets('a blocked mic shows the Settings alert and never creates the session', (tester) async {
    PermissionHandlerPlatform.instance = FakePermissionHandlerPlatform({
      Permission.microphone: PermissionStatus.permanentlyDenied,
    });
    final repository = _MockRepository();
    await pumpApp(tester, const _Starter(), overrides: [simulationsRepositoryProvider.overrideWithValue(repository)]);

    await tester.tap(find.text('START'));
    await tester.pumpAndSettle();

    expect(find.byType(CupertinoAlertDialog), findsOneWidget);
    expect(find.text('Allow microphone permission'), findsOneWidget);
    expect(find.text('OK'), findsOneWidget);
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();

    verifyNever(
      () => repository.startScenarioSession(
        scenarioId: any(named: 'scenarioId'),
        scenarioPathSessionItemId: any(named: 'scenarioPathSessionItemId'),
        caseSessionItemId: any(named: 'caseSessionItemId'),
        trackItemProgressId: any(named: 'trackItemProgressId'),
        languageId: any(named: 'languageId'),
      ),
    );
  });
}
