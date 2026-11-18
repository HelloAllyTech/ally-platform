import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/core/widgets/review_type_chip.dart';
import 'package:ally_mobile_flutter/features/reviews/presentation/simulation_details_card.dart';

import '../../support/pump_app.dart';

void main() {
  testWidgets('a cover video plays in RN VideoPreview instead of the image', (tester) async {
    await pumpApp(
      tester,
      const SingleChildScrollView(
        child: SimulationDetailsCard(
          typeLabel: 'Simulation',
          reviewType: ReviewType.simulation,
          title: 'Help Sandeep',
          coverImageUrl: 'https://cdn.example.com/cover.png',
          coverVideoUrl: 'https://cdn.example.com/cover.mp4',
          descriptionText: 'A scenario',
        ),
      ),
    );
    await tester.pump();
    expect(find.byKey(const Key('scenario-video-preview')), findsOneWidget);
  });

  testWidgets('no video: the cover image', (tester) async {
    await pumpApp(
      tester,
      const SingleChildScrollView(
        child: SimulationDetailsCard(
          typeLabel: 'Simulation',
          reviewType: ReviewType.simulation,
          title: 'Help Sandeep',
          coverImageUrl: 'https://cdn.example.com/cover.png',
        ),
      ),
    );
    await tester.pump();
    expect(find.byKey(const Key('scenario-video-preview')), findsNothing);
  });
}
