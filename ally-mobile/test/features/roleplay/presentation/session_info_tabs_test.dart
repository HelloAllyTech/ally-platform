import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/roleplay/presentation/session_info_tabs.dart';
import 'package:ally_mobile_flutter/features/simulations/data/simulation_models.dart';

Scenario _scenario({
  String? description,
  List<String> reminders = const [],
  String? experienceMode,
  List<ChecklistItem> checklistEvents = const [],
}) => Scenario(
  id: 1,
  title: 'Test',
  description: description,
  coverImageUrl: null,
  experienceMode: experienceMode,
  checklistEvents: checklistEvents,
  reminders: reminders,
);

void main() {
  group('SessionInfoTabs.hasAnyTab', () {
    test('false when checklist/reminders/description are all absent', () {
      expect(SessionInfoTabs.hasAnyTab(_scenario()), isFalse);
    });

    test('true when only reminders are present', () {
      expect(SessionInfoTabs.hasAnyTab(_scenario(reminders: ['Ask about their day'])), isTrue);
    });

    test('true when only description is present', () {
      expect(SessionInfoTabs.hasAnyTab(_scenario(description: 'A description')), isTrue);
    });

    test('true when only checklist is present', () {
      expect(
        SessionInfoTabs.hasAnyTab(
          _scenario(
            experienceMode: 'CHECKLIST',
            checklistEvents: [ChecklistItem(id: 'a', name: 'Greet')],
          ),
        ),
        isTrue,
      );
    });
  });
}
