import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../localization/translate_ref.dart';
import '../theme/app_colors.dart';
import '../theme/app_fonts.dart';
import '../theme/rn_scale.dart';
import 'force_update.dart';

/// Puts RN's blocking [ForceUpdateModal] over the whole app while
/// [forceUpdateProvider] says this build is below the minimum supported
/// version.
///
/// RN renders the modal on Splash and holds Splash's post-login routing and
/// login sheet back while it's up; the check resolves well before Splash's
/// 200-frame intro animation ends, so in practice an outdated build never
/// gets past it. Flutter has no intro animation to wait out for a signed-in
/// user, so instead of holding the launch on a network call this covers
/// whatever route is showing, and swallows every touch beneath it: the
/// same outcome (the only way forward is the store) without a slower start.
class ForceUpdateGate extends ConsumerWidget {
  const ForceUpdateGate({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isUpdateRequired = ref.watch(forceUpdateProvider).value?.isUpdateRequired ?? false;
    return Stack(
      fit: StackFit.expand,
      children: [
        child,
        if (isUpdateRequired) const ForceUpdateModal(),
      ],
    );
  }
}

/// Port of RN `components/ForceUpdateModal/ForceUpdateModal.tsx`: a 50%
/// black overlay with a white card ("Update **Alert!**", the alert
/// illustration, the description and an "Update Now" button that opens the
/// store). There is no close: it blocks until the app is updated.
class ForceUpdateModal extends ConsumerWidget {
  const ForceUpdateModal({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final size = RnSize.of(context);
    return Material(
      type: MaterialType.transparency,
      // styles.overlay: absolute fill, blackTransparent50, centred.
      child: Container(
        color: AppColors.blackTransparent50,
        alignment: Alignment.center,
        child: LayoutBuilder(
          builder: (context, constraints) => Container(
            // styles.modalContainer: width 80%, min 280, max 320,
            // marginTop 100, padding 24, radius 14, black 0.25 shadow.
            width: (constraints.maxWidth * 0.8).clamp(280.0, 320.0),
            margin: const EdgeInsets.only(top: 100),
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(14),
              boxShadow: const [
                BoxShadow(color: Color(0x40000000), offset: Offset(0, 4), blurRadius: 8),
              ],
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                // styles.title with the nested styles.titleBold span.
                Padding(
                  padding: const EdgeInsets.only(bottom: 4),
                  child: Text.rich(
                    TextSpan(
                      text: ref.t('forceUpdate.title'),
                      style: const TextStyle(
                        fontFamily: AppFonts.ibmPlexSerifRegular,
                        fontSize: 20,
                        color: AppColors.darkGray12,
                      ),
                      children: [
                        TextSpan(
                          text: ref.t('forceUpdate.titleBold'),
                          style: const TextStyle(fontFamily: AppFonts.ibmPlexSerifMedium),
                        ),
                      ],
                    ),
                    textAlign: TextAlign.center,
                  ),
                ),
                // styles.iconContainer; the icon is given an unscaled 125x125.
                Padding(
                  padding: const EdgeInsets.only(bottom: 14),
                  child: SizedBox(
                    width: size.raw(125),
                    height: size.raw(125),
                    child: SvgPicture.asset(
                      'assets/icons/forceUpdateAlert.svg',
                    ),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Text(
                    ref.t('forceUpdate.description'),
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontFamily: AppFonts.ibmPlexSerifRegular,
                      fontSize: 13,
                      height: 22 / 13,
                      color: AppColors.darkGray2,
                    ),
                  ),
                ),
                _UpdateButton(label: ref.t('forceUpdate.updateButton'), onPressed: openAppStore),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// RN `Button` (primary, md) with ForceUpdateModal's `updateButton` /
/// `updateButtonText` overrides: 150 wide, 8/20 padding, brightBlue, Roboto.
class _UpdateButton extends StatefulWidget {
  const _UpdateButton({required this.label, required this.onPressed});

  final String label;
  final VoidCallback onPressed;

  @override
  State<_UpdateButton> createState() => _UpdateButtonState();
}

class _UpdateButtonState extends State<_UpdateButton> {
  bool _pressed = false;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTapDown: (_) => setState(() => _pressed = true),
      onTapUp: (_) => setState(() => _pressed = false),
      onTapCancel: () => setState(() => _pressed = false),
      onTap: widget.onPressed,
      // TouchableOpacity activeOpacity 0.8.
      child: Opacity(
        opacity: _pressed ? 0.8 : 1,
        child: Container(
          width: 150,
          constraints: BoxConstraints(minHeight: RnSize.of(context).vs(44)),
          padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 20),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: AppColors.brightBlue,
            borderRadius: BorderRadius.circular(999),
          ),
          child: Text(
            widget.label,
            textAlign: TextAlign.center,
            // typography.body.medium + ROBOTO.REGULAR, white.
            style: const TextStyle(
              fontFamily: AppFonts.robotoRegular,
              fontSize: 14,
              height: 22 / 14,
              letterSpacing: 0.2,
              color: Colors.white,
            ),
          ),
        ),
      ),
    );
  }
}
