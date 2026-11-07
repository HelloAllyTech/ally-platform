import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

/// Lays the test out on the iPhone the RN screenshots come from: 402x874pt,
/// which is 374x814 logical once RnScale divides by RN's ms() factor. The
/// default 800x600 test view is shorter than any phone, so `@vs`-scaled
/// sheets and buttons cover content there that has room on a device.
void usePhoneViewport(WidgetTester tester) {
  tester.view.physicalSize = const Size(374 * 3, 814 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
}
