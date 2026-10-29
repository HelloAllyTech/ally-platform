import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../account/presentation/profile_settings_screen.dart' show RnCustomSwitch;

/// Port of RN `CallSummaryScreen/components/Header/Header.tsx`: an 80pt row
/// (capped at 80% of the width) with the back arrow and the
/// "Session *Summary*" / `#name` block, and on the right the "Share" label +
/// `CustomSwitch` and the three-dots menu button.
class CallSummaryHeader extends StatelessWidget {
  const CallSummaryHeader({
    super.key,
    required this.title,
    required this.subtitle,
    required this.summaryName,
    required this.onBackPress,
    required this.onMenuPress,
    required this.shareLabel,
    required this.showShareSwitch,
    required this.isSharedForReview,
    required this.onShareToggle,
  });

  final String title;
  final String subtitle;
  final String? summaryName;
  final VoidCallback onBackPress;

  /// Null hides the button (no chat to act on yet).
  final VoidCallback? onMenuPress;
  final String shareLabel;
  final bool showShareSwitch;
  final bool isSharedForReview;
  final ValueChanged<bool>? onShareToggle;

  // `expandedSummaryTitle`: REPLAY_PRO.HEADLINE + typography.headline.tiny.
  static const _titleStyle = TextStyle(
    fontFamily: AppFonts.replayProHeadline,
    fontSize: 18,
    height: 24 / 18,
    letterSpacing: 0,
    color: AppColors.highEmphasis,
  );

  // `headerSubtitle`: REPLAY_PRO.BOLD_ITALIC, italic, weight 500.
  static const _subtitleStyle = TextStyle(
    fontFamily: AppFonts.replayProBoldItalic,
    fontStyle: FontStyle.italic,
    fontWeight: FontWeight.w500,
  );

  // `summaryNameText`: IBM_PLEX_SERIF.MEDIUM + typography.body.medium.
  static const _nameStyle = TextStyle(
    fontFamily: AppFonts.ibmPlexSerifMedium,
    fontSize: 14,
    height: 22 / 14,
    letterSpacing: 0.2,
    color: AppColors.mediumEmphasis,
  );

  // `shareSwitchLabel`: typography.body.small + IBM_PLEX_SERIF.REGULAR.
  static const _shareLabelStyle = TextStyle(
    fontFamily: AppFonts.ibmPlexSerifRegular,
    fontSize: 12,
    height: 16 / 12,
    letterSpacing: 0.2,
    color: AppColors.lowEmphasis,
  );

