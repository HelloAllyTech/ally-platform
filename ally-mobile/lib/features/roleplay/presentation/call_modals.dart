import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/theme/rn_scale.dart';

/// The two modals ally-mobile (React Native)'s live call screens draw as
/// absolute overlays (`blackTransparent50`, z-index above the call UI):
///
/// - [CallIllustratedModal] — `components/IllustratedModal`: an X in the
///   top-right corner, "Title *Italic*", an SVG illustration, the
///   description and one full-width coloured action. Used for the role
///   play's back-press "End *Role play*" confirmation (EndSessionIcon,
///   brightRed) and the Scribe "End session" confirmation.
/// - [CallIllustratedActionModal] — `components/IllustratedActionModal`
///   (RN `EndingSoonModal`): no X, two half-width actions side by side.
///
/// The shared `lib/core/widgets/illustrated_modal.dart` isn't reused: it
/// takes PNG illustrations only and lays the X out in-flow.

/// RN `Button` label: `typography.body.medium` in the iOS system font.
const _buttonTextStyle = TextStyle(
  fontFamily: 'CupertinoSystemText',
  fontSize: 14,
  height: 22 / 14,
  letterSpacing: 0.2,
);

const _titleStyle = TextStyle(
  fontFamily: AppFonts.replayProHeadline,
  fontSize: 20,
  color: AppColors.darkGray12,
);

const _italicStyle = TextStyle(
  fontFamily: AppFonts.replayProBoldItalic,
  fontStyle: FontStyle.italic,
);

class _Overlay extends StatelessWidget {
  const _Overlay({required this.child, super.key});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    return Positioned.fill(
      child: ColoredBox(
        color: AppColors.blackTransparent50,
        child: Center(
          child: ConstrainedBox(
            constraints: BoxConstraints(minWidth: 280, maxWidth: width * 0.8),
            child: Material(
              color: Colors.white,
              borderRadius: BorderRadius.circular(12),
              child: child,
            ),
          ),
        ),
      ),
    );
  }
}

class _RnButton extends StatelessWidget {
  const _RnButton({
    super.key,
    required this.label,
    required this.onPressed,
    required this.background,
    required this.textColor,
    this.borderColor,
    this.borderRadius = 999,
    this.fontWeight,
  });

  final String label;
  final VoidCallback onPressed;
  final Color background;
  final Color textColor;
  final Color? borderColor;
  final double borderRadius;
  final FontWeight? fontWeight;

  @override
  Widget build(BuildContext context) {
    final rn = RnSize.of(context);
    final radius = BorderRadius.circular(borderRadius);
    return Material(
      color: background,
      shape: RoundedRectangleBorder(
        borderRadius: radius,
        side: borderColor == null
            ? BorderSide.none
            : BorderSide(color: borderColor!),
      ),
      child: InkWell(
        borderRadius: radius,
        onTap: onPressed,
        child: Container(
          constraints: BoxConstraints(minHeight: rn.vs(44)),
          padding: EdgeInsets.symmetric(vertical: rn.vs(10), horizontal: 20),
          alignment: Alignment.center,
          child: Text(
            label,
            textAlign: TextAlign.center,
            style: _buttonTextStyle.copyWith(
              color: textColor,
              fontWeight: fontWeight,
            ),
          ),
        ),
      ),
    );
  }
}

/// IllustratedActionModal renders `{titleMain} ` (a space before the
/// italic part); IllustratedModal renders the two back to back.
Widget _title(String main, String? italic, {bool spaced = false}) => Text.rich(
  TextSpan(
    text: italic != null && spaced ? '$main ' : main,
    children: [if (italic != null) TextSpan(text: italic, style: _italicStyle)],
  ),
  textAlign: TextAlign.center,
  style: _titleStyle,
);

/// RN `IllustratedModal`. The action fires and then closes, as RN's
/// `handleActionPress` calls `onActionPress` then `onClose`.
class CallIllustratedModal extends StatelessWidget {
  const CallIllustratedModal({
    super.key,
    required this.titleMain,
    this.titleItalic,
    required this.description,
    required this.illustrationAsset,
    required this.actionLabel,
    required this.onAction,
    required this.onClose,
    this.actionColor = AppColors.brightRed,
  });

