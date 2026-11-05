import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'localization_controller.dart';

/// Ergonomic `t()` calls for widgets, so screen code doesn't have to spell
/// out `ref.watch(localizationControllerProvider).value?.t(...) ?? key`
/// at every call site. Falls back to the raw key (same "better a visible
/// miss than a blank screen" behavior as [Translations.t] itself) while
/// the very first load is still in flight, which is at most one frame —
/// the bundled asset resolves synchronously fast enough that this never
/// visibly flashes in practice.
extension TranslateRef on WidgetRef {
  /// Use from `build()` (or anywhere else `ref.watch` is legal) — rebuilds
  /// the widget when translations change (language switch, a dynamic CDN
  /// sync landing).
  String t(String key, [Map<String, Object?>? params]) {
    return watch(localizationControllerProvider).value?.t(key, params) ?? key;
  }

  /// Use from event handlers, async callbacks, or anywhere else calling
  /// `ref.watch` would throw ("used outside of build") — same lookup via
  /// `ref.read` instead, since nothing there needs a rebuild on change.
  String tr(String key, [Map<String, Object?>? params]) {
    return read(localizationControllerProvider).value?.t(key, params) ?? key;
  }
}
