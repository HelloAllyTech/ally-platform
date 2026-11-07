import 'package:flutter_test/flutter_test.dart';
import 'package:intl/intl.dart';

import 'package:ally_mobile_flutter/core/localization/cached_date_format.dart';

void main() {
  test('reuses one formatter per pattern and formats like a fresh DateFormat', () {
    final date = DateTime(2026, 2, 18, 11, 5);
    expect(identical(cachedDateFormat('MMM d'), cachedDateFormat('MMM d')), isTrue);
    expect(cachedDateFormat('MMM d').format(date), DateFormat('MMM d').format(date));
    expect(cachedDateFormat('h:mm a').format(date), DateFormat('h:mm a').format(date));
  });
}