  final String titleMain;
  final String? titleItalic;
  final String description;
  final String illustrationAsset;
  final String actionLabel;
  final VoidCallback onAction;
  final VoidCallback onClose;
  final Color actionColor;

  @override
  Widget build(BuildContext context) {
    final rn = RnSize.of(context);
    return _Overlay(
      key: const ValueKey('call-illustrated-modal'),
      child: Stack(
        children: [
          Padding(
            padding: EdgeInsets.all(rn.s(16)),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Padding(
                  padding: EdgeInsets.only(top: rn.mvs(8), bottom: rn.mvs(16)),
                  child: _title(titleMain, titleItalic),
                ),
                Padding(
                  padding: EdgeInsets.only(bottom: rn.mvs(20)),
                  child: SvgPicture.asset(illustrationAsset),
                ),
                Padding(
                  padding: EdgeInsets.only(bottom: rn.mvs(16)),
                  child: Text(
                    description,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontFamily: AppFonts.ibmPlexSerifRegular,
                      fontSize: 12,
                      height: rn.mvs(20) / 12,
                      color: AppColors.darkGray2,
                    ),
                  ),
                ),
                SizedBox(
                  width: double.infinity,
                  child: _RnButton(
                    key: const ValueKey('call-illustrated-modal-action'),
                    label: actionLabel,
                    background: actionColor,
                    textColor: Colors.white,
                    fontWeight: FontWeight.w600,
                    onPressed: () {
                      onAction();
                      onClose();
                    },
                  ),
                ),
              ],
            ),
          ),
          Positioned(
            top: 8,
            right: 8,
            width: 24,
            height: 24,
            child: GestureDetector(
              key: const ValueKey('call-illustrated-modal-close'),
              behavior: HitTestBehavior.opaque,
              onTap: onClose,
              child: Center(child: SvgPicture.asset('assets/icons/close.svg')),
            ),
          ),
        ],
      ),
    );
  }
}

/// RN `IllustratedActionModal` as `EndingSoonModal` uses it: "Time's
/// almost *up*"-style title, the hourglass, and End session (secondary,
/// white with a `lightGrayD9` border) beside Continue (azureBlue, radius 24).
class CallIllustratedActionModal extends StatelessWidget {
  const CallIllustratedActionModal({
    super.key,
    required this.titleMain,
    this.titleItalic,
    required this.description,
    required this.illustrationAsset,
    required this.secondaryLabel,
    required this.onSecondary,
    required this.primaryLabel,
    required this.onPrimary,
  });

  final String titleMain;
  final String? titleItalic;
  final String description;
  final String illustrationAsset;
  final String secondaryLabel;
  final VoidCallback onSecondary;
  final String primaryLabel;
  final VoidCallback onPrimary;

  @override
  Widget build(BuildContext context) {
    final rn = RnSize.of(context);
    return _Overlay(
      key: const ValueKey('call-illustrated-action-modal'),
      child: Padding(
        padding: EdgeInsets.all(rn.s(16)),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: EdgeInsets.only(top: rn.mvs(8), bottom: rn.mvs(16)),
              child: _title(titleMain, titleItalic, spaced: true),
            ),
            Padding(
              padding: EdgeInsets.only(bottom: rn.mvs(20)),
              child: SvgPicture.asset(illustrationAsset),
            ),
            Padding(
              padding: EdgeInsets.only(bottom: rn.mvs(16)),
              child: Text(
                description,
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontFamily: AppFonts.ibmPlexSerifRegular,
                  fontSize: 12,
                  height: rn.mvs(20) / 12,
                  color: Colors.black,
                ),
              ),
            ),
            Row(
              children: [
                Expanded(
                  child: _RnButton(
                    key: const ValueKey('call-action-modal-secondary'),
                    label: secondaryLabel,
                    background: Colors.white,
                    borderColor: AppColors.lightGrayD9,
                    textColor: AppColors.charcoalGray,
                    onPressed: onSecondary,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _RnButton(
                    key: const ValueKey('call-action-modal-primary'),
                    label: primaryLabel,
                    background: AppColors.azureBlue,
                    textColor: Colors.white,
                    borderRadius: 24,
                    onPressed: onPrimary,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
