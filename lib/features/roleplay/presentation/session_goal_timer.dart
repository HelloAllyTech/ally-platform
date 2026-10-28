import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/theme/rn_scale.dart';

/// RN `DEFAULT_MAX_TIME_VALUE` (`constants/simulations.ts`) — what
/// `SimulationAssistantScreen` hands `SessionGoalTimer` when the scenario
/// has no `maxTimeValue`.
const defaultGoalTimerMaxTimeValue = '00:10:00';

/// RN `SessionGoalTimer.parseTimeValue`: "HH:MM:SS" → seconds, 0 when
/// absent.
int parseGoalTimeValue(String? value) {
  if (value == null || value.isEmpty) return 0;
  final parts = value.split(':').map((p) => int.tryParse(p) ?? 0).toList();
  final h = parts.isNotEmpty ? parts[0] : 0;
  final m = parts.length > 1 ? parts[1] : 0;
  final s = parts.length > 2 ? parts[2] : 0;
  return h * 3600 + m * 60 + s;
}

String _formatGoalTime(int totalSeconds) {
  String pad(int n) => n.toString().padLeft(2, '0');
  final h = totalSeconds ~/ 3600;
  final m = (totalSeconds % 3600) ~/ 60;
  final s = totalSeconds % 60;
  return h > 0 ? '${pad(h)}:${pad(m)}:${pad(s)}' : '${pad(m)}:${pad(s)}';
}

/// Port of RN `SimulationAssistantScreen/components/SessionGoalTimer`
/// (shown when the scenario has `timerMode`): a 14vs slate progress bar
/// filling blue → orange (≤5 min) → red (≤1 min), "Session Timer" + the
/// total on the left, "Time Remaining" + "x min y sec" on the right.
///
/// Driven by the screen's own pause-adjusted [elapsed] notifier (RN reads
/// the same start time and `pausedOffsetMs`, and skips ticks while paused),
/// so it freezes during a pause exactly like the session timer does.
class SessionGoalTimer extends ConsumerWidget {
  const SessionGoalTimer({
    super.key,
    required this.maxTimeValue,
    required this.elapsed,
  });

  final String maxTimeValue;
  final ValueListenable<Duration> elapsed;

  static Color _barColor(int remaining) {
    if (remaining <= 60) return const Color(0xFFEF4444);
    if (remaining <= 300) return const Color(0xFFE77625);
    return const Color(0xFF264D8E);
  }

  static Color _remainingColor(int remaining) {
    if (remaining <= 0) return const Color(0xFFCBD5E1);
    if (remaining <= 60) return const Color(0xFFEF4444);
    if (remaining <= 300) return const Color(0xFFE77625);
    return const Color(0xFF4ADE80);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final rn = RnSize.of(context);
    final maxSeconds = parseGoalTimeValue(maxTimeValue);
    const labelStyle = TextStyle(
      fontFamily: AppFonts.ibmPlexSerifRegular,
      fontSize: 10,
      fontWeight: FontWeight.w500,
      letterSpacing: 0.5,
      color: Color(0xFF94A3B8),
    );
    const valueStyle = TextStyle(
      fontFamily: AppFonts.ibmPlexSerifMedium,
      fontSize: 14,
      fontWeight: FontWeight.bold,
    );
    return ValueListenableBuilder<Duration>(
      valueListenable: elapsed,
      builder: (context, value, _) {
        final remaining = maxSeconds == 0
            ? 0
            : (maxSeconds - value.inSeconds).clamp(0, maxSeconds);
        final progress = maxSeconds > 0
            ? ((maxSeconds - remaining) / maxSeconds).clamp(0.0, 1.0)
            : 0.0;
        return Container(
          key: const ValueKey('session-goal-timer'),
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 4),
          margin: EdgeInsets.only(bottom: rn.vs(8)),
          child: Column(
            children: [
              Container(
                height: rn.vs(14),
                margin: EdgeInsets.only(bottom: rn.vs(6)),
                decoration: BoxDecoration(
                  color: const Color(0xFF94A3B8),
                  borderRadius: BorderRadius.circular(8),
                ),
                clipBehavior: Clip.antiAlias,
                alignment: Alignment.centerLeft,
                child: FractionallySizedBox(
                  widthFactor: progress,
                  heightFactor: 1,
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      color: _barColor(remaining),
                      borderRadius: BorderRadius.circular(8),
                    ),
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 4),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Flexible(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            ref.t('simulationPage.sessionTimer'),
                            style: labelStyle,
                          ),
                          SizedBox(height: rn.vs(2)),
                          Text(
                            _formatGoalTime(maxSeconds),
                            key: const ValueKey('session-goal-timer-max-time'),
                            style: valueStyle.copyWith(color: Colors.white),
                          ),
                        ],
                      ),
                    ),
                    Flexible(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          Text(
                            ref.t('simulationPage.timeRemaining'),
                            style: labelStyle,
                          ),
                          SizedBox(height: rn.vs(2)),
                          Text(
                            '${remaining ~/ 60} ${ref.t('simulationPage.min')} '
                            '${remaining % 60} ${ref.t('simulationPage.sec')}',
                            key: const ValueKey('session-goal-timer-remaining'),
                            style: valueStyle.copyWith(
                              color: _remainingColor(remaining),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}
