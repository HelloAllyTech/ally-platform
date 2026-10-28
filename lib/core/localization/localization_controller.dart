import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../config/app_config.dart';
import 'translations.dart';

const _supportedLanguages = ['en', 'hi', 'mr', 'ta', 'kn'];

/// Mirrors RN's `LanguageSelectorSheet.tsx`'s `LANGUAGE_OPTIONS` — same
/// codes, same order, same native-script labels.
const supportedLanguageOptions = [
  (code: 'en', label: 'English'),
  (code: 'hi', label: 'हिंदी'),
  (code: 'mr', label: 'मराठी'),
  (code: 'ta', label: 'தமிழ்'),
  (code: 'kn', label: 'ಕನ್ನಡ'),
];

const _defaultLanguage = 'en';
const _prefLanguageKey = 'ui_language';
const _prefI18nVersionKey = 'i18n_version';
const _manifestRecheckInterval = Duration(seconds: 30);

/// Matches ally-mobile (React Native)'s `DynamicI18nManifest`.
class _Manifest {
  _Manifest({required this.currentVersion, required this.languages, required this.namespaces});

  factory _Manifest.fromJson(Map<String, dynamic> json) => _Manifest(
        currentVersion: json['currentVersion'] as String,
        languages: (json['languages'] as List<dynamic>).cast<String>(),
        namespaces: (json['namespaces'] as List<dynamic>).cast<String>(),
      );

  final String currentVersion;
  final List<String> languages;
  final List<String> namespaces;
}

/// Faithful port of ally-mobile (React Native)'s two-layer i18n system
/// (`src/localization/i18n.ts` + `dynamic.ts`):
///
/// 1. Bundled locale JSON (assets/locales/*.json, real translations copied
///    verbatim from the RN app) loads first for an instant, offline-safe
///    first paint — the "zero-delay" fallback the RN code's own comment
///    describes.
/// 2. If [AppConfig.languageSelectorEnabled], a dynamic CDN sync then
///    fetches `{baseUrl}/manifest.json`, compares the cached version
///    (SharedPreferences, not AsyncStorage, but the same role), and only
///    re-fetches per-namespace JSON when the manifest's version has moved
///    — merging the result over the bundled tree and caching it for next
///    launch. Polls every 30s and on app-foreground, matching the RN
///    system's `AppState`-driven refresh exactly (here via
///    `WidgetsBindingObserver`).
///
/// What's NOT done: wiring every screen's hardcoded strings to call
/// `t()` instead — that's separate, substantial follow-up work across
/// ~30 screens. This is the real, working infrastructure for it.
class LocalizationController extends AsyncNotifier<Translations> with WidgetsBindingObserver {
  /// [dio] is injectable (rather than always a bare `Dio()`) purely so tests
  /// can supply a mock for the CDN sync calls in [_refresh] — no behavior
  /// change for real callers, which all use the `Dio()` default.
  LocalizationController({Dio? dio}) : _dio = dio ?? Dio();

  final Dio _dio;
  String _language = _defaultLanguage;
  Timer? _pollTimer;
  Future<void>? _refreshInFlight;

  /// `version/language` of the dynamic resource merged into [state], so a
  /// poll that finds nothing new doesn't rebuild every translated widget.
  String? _appliedResourceKey;

  /// The currently-applied UI language code — for Profile Settings' real
  /// "Language" field (RN's `i18nInstance.resolvedLanguage`), distinct from
  /// `preferences_repository.dart`'s default *simulation* language.
  String get currentLanguage => _language;

