import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

/// RTK Query's `keepUnusedDataFor` for an `autoDispose` provider: keeps the
/// value for [duration] after the last listener goes away, then lets it be
/// disposed. Reopening within that window shows the cached value at once
/// (as a never-disposed provider did); after it, the value is dropped
/// instead of living for the rest of the session.
///
/// RN's RTK Query default is 60s, which is what per-id screen data
/// (`getCallSummary`, `getLearnTrackDetail`, ...) used there.
void cacheFor(Ref ref, [Duration duration = const Duration(seconds: 60)]) {
  final link = ref.keepAlive();
  Timer? timer;
  ref.onCancel(() => timer = Timer(duration, link.close));
  ref.onResume(() => timer?.cancel());
  ref.onDispose(() => timer?.cancel());
}
