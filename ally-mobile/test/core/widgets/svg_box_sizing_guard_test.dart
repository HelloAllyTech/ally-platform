import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// vector_graphics (under flutter_svg) ignores `width` when `height` is
/// also given: it recomputes the width from the SVG's aspect ratio, so a
/// 14x10 eye asked for at 16x16 draws 22 wide and spills out of its box.
/// react-native-svg fits the graphic inside the box instead, which is what
/// RN screens were designed against. So a call that passes both must use
/// an asset whose aspect ratio matches the box; anything else goes in a
/// sized `SizedBox` with the `SvgPicture` unsized inside it.
void main() {
  test('no SvgPicture is given a width and height that differ from its aspect ratio', () {
    final call = RegExp(r'SvgPicture\.(asset|network|string)\(');
    final offenders = <String>[];

    for (final file in Directory('lib').listSync(recursive: true).whereType<File>()) {
      if (!file.path.endsWith('.dart')) continue;
      final source = file.readAsStringSync();
      for (final match in call.allMatches(source)) {
        var depth = 1;
        var end = match.end;
        while (depth > 0 && end < source.length) {
          final ch = source[end];
          if (ch == '(') depth++;
          if (ch == ')') depth--;
          end++;
        }
        final args = _topLevelArgs(source.substring(match.end, end - 1));
        String? named(String name) {
          for (final arg in args) {
            final m = RegExp('^\\s*$name\\s*:\\s*(.+?)\\s*\$', dotAll: true).firstMatch(arg);
            if (m != null) return m.group(1);
          }
          return null;
        }

        final widthArg = named('width');
        final heightArg = named('height');
        if (widthArg == null || heightArg == null) continue;
        final width = double.tryParse(widthArg);
        final height = double.tryParse(heightArg);

        final line = '\n'.allMatches(source.substring(0, match.start)).length + 1;
        final where = '${file.path}:$line';
        final asset = RegExp(r"^\s*'(assets/[^']+\.svg)'\s*$").firstMatch(args.first)?.group(1);
        if (asset == null || width == null || height == null) {
          offenders.add('$where (non-literal asset or size)');
          continue;
        }
        final viewBox = RegExp(r'viewBox="([\d.\s-]+)"').firstMatch(File(asset).readAsStringSync());
        if (viewBox == null) continue;
        final box = viewBox.group(1)!.trim().split(RegExp(r'\s+')).map(double.parse).toList();
        final svgAspect = box[2] / box[3];
        final boxAspect = width / height;
        if ((svgAspect - boxAspect).abs() > 0.05) offenders.add('$where $asset');
      }
    }

    expect(offenders, isEmpty, reason: 'Wrap these in SizedBox(width, height) instead:\n${offenders.join('\n')}');
  });
}

/// Splits a call's argument list on its top-level commas only, so a
/// `width:` inside e.g. a `placeholderBuilder`'s own SizedBox isn't counted.
List<String> _topLevelArgs(String args) {
  final out = <String>[];
  var depth = 0;
  final current = StringBuffer();
  for (final ch in args.split('')) {
    if ('([{'.contains(ch)) depth++;
    if (')]}'.contains(ch)) depth--;
    if (ch == ',' && depth == 0) {
      out.add(current.toString());
      current.clear();
    } else {
      current.write(ch);
    }
  }
  if (current.toString().trim().isNotEmpty) out.add(current.toString());
  return out;
}
