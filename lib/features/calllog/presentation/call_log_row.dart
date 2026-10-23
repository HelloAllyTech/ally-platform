import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/widgets/status_badge.dart';
import '../data/call_log_repository.dart';
import 'call_tag_chip.dart';

/// Port of ally-mobile (React Native)'s `CallLogItem` — a collapsible row
/// with two independent tap targets, confirmed from source: tapping the
/// chevron toggles expand/collapse locally; tapping anywhere else on the
/// row fires [onTap] (navigation to the detail screen) — not the same
/// gesture. Collapsed, it shows the title, [StatusBadge], a decorative eye
/// icon (RN's own markup has no `onPress` on it either), and a date line.
/// Expanded, it also shows duration/score and any tags.
///
/// Not ported: the call-source/channel label and session "mode" line
/// (RN's `getLogSourceLabelConfig(provider)`/`formatSessionMode`) — the
/// backend fields they need (`details.callInfo.provider`/`.mode`) aren't
/// modeled on this app's `CallLogItem`/`SimulationLogItem` yet.
class CallLogRow extends StatefulWidget {
  const CallLogRow({
    super.key,
    required this.title,
    required this.status,
    required this.dateLine,
    required this.durationText,
    this.scoreText,
    this.tags = const [],
    required this.onTap,
    this.enabled = true,
  });

  final String title;
  final ChatSummaryStatus status;
  final String dateLine;
  final String? durationText;
  final String? scoreText;
  final List<CallTag> tags;
  final VoidCallback? onTap;

  /// Mirrors RN's `disabled` prop — gates both the row's own tap-to-navigate
  /// and the eye icon's visibility (it's omitted entirely when disabled,
  /// not just grayed out). The expand/collapse chevron stays tappable
  /// either way, same as the real component.
  final bool enabled;

  @override
  State<CallLogRow> createState() => _CallLogRowState();
}

class _CallLogRowState extends State<CallLogRow> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: widget.enabled ? widget.onTap : null,
      child: Container(
        color: _expanded ? AppColors.lightGray : null,
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                InkWell(
                  key: const ValueKey('call-log-row-toggle'),
                  customBorder: const CircleBorder(),
                  onTap: () => setState(() => _expanded = !_expanded),
                  child: Padding(
                    padding: const EdgeInsets.all(4),
                    child: SvgPicture.asset(
                      _expanded
                          ? 'assets/icons/doubleBottomArrow.svg'
                          : 'assets/icons/doubleRightArrow.svg',
                      width: 16,
                      height: 16,
                    ),
                  ),
                ),
                Expanded(
                  child: Row(
                    children: [
                      Flexible(
                        child: Text(
                          widget.title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontFamily: AppFonts.ibmPlexSerifMedium,
                            color: AppColors.highEmphasis,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      StatusBadge(status: widget.status),
                      if (widget.enabled) ...[
                        const SizedBox(width: 8),
                        SvgPicture.asset(
                          key: const ValueKey('call-log-row-eye'),
                          'assets/icons/eye.svg',
                          width: 16,
                          height: 16,
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
            Padding(
              padding: const EdgeInsets.only(left: 30),
              child: Text(
                widget.dateLine,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontFamily: AppFonts.ibmPlexSerifRegular,
                  fontSize: 12,
                  color: AppColors.mediumEmphasis,
                ),
              ),
            ),
            if (_expanded) ...[
              const SizedBox(height: 6),
              Padding(
                padding: const EdgeInsets.only(left: 4),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (widget.durationText != null)
                      Text(
                        [
                          widget.durationText,
                          if (widget.scoreText != null) widget.scoreText,
                        ].join(' • '),
                        style: const TextStyle(
                          fontFamily: AppFonts.ibmPlexSerifRegular,
                          fontSize: 12,
                          color: AppColors.mediumEmphasis,
                        ),
                      ),
                    if (widget.tags.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Wrap(
                          children: [for (final tag in widget.tags) CallTagChip(tag: tag)],
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
