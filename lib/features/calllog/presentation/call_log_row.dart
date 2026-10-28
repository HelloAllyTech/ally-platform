import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart' show OverflowBoxFit;
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
/// gesture. Collapsed, it shows the title with the [StatusBadge] and a
/// decorative eye icon (RN's own markup has no `onPress` on it either)
/// pushed to the right, and a date line. Expanded, the header turns grey
/// and the row also shows the channel label, duration/score/mode and any
/// tags.
class CallLogRow extends StatefulWidget {
  const CallLogRow({
    super.key,
    required this.title,
    required this.status,
    required this.dateLine,
    required this.durationText,
    this.scoreText,
    this.modeText,
    this.sourceLabel,
    this.sourceColor,
    this.tags = const [],
    required this.onTap,
    this.enabled = true,
    this.isSimulation = false,
    this.noAudioLabel = 'No Audio',
    this.expanded,
    this.onToggle,
  });

  /// RN `expanded` / `onToggle` (CallLogScreen's `expandedIdx`): when
  /// [onToggle] is set the parent owns the state, so only one row is open
  /// at a time; otherwise the row keeps its own.
  final bool? expanded;
  final VoidCallback? onToggle;

  final String title;
  final ChatSummaryStatus status;
  final String dateLine;
  final String? durationText;
  final String? scoreText;

  /// `Mode: Scribe` — RN appends it to the duration line when
  /// `details.callInfo.mode` is set.
  final String? modeText;

  /// RN's `getLogSourceLabelConfig(provider)` label/colour, shown before the
  /// duration line followed by a `|` separator.
  final String? sourceLabel;
  final Color? sourceColor;
  final List<CallTag> tags;
  final VoidCallback? onTap;

  /// Mirrors RN's `disabled` prop — gates both the row's own tap-to-navigate
  /// and the eye icon's visibility (it's omitted entirely when disabled,
  /// not just grayed out). The expand/collapse chevron stays tappable
  /// either way, same as the real component.
  final bool enabled;

  /// Role-play rows use RN's `styles.scenarioName` for the second line
  /// (`{scenario title} • {date}`) instead of `styles.logDate`.
  final bool isSimulation;

  /// `t('calls.status.noAudio')`, passed through to [StatusBadge].
  final String noAudioLabel;

  @override
  State<CallLogRow> createState() => _CallLogRowState();
}

class _CallLogRowState extends State<CallLogRow> {
  bool _localExpanded = false;

  bool get _expanded => widget.onToggle != null ? (widget.expanded ?? false) : _localExpanded;

  // styles.logId: IBM_PLEX_SERIF.MEDIUM + typography.label.large.
  static const _titleStyle = TextStyle(
    fontFamily: AppFonts.ibmPlexSerifMedium,
    fontSize: 14,
    height: 22 / 14,
    letterSpacing: 0.2,
    color: AppColors.highEmphasis,
  );

  // styles.logDate / styles.duration / styles.sourceText:
  // IBM_PLEX_SERIF.REGULAR + typography.label.medium.
  static const _labelMediumStyle = TextStyle(
    fontFamily: AppFonts.ibmPlexSerifRegular,
    fontSize: 12,
    height: 20 / 12,
    letterSpacing: 0.2,
    color: AppColors.mediumEmphasis,
  );

  // styles.scenarioName: IBM_PLEX_SERIF.REGULAR, fontSize 12, darkCharcoal.
  static const _scenarioNameStyle = TextStyle(
    fontFamily: AppFonts.ibmPlexSerifRegular,
    fontSize: 12,
    color: AppColors.darkCharcoal,
  );

