import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Guards the bundled locale files (`assets/locales/*.json`) against the two
/// ways translations regressed before: a key added to `en.json` but not to
/// the other languages (Indic users then see English), and a `ref.t('…')`
/// in `lib/` whose key doesn't exist at all (everyone sees the raw key).
///
/// Translating a new key: copy RN's `src/localization/locales/<lang>.json`
/// value when RN has the key; otherwise translate it and list it in
/// `docs/i18n-machine-translated.md` for native-speaker review.
const _otherLanguages = ['hi', 'kn', 'mr', 'ta'];

Map<String, String> _flatten(Map<String, dynamic> tree, [String prefix = '']) {
  final out = <String, String>{};
  tree.forEach((key, value) {
    final path = prefix.isEmpty ? key : '$prefix.$key';
    if (value is Map<String, dynamic>) {
      out.addAll(_flatten(value, path));
    } else {
      out[path] = value is String ? value : jsonEncode(value);
    }
  });
  return out;
}

Map<String, String> _locale(String language) =>
    _flatten(jsonDecode(File('assets/locales/$language.json').readAsStringSync()) as Map<String, dynamic>);

Set<String> _placeholders(String value) =>
    RegExp(r'\{\{\s*(\w+)\s*\}\}').allMatches(value).map((m) => m.group(1)!).toSet();

/// Every literal key passed to `.t(…)` / `.tr(…)` in `lib/`, including both
/// branches of a `cond ? 'a.key' : 'b.key'` argument. Keys built at runtime
/// (`'foo.$bar'`, a variable) are skipped.
Map<String, String> _literalKeyRefs() {
  const literal = r"'([A-Za-z][\w]*(?:\.[\w]+)+)'";
  final direct = RegExp(r'\.tr?\(\s*' + literal + r'\s*[,)]');
  final ternary = RegExp(r"\.tr?\(\s*[^'(),;]*\?\s*" + literal + r'\s*:\s*' + literal);
  final refs = <String, String>{};
  for (final file in Directory('lib').listSync(recursive: true).whereType<File>()) {
    if (!file.path.endsWith('.dart')) continue;
    final source = file.readAsLinesSync().where((line) => !line.trimLeft().startsWith('//')).join('\n');
    for (final m in direct.allMatches(source)) {
      refs.putIfAbsent(m.group(1)!, () => file.path);
    }
    for (final m in ternary.allMatches(source)) {
      refs.putIfAbsent(m.group(1)!, () => file.path);
      refs.putIfAbsent(m.group(2)!, () => file.path);
    }
  }
  return refs;
}

void main() {
  final en = _locale('en');

  for (final language in _otherLanguages) {
    test('$language.json has every en.json key', () {
      final other = _locale(language);
      final missing = en.keys.where((k) => !other.containsKey(k)).toList();
      expect(missing, isEmpty, reason: 'missing from $language.json');
    });

    test('$language.json keeps the same {{placeholders}} as en.json', () {
      final other = _locale(language);
      final mismatched = [
        for (final entry in en.entries)
          if (other.containsKey(entry.key) && !_setEquals(_placeholders(entry.value), _placeholders(other[entry.key]!)))
            entry.key,
      ];
      expect(mismatched, isEmpty, reason: 'placeholder mismatch in $language.json');
    });
  }

  test("every literal ref.t('…') key in lib/ exists in en.json", () {
    final refs = _literalKeyRefs();
    // Sanity check that the scan itself still finds the call sites.
    expect(refs.length, greaterThan(300));
    final missing = [
      for (final entry in refs.entries)
        // A plural base key (`foo` for `foo_one`/`foo_other`) resolves from
        // the `count` param (see `Translations.t`).
        if (!en.containsKey(entry.key) && !(en.containsKey('${entry.key}_one') && en.containsKey('${entry.key}_other')))
          '${entry.key} (${entry.value})',
    ];
    expect(missing, isEmpty, reason: 'keys referenced in lib/ but missing from en.json');
  });
}

bool _setEquals(Set<String> a, Set<String> b) => a.length == b.length && a.containsAll(b);
