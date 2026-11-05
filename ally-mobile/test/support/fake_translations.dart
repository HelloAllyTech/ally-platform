import 'dart:convert';
import 'dart:io';

import 'package:flutter_riverpod/misc.dart' show Override;

import 'package:ally_mobile_flutter/core/localization/localization_controller.dart';
import 'package:ally_mobile_flutter/core/localization/translations.dart';

/// Real `localizationControllerProvider` resolves through SharedPreferences
/// + `rootBundle.loadString` — real async I/O that `pumpApp`'s
/// `tester.runAsync` dance resolves reliably for the *first* widget pumped
/// in a test file, but which was found (while writing the simulations
/// feature's tests) to stall forever — not just slowly — on any later
/// `pumpApp` call in the same file. Root cause not fully pinned down (looks
/// like a `rootBundle`/zone interaction specific to a `AsyncNotifier` whose
/// `build()` starts inside `pumpWidget`'s zone rather than inside
/// `runAsync`'s), but it reproduces with a minimal repro outside any of
/// this feature's own code, so it isn't specific to these screens.
///
/// Sidestepping it entirely: load the same bundled `en.json` content a
/// widget would normally see, but via a plain synchronous `dart:io` file
/// read (test code runs on the real Dart VM, not inside the asset-bundle
/// sandbox), and override the provider with a controller whose `build()`
/// already has the data in hand — no SharedPreferences, no `rootBundle`,
/// no real I/O, so a plain `pumpAndSettle()` resolves it every time
/// regardless of how many widgets a test file pumps.
Translations loadRealTranslations() {
  final raw = File('assets/locales/en.json').readAsStringSync();
  return Translations(jsonDecode(raw) as Map<String, dynamic>);
}

class _FixedLocalizationController extends LocalizationController {
  _FixedLocalizationController(this._translations);

  final Translations _translations;

  @override
  Future<Translations> build() async => _translations;
}

/// Pass this in `pumpApp`'s `overrides:` for any widget test that renders
/// translated (`ref.t`/`ref.tr`) text and needs it to resolve reliably.
Override fixedTranslationsOverride() => localizationControllerProvider
    .overrideWith(() => _FixedLocalizationController(loadRealTranslations()));
