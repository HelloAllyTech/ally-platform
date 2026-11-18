import 'package:flutter/foundation.dart' show listEquals;

/// The built-in summary form's values and its saved baseline — a port of
/// ally-mobile (React Native)'s `useCallSummaryForm` + `summarySlice`
/// (`formData` / `savedFormData`) and `formDataTransformer.ts`'s
/// `getChangedSummaryFieldKeys`.
///
/// Dirty means "differs from the baseline", not "was touched", which is what
/// makes RN's two guarantees hold:
/// - an edit typed while a save is in flight stays dirty, because
///   [markSaved] only advances the baseline to the values that were sent;
/// - a reseed from a refetch of the same chat (an async AI fill, a
///   regeneration landing, our own save's refetch) replaces the baseline but
///   keeps every unsaved edit on top of it.
class SummaryFormState {
  final Map<String, dynamic> _values = {};
  final Map<String, dynamic> _saved = {};
  Object? _seededChatId;

  /// Read-only view of the current form values, keyed by field key.
  Map<String, dynamic> get values => Map.unmodifiable(_values);

  dynamic operator [](String key) => _values[key];

  dynamic savedValue(String key) => _saved[key];

  /// RN `useCallSummaryForm`'s seed effect, run on every new server copy.
  /// A different [chatId] starts clean; the same one keeps unsaved edits.
  void seed(Map<String, dynamic> serverFields, {required Object chatId}) {
    final isNewSession = _seededChatId != chatId;
    final unsaved = isNewSession ? const <String, dynamic>{} : {for (final key in changedKeys) key: _values[key]};
    _values
      ..clear()
      ..addAll(serverFields)
      ..addAll(unsaved);
    _saved
      ..clear()
      ..addAll(serverFields);
    _seededChatId = chatId;
  }

  void set(String key, dynamic value) => _values[key] = value;

  /// Merges values that are already persisted (e.g. voice dictation saved
  /// them itself) into both the form and the baseline.
  void setSaved(Map<String, dynamic> values) {
    _values.addAll(values);
    _saved.addAll(values);
  }

  /// RN `handleSectionFieldsReset`: back to the last-saved values.
  void reset(Iterable<String> keys) {
    for (final key in keys) {
      _values[key] = _saved[key];
    }
  }

  /// RN `getChangedSummaryFieldKeys(savedFormData, formData)`.
  List<String> get changedKeys => [
        for (final key in {..._values.keys, ..._saved.keys})
          if (!_same(_values[key], _saved[key])) key,
      ];

  bool get hasChanges => changedKeys.isNotEmpty;

  /// The changed fields' current values — what a save sends. Taken before
  /// the request so [markSaved] can advance the baseline to exactly these.
  Map<String, dynamic> pendingPatch() => {for (final key in changedKeys) key: _values[key]};

  /// RN `markFormDataSaved(<only what was written>)`.
  void markSaved(Map<String, dynamic> sent) => _saved.addAll(sent);

  static bool _same(dynamic a, dynamic b) {
    if (a is List && b is List) return listEquals(a, b);
    return a == b;
  }
}
