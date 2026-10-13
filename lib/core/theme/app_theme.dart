import 'package:flutter/material.dart';

/// Seeded from the real brand primary in ally-mobile (React Native)'s
/// `src/theme/designSystem/colors.ts` (`blue[500]`, `#0957d0`) so this isn't
/// a generic Material placeholder. The full design-system token set (light/
/// dark variants, typography scale, spacing) is a deliberate follow-up, not
/// done here — porting it accurately needs its own pass against that file
/// rather than being guessed alongside the networking/auth foundation.
class AppTheme {
  AppTheme._();

  static const Color primary = Color(0xFF0957D0);

  static ThemeData get light => ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(seedColor: primary),
      );
}
