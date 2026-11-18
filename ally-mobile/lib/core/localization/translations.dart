/// Thin wrapper over a nested translation JSON tree (the same shape as
/// ally-mobile (React Native)'s `src/localization/locales/*.json`), with a
/// dot-path lookup and `{{var}}` interpolation — deliberately the same
/// `{{var}}` syntax the real backend's dynamic i18n CDN actually serves
/// (see `localization_controller.dart`), not converted to any other
/// template format, since this reads directly from that wire format with
/// no intermediate build step.
class Translations {
  Translations(this._tree, {this.language = 'en'});

  final Map<String, dynamic> _tree;

  /// The language [_tree] is in — picks the i18next plural category (see
  /// [_pluralCategory]).
  final String language;

  /// [key] is a dot path, e.g. `progress.hero.level`. Plural keys
  /// (`foo_one`/`foo_other`, i18next's v4 JSON convention) resolve like
  /// i18next's `t('foo', {count})`: when `foo` itself doesn't exist and
  /// [params] has a numeric `count`, `foo_<category>` is used (then
  /// `foo_other`). Callers that already pick the suffix themselves keep
  /// working unchanged.
  /// Returns [key] itself when nothing matches, the same "better a visible
  /// miss than a blank screen" fallback i18next itself uses.
  String t(String key, [Map<String, Object?>? params]) {
    var node = raw(key);
    final count = params?['count'];
    if (node is! String && count is num) {
      node = raw('${key}_${_pluralCategory(count)}') ?? raw('${key}_other');
    }
    if (node is! String) return key;

    if (params == null || params.isEmpty) return node;
    var result = node;
    for (final entry in params.entries) {
      result = result.replaceAll('{{${entry.key}}}', '${entry.value}');
    }
    return result;
  }

  /// Same dot-path lookup as [t], but returns whatever JSON node is there
  /// unconverted — for the handful of real translation entries that are
  /// structured content (e.g. `terms.sections`, an array of `{heading,
  /// content}` objects) rather than a single interpolatable string. Returns
  /// `null` when the path doesn't resolve, since there's no sensible
  /// "visible miss" fallback for a non-string shape the way [t] has one.
  dynamic raw(String key) {
    dynamic node = _tree;
    for (final segment in key.split('.')) {
      if (node is Map<String, dynamic> && node.containsKey(segment)) {
        node = node[segment];
      } else {
        return null;
      }
    }
    return node;
  }

  /// Merges [other] on top of this tree (deep merge, [other] wins on
  /// conflicts) — mirrors i18next's `addResourceBundle(..., deep: true,
  /// overwrite: true)` call in the RN app's dynamic sync.
  Translations mergedWith(Map<String, dynamic> other) {
    return Translations(_deepMerge(_tree, other), language: language);
  }

  /// `Intl.PluralRules(language).select(count)` for the categories the
  /// locale files use (`one`/`other`). CLDR: Hindi and Kannada treat 0 as
  /// `one` too (`i = 0 or n = 1`); English, Marathi and Tamil only 1.
  String _pluralCategory(num count) {
    final isOne = switch (language) {
      'hi' || 'kn' => count == 0 || count == 1 || (count > 0 && count < 1),
      _ => count == 1,
    };
    return isOne ? 'one' : 'other';
  }

  static Map<String, dynamic> _deepMerge(
    Map<String, dynamic> base,
    Map<String, dynamic> overlay,
  ) {
    final result = Map<String, dynamic>.from(base);
    for (final entry in overlay.entries) {
      final existing = result[entry.key];
      if (existing is Map<String, dynamic> && entry.value is Map<String, dynamic>) {
        result[entry.key] = _deepMerge(existing, entry.value as Map<String, dynamic>);
      } else {
        result[entry.key] = entry.value;
      }
    }
    return result;
  }
}