  @override
  Future<Translations> build() async {
    final prefs = await SharedPreferences.getInstance();
    _language = prefs.getString(_prefLanguageKey) ?? _defaultLanguage;

    var translations = await _loadBundled(_language);

    // Apply whatever dynamic resource was cached from a previous launch,
    // if any, before kicking off a fresh network check — same ordering as
    // the RN code: cached-first for instant paint, refresh after.
    final cachedVersion = prefs.getString(_prefI18nVersionKey);
    if (cachedVersion != null) {
      final cached = await _readCachedResource(prefs, cachedVersion, _language);
      if (cached != null) {
        translations = translations.mergedWith(cached);
        _appliedResourceKey = '$cachedVersion/$_language';
      }
    }

    if (AppConfig.languageSelectorEnabled) {
      WidgetsBinding.instance.addObserver(this);
      ref.onDispose(() {
        WidgetsBinding.instance.removeObserver(this);
        _pollTimer?.cancel();
      });
      _pollTimer = Timer.periodic(_manifestRecheckInterval, (_) => refresh());
      // Fire-and-forget: don't block first paint on a network round trip.
      unawaited(refresh());
    }

    return translations;
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) refresh();
  }

  Future<void> changeLanguage(String languageCode) async {
    if (!_supportedLanguages.contains(languageCode)) return;
    _language = languageCode;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_prefLanguageKey, languageCode);

    state = AsyncData(await _loadBundled(languageCode));
    _appliedResourceKey = null;
    if (AppConfig.languageSelectorEnabled) await refresh();
  }

  /// Idempotent — concurrent callers (polling timer, app-resume, an
  /// explicit language change) share one in-flight request rather than
  /// racing, same reasoning as the RN code's `refreshInFlight` guard.
  Future<void> refresh() {
    return _refreshInFlight ??= _refresh().whenComplete(() => _refreshInFlight = null);
  }

  Future<void> _refresh() async {
    final baseUrl = AppConfig.i18nBaseUrl.replaceAll(RegExp(r'/+$'), '');
    if (baseUrl.isEmpty) return;

    try {
      final manifestResponse = await _dio.get<Map<String, dynamic>>('$baseUrl/manifest.json');
      final manifest = _Manifest.fromJson(manifestResponse.data!);
      final language = manifest.languages.contains(_language) ? _language : _defaultLanguage;

      final prefs = await SharedPreferences.getInstance();
      final cachedVersion = prefs.getString(_prefI18nVersionKey);
      // RN `refresh`: reuse the cache only if it holds THIS language's
      // resource for the current version — after a language switch the
      // version matches but the new language was never fetched.
      final cachedResource = cachedVersion == manifest.currentVersion
          ? await _readCachedResource(prefs, manifest.currentVersion, language)
          : null;
      if (cachedResource != null) {
        await _apply(manifest.currentVersion, language, cachedResource);
        return;
      }

      final resource = <String, dynamic>{};
      for (final namespace in manifest.namespaces) {
        final response = await _dio.get<Map<String, dynamic>>(
          '$baseUrl/${manifest.currentVersion}/$language/$namespace.json',
        );
        resource[namespace] = response.data;
      }

      await _apply(manifest.currentVersion, language, resource);
      await _writeCachedResource(prefs, manifest.currentVersion, language, resource);
    } catch (_) {
      // Network error — RN applies whatever is cached for the current
      // language; the static bundle is the final fallback.
      try {
        final prefs = await SharedPreferences.getInstance();
        final version = prefs.getString(_prefI18nVersionKey);
        if (version == null) return;
        final cached = await _readCachedResource(prefs, version, _language);
        if (cached != null) await _apply(version, _language, cached);
      } catch (_) {}
    }
  }

  Future<void> _apply(String version, String language, Map<String, dynamic> resource) async {
    final key = '$version/$language';
    if (_appliedResourceKey == key) return;
    state = AsyncData((await _loadBundled(language)).mergedWith(resource));
    _appliedResourceKey = key;
  }

  /// The bundled locale file over the English one — RN's i18next
  /// `fallbackLng: 'en'`: a key a language file lacks shows English, not
  /// the raw key.
  Future<Translations> _loadBundled(String language) async {
    final english = Translations(await _loadBundledAsset(_defaultLanguage), language: language);
    if (language == _defaultLanguage) return english;
    return english.mergedWith(await _loadBundledAsset(language));
  }

  Future<Map<String, dynamic>> _loadBundledAsset(String language) async {
    final raw = await rootBundle.loadString('assets/locales/$language.json');
    return jsonDecode(raw) as Map<String, dynamic>;
  }

  String _cacheKey(String version, String language) => 'i18n_resource_${version}_$language';

  Future<Map<String, dynamic>?> _readCachedResource(
    SharedPreferences prefs,
    String version,
    String language,
  ) async {
    final raw = prefs.getString(_cacheKey(version, language));
    if (raw == null) return null;
    try {
      return jsonDecode(raw) as Map<String, dynamic>;
    } catch (_) {
      return null;
    }
  }

  Future<void> _writeCachedResource(
    SharedPreferences prefs,
    String version,
    String language,
    Map<String, dynamic> resource,
  ) async {
    await prefs.setString(_prefI18nVersionKey, version);
    await prefs.setString(_cacheKey(version, language), jsonEncode(resource));
  }
}

final localizationControllerProvider =
    AsyncNotifierProvider<LocalizationController, Translations>(LocalizationController.new);
