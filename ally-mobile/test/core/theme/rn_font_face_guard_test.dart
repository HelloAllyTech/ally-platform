import 'dart:io';

import 'package:ally_mobile_flutter/core/theme/app_fonts.dart';
import 'package:ally_mobile_flutter/features/courses/presentation/course_styles.dart';
import 'package:flutter/painting.dart';
import 'package:flutter_test/flutter_test.dart';

/// On iOS, RN (Fabric's RCTFontWithFontProperties) treats a `fontFamily` like
/// 'ReplayPro-Headline' as a font name, takes its UIKit family ("Replay Pro":
/// Headline -0.115, Bold 0.4, Bold Italic 0.4) and, when a non-regular
/// `fontWeight` is given, switches to the family member whose weight is
/// closest. So Headline at 500 renders as Replay Pro Bold and IBM Plex Serif
/// Regular at 500 as Medium, while Medium at 400 stays Medium (400 reads as
/// "no weight"). It never synthesizes a bolder face. Flutter declares each
/// file as its own family and fakes bold from w600 up instead, so a ported
/// style must name the face RN actually lands on, at a weight that doesn't
/// trigger synthetic bold.
const _faceWeights = {
  // family token -> (CoreText family, weight trait of this face)
  'replayProHeadline': ('Replay Pro', -0.115),
  'replayProBold': ('Replay Pro', 0.4),
  'ibmPlexSerifRegular': ('IBM Plex Serif', 0.0),
  'ibmPlexSerifMedium': ('IBM Plex Serif', 0.2),
  'robotoRegular': ('Roboto', 0.0),
};

// UIFontWeight values RN maps fontWeight strings to.
const _uiWeight = {
  'w100': -0.8,
  'w200': -0.6,
  'w300': -0.4,
  'w400': 0.0,
  'normal': 0.0,
  'w500': 0.23,
  'w600': 0.3,
  'w700': 0.4,
  'bold': 0.4,
  'w800': 0.56,
  'w900': 0.62,
};

String _rnFace(String token, String weight) {
  final (family, _) = _faceWeights[token]!;
  final target = _uiWeight[weight]!;
  // Fabric's RCTFontWithFontProperties: `fontWeight ?: weightOf(namedFont)`.
  // UIFontWeightRegular is 0, so 400/normal means "unspecified" and the
  // named face is kept (IBM Plex Medium at 400 stays Medium).
  if (target == 0) return token;
  String? best;
  var bestDistance = double.infinity;
  for (final MapEntry(key: candidate, value: (candidateFamily, candidateWeight)) in _faceWeights.entries) {
    if (candidateFamily != family) continue;
    final distance = (candidateWeight - target).abs();
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best!;
}

void main() {
  test('styles name the face RN resolves to on iOS, without synthetic bold', () {
    final style = RegExp(r'(TextStyle|copyWith)\(');
    final offenders = <String>[];
    for (final file in Directory('lib').listSync(recursive: true).whereType<File>()) {
      if (!file.path.endsWith('.dart')) continue;
      final source = file.readAsStringSync();
      for (final match in style.allMatches(source)) {
        var depth = 1;
        var end = match.end;
        while (depth > 0 && end < source.length) {
          if (source[end] == '(') depth++;
          if (source[end] == ')') depth--;
          end++;
        }
        final args = source.substring(match.end, end);
        final family = RegExp(r'fontFamily:\s*AppFonts\.(\w+)').firstMatch(args)?.group(1);
        final weight = RegExp(r'fontWeight:\s*FontWeight\.(\w+)').firstMatch(args)?.group(1);
        if (family == null || weight == null || !_faceWeights.containsKey(family)) continue;

        final where = '${file.path}:${'\n'.allMatches(source.substring(0, match.start)).length + 1}';
        final expected = _rnFace(family, weight);
        if (expected != family) offenders.add('$where $family $weight renders as $expected in RN');
        final fakeBold = ['w600', 'w700', 'w800', 'w900', 'bold'].contains(weight) && family != 'replayProBold';
        if (fakeBold) offenders.add('$where $family $weight is synthesized bold in Flutter; RN uses the face as is');
      }
    }
    expect(offenders, isEmpty, reason: offenders.join('\n'));
  });

  test('styles at weight 500+ name the face they render with instead of inheriting one', () {
    // An inherited family is usually DefaultTextStyle's IBM Plex Serif
    // Regular, where RN would have used a parent Text's font, Medium, or SF.
    final style = RegExp(r'(TextStyle|copyWith)\(');
    final heavy = RegExp(r'fontWeight:\s*FontWeight\.(w[5-9]00|bold)\b');
    final offenders = <String>[];
    for (final file in Directory('lib').listSync(recursive: true).whereType<File>()) {
      if (!file.path.endsWith('.dart')) continue;
      final source = file.readAsStringSync();
      for (final match in style.allMatches(source)) {
        var depth = 1;
        var end = match.end;
        while (depth > 0 && end < source.length) {
          if (source[end] == '(') depth++;
          if (source[end] == ')') depth--;
          end++;
        }
        final args = source.substring(match.end, end);
        if (!heavy.hasMatch(args) || args.contains('fontFamily')) continue;
        offenders.add('${file.path}:${'\n'.allMatches(source.substring(0, match.start)).length + 1}');
      }
    }
    expect(offenders, isEmpty, reason: offenders.join('\n'));
  });

  test('CourseText resolves IBM Plex Serif weights to the face RN lands on', () {
    const type = TextStyle(fontSize: 14);
    const color = Color(0xFF000000);
    expect(CourseText.serif(type, color).fontFamily, AppFonts.ibmPlexSerifRegular);
    expect(CourseText.serif(type, color, weight: FontWeight.w500).fontFamily, AppFonts.ibmPlexSerifMedium);
    expect(CourseText.serif(type, color, weight: FontWeight.w300).fontFamily, AppFonts.ibmPlexSerifRegular);
    expect(CourseText.serifMedium(type, color, weight: FontWeight.w400).fontFamily, AppFonts.ibmPlexSerifMedium);
    expect(CourseText.serifMedium(type, color, weight: FontWeight.w300).fontFamily, AppFonts.ibmPlexSerifRegular);
  });
}
