import 'package:flutter/material.dart';

import '../../../core/theme/app_fonts.dart';
import '../data/call_log_repository.dart';

/// Direct port of ally-mobile (React Native)'s `src/screens/CallLog/
/// components/Tag/Tag.tsx` + `TAG_COLORS` — a small pill colored by the
/// tag's 1-5 positivity rating (red → orange → neutral gray → light green →
/// dark green), shown on each real-call log row.
class CallTagChip extends StatelessWidget {
  const CallTagChip({super.key, required this.tag});

  final CallTag tag;

  static const _colors = {
    1: (bg: Color(0x80FEE1E1), text: Color(0xFFC62828)),
    2: (bg: Color(0x80FFE8D5), text: Color(0xFFF55A00)),
    3: (bg: Color(0x80EBEBEB), text: Color(0xFF424242)),
    4: (bg: Color(0x80D7F4DC), text: Color(0xFF388E3C)),
    5: (bg: Color(0x80B9EFC8), text: Color(0xFF1B5E20)),
  };

  @override
  Widget build(BuildContext context) {
    final (:bg, :text) = _colors[tag.positivityRating] ?? _colors[3]!;
    return Container(
      height: 20,
      margin: const EdgeInsets.only(right: 2, top: 2, bottom: 2),
      padding: const EdgeInsets.symmetric(horizontal: 8),
      alignment: Alignment.center,
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(10)),
      child: Text(
        tag.tag,
        style: TextStyle(
          fontFamily: AppFonts.ibmPlexSerifRegular,
          fontSize: 10,
          color: text,
        ),
      ),
    );
  }
}