  @override
  Widget build(BuildContext context) {
    final name = summaryName;
    return ColoredBox(
      color: Colors.white,
      child: LayoutBuilder(
        builder: (context, constraints) => Row(
          children: [
            // `expandedSummaryTitleContainer`: height 80, maxWidth 80%.
            ConstrainedBox(
              constraints: BoxConstraints(maxWidth: constraints.maxWidth * 0.8),
              child: SizedBox(
                height: 80,
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Semantics(
                      button: true,
                      label: MaterialLocalizations.of(context).backButtonTooltip,
                      child: GestureDetector(
                        key: const Key('call-summary-back'),
                        behavior: HitTestBehavior.opaque,
                        onTap: onBackPress,
                        // `backButtonExpanded`: paddingLeft 4, paddingRight 12.
                        child: Padding(
                          padding: const EdgeInsets.only(left: 4, right: 12),
                          child: SvgPicture.asset(
                            'assets/icons/leftArrowIcon.svg',
                            colorFilter: const ColorFilter.mode(Colors.black, BlendMode.srcIn),
                          ),
                        ),
                      ),
                    ),
                    Flexible(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text.rich(
                            TextSpan(
                              text: '$title ',
                              style: _titleStyle,
                              children: [TextSpan(text: subtitle, style: _subtitleStyle)],
                            ),
                          ),
                          // `nameContainer`: marginTop 3 on iOS.
                          Padding(
                            padding: const EdgeInsets.only(top: 3, right: 10),
                            child: Text(
                              (name != null && name.isNotEmpty) ? '#$name' : '-',
                              key: const Key('call-summary-header-name'),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: _nameStyle,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const Spacer(),
            // `headerRightContainer`: row, gap 16.
            if (showShareSwitch && onShareToggle != null) ...[
              // `shareSwitchContainer`: row, gap 8.
              Text(shareLabel, style: _shareLabelStyle),
              const SizedBox(width: 8),
              RnCustomSwitch(
                key: const Key('call-summary-share-switch'),
                value: isSharedForReview,
                onToggle: onShareToggle!,
              ),
              const SizedBox(width: 16),
            ],
            if (onMenuPress != null)
              // `moreOptionsContainer`: paddingRight 20; DEFAULT_HIT_SLOP 10.
              GestureDetector(
                key: const Key('call-summary-menu'),
                behavior: HitTestBehavior.opaque,
                onTap: onMenuPress,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(10, 10, 20, 10),
                  child: SvgPicture.asset('assets/icons/threeDots.svg'),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// Port of the react-native-tab-view `TabBar` CallSummaryScreen renders
/// (`renderTabBar` + `styles.tabBar*`): equal-width tabs (`flex: 1`,
/// paddingHorizontal 10, the library's 10pt vertical padding and 48pt
/// min height), IBM Plex Serif Medium body.small labels (weight 400) in
/// primary / lowEmphasis, a 2pt primary indicator that tracks the swipe,
/// and the library's hairline bottom shadow. Drives the enclosing
/// [DefaultTabController].
class CallSummaryTabBar extends StatelessWidget {
  const CallSummaryTabBar({super.key, required this.labels});

  final List<String> labels;

  static const _labelStyle = TextStyle(
    fontFamily: AppFonts.ibmPlexSerifMedium,
    fontSize: 12,
    height: 16 / 12,
    letterSpacing: 0.2,
    fontWeight: FontWeight.w400,
  );

  @override
  Widget build(BuildContext context) {
    final controller = DefaultTabController.of(context);
    final animation = controller.animation!;
    return Container(
      // RN tab-view default: shadowOpacity 0.1, radius/offset hairline.
      decoration: const BoxDecoration(
        color: Colors.white,
        boxShadow: [BoxShadow(color: Color(0x1A000000), offset: Offset(0, 0.33), blurRadius: 0.33)],
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final tabWidth = constraints.maxWidth / labels.length;
          return AnimatedBuilder(
            animation: animation,
            builder: (context, _) {
              final position = animation.value;
              return Stack(
                children: [
                  Row(
                    children: [
                      for (var i = 0; i < labels.length; i++)
                        Expanded(
                          child: Semantics(
                            button: true,
                            selected: controller.index == i,
                            child: GestureDetector(
                              key: Key('call-summary-tab-$i'),
                              behavior: HitTestBehavior.opaque,
                              onTap: () => controller.animateTo(i),
                              child: ConstrainedBox(
                                constraints: const BoxConstraints(minHeight: 48),
                                child: Padding(
                                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
                                  child: Center(
                                    // Library label margin: 4.
                                    child: Padding(
                                      padding: const EdgeInsets.all(4),
                                      child: Text(
                                        labels[i],
                                        textAlign: TextAlign.center,
                                        style: _labelStyle.copyWith(
                                          color: Color.lerp(
                                            AppColors.lowEmphasis,
                                            AppColors.primary,
                                            (1 - (position - i).abs()).clamp(0.0, 1.0),
                                          ),
                                        ),
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          ),
                        ),
                    ],
                  ),
                  Positioned(
                    left: position * tabWidth,
                    bottom: 0,
                    width: tabWidth,
                    height: 2,
                    child: const ColoredBox(color: AppColors.primary),
                  ),
                ],
              );
            },
          );
        },
      ),
    );
  }
}