  @override
  Widget build(BuildContext context) {
    final durationParts = [
      ?widget.durationText,
      ?widget.scoreText,
      ?widget.modeText,
    ];

    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: widget.enabled ? widget.onTap : null,
      child: Container(
        // styles.logItemContainer
        margin: const EdgeInsets.symmetric(horizontal: 14),
        padding: const EdgeInsets.all(10),
        decoration: const BoxDecoration(
          color: Colors.white,
          border: Border(bottom: BorderSide(color: AppColors.lightGray2)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // styles.logHeader (+ expandedLogHeader): marginTop -2 and
            // marginBottom 2 just draw it 2pt higher.
            Transform.translate(
              offset: const Offset(0, -2),
              child: Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: _expanded ? AppColors.lightGray : null,
                  borderRadius: BorderRadius.circular(12),
                ),
                // styles.leftContainer: flex 1, marginRight 10.
                child: Padding(
                  padding: const EdgeInsets.only(right: 10),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _buildTitleRow(),
                      Padding(
                        padding: const EdgeInsets.only(left: 30, right: 3),
                        child: Text(
                          widget.dateLine,
                          maxLines: widget.isSimulation ? 1 : null,
                          overflow: widget.isSimulation ? TextOverflow.ellipsis : null,
                          style: widget.isSimulation ? _scenarioNameStyle : _labelMediumStyle,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            if (_expanded)
              // styles.logDetails
              Padding(
                padding: const EdgeInsets.only(top: 6, left: 4),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Row(
                        children: [
                          if (widget.sourceLabel != null) ...[
                            Text(
                              widget.sourceLabel!,
                              style: _labelMediumStyle.copyWith(color: widget.sourceColor),
                            ),
                            const Padding(
                              padding: EdgeInsets.symmetric(horizontal: 4),
                              child: Text('|', style: TextStyle(color: AppColors.strokePrimary)),
                            ),
                          ],
                          if (durationParts.isNotEmpty)
                            Flexible(
                              child: Text(durationParts.join(' • '), style: _labelMediumStyle),
                            ),
                        ],
                      ),
                    ),
                    if (widget.tags.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: [for (final tag in widget.tags) CallTagChip(tag: tag)],
                        ),
                      ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }

  /// RN's `logHeaderContent`: the 24pt chevron box, then `styles.titleRow` —
  /// `width: '95%'` of the header content plus `marginRight: 20`, with the
  /// title on the left and the status pill + eye pushed to the right
  /// (`justifyContent: 'space-between'`). Because the 95% is of the whole
  /// content width and the chevron sits beside it, RN's row runs slightly
  /// past the left container's right edge; [OverflowBox] reproduces that
  /// instead of squeezing it.
  Widget _buildTitleRow() {
    return LayoutBuilder(
      builder: (context, constraints) {
        final titleRowWidth = constraints.maxWidth * 0.95;
        return OverflowBox(
          alignment: Alignment.centerLeft,
          minWidth: 0,
          maxWidth: 28 + titleRowWidth,
          fit: OverflowBoxFit.deferToChild,
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              GestureDetector(
                key: const ValueKey('call-log-row-toggle'),
                behavior: HitTestBehavior.opaque,
                onTap: widget.onToggle ?? () => setState(() => _localExpanded = !_localExpanded),
                child: Container(
                  width: 24,
                  height: 24,
                  margin: const EdgeInsets.only(right: 4),
                  alignment: Alignment.center,
                  child: SizedBox(
                    width: 16,
                    height: 16,
                    child: SvgPicture.asset(
                      _expanded ? 'assets/icons/doubleBottomArrow.svg' : 'assets/icons/doubleRightArrow.svg',
                    ),
                  ),
                ),
              ),
              SizedBox(
                width: titleRowWidth,
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Flexible(
                      child: Padding(
                        padding: const EdgeInsets.only(right: 3),
                        child: Text(
                          widget.title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: _titleStyle,
                        ),
                      ),
                    ),
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        StatusBadge(status: widget.status, noAudioLabel: widget.noAudioLabel),
                        if (widget.enabled)
                          Padding(
                            padding: const EdgeInsets.only(left: 10),
                            child: SizedBox(
                              width: 16,
                              height: 16,
                              child: SvgPicture.asset(
                                key: const ValueKey('call-log-row-eye'),
                                'assets/icons/eye.svg',
                              ),
                            ),
                          ),
                      ],
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
