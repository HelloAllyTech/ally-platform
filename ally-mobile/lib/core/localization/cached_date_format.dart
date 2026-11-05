import 'package:intl/intl.dart';

final Map<String, DateFormat> _formats = {};

/// `DateFormat(pattern)`, built once per pattern and current Intl locale
/// instead of on every list row / rebuild (each construction re-parses the
/// pattern and looks up the locale's date symbols). Keyed by the locale so
/// a later `Intl.defaultLocale` change still gets a fresh formatter, same
/// as calling the constructor each time.
DateFormat cachedDateFormat(String pattern) {
  final locale = Intl.getCurrentLocale();
  return _formats.putIfAbsent('$locale|$pattern', () => DateFormat(pattern));
}
