import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/widgets/level_indicator.dart';
import '../data/progress_repository.dart';

/// Direct port of ally-mobile (React Native)'s `src/components/
/// ProgressHeaderWidget/ProgressHeaderWidget.tsx` — the always-visible half
/// of the Progress feature, rendered by `TabScreenHeader` itself (not
/// passed in per screen) so it appears everywhere without every new screen
/// needing to remember to opt in.
///
/// Renders nothing at all — not a placeholder, not a spinner — until the
/// summary has actually resolved true. A widget that appears and then
/// vanishes is worse than one that arrives a moment late.
class ProgressHeaderWidget extends ConsumerWidget {
  const ProgressHeaderWidget({super.key, this.isOnProgressScreen = false});

  /// The Progress screen renders this same shared header, and a widget
  /// that navigates to the screen you're already on is a dead control
  /// sitting next to a hero that shows the same ring — set by
  /// ProgressScreen's own `TabScreenHeader` call.
  final bool isOnProgressScreen;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (isOnProgressScreen) return const SizedBox.shrink();

    final summaryAsync = ref.watch(progressSummaryProvider);
    final summary = summaryAsync.value;
    if (summary == null) return const SizedBox.shrink();

    return LevelIndicator(
      level: summary.level,
      progress: summary.progress,
      isMaxLevel: summary.isMaxLevel,
      semanticLabel: ref.t('progress.a11y.navLevel', {'level': summary.level}),
      onTap: () => context.push('/progress'),
    );
  }
}
