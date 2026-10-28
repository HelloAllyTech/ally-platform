import 'package:flutter/widgets.dart';

/// RN's `ms()` (react-native-size-matters' `moderateScale` with its default
/// factor 0.5 against a 350pt guideline width) as a single multiplier:
/// `size + (size * short / 350 - size) * 0.5` simplifies to
/// `size * (0.5 + short / 700)` — linear in `size`, so one factor per
/// device. 1.0 on a 350pt-wide phone, 1.0743 on a 402pt iPhone 17 Pro.
double rnScaleFactor(double shortestSide) => 0.5 + shortestSide / 700;

/// Scales the whole app by [rnScaleFactor], the way RN's `ScaledSheet`
/// scales every `@ms` value (2,225 of the RN app's ~2,660 numeric style
/// values; the rest are mostly fixed icon and divider sizes).
///
/// The Flutter screens are ported with RN's raw, pre-`ms` numbers, so
/// without this every font, padding and radius rendered ~7% smaller than
/// the real app on current iPhones. Scaling once here keeps those literals
/// matching RN's source 1:1 instead of wrapping thousands of them.
///
/// The child is laid out in a smaller logical viewport (`size / factor`)
/// and painted back up to full size; [FittedBox] applies the same transform
/// to hit-testing, and the [MediaQuery] insets are divided so safe areas
/// and the keyboard still line up after scaling.
class RnScale extends StatelessWidget {
  const RnScale({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final media = MediaQuery.of(context);
    final factor = rnScaleFactor(media.size.shortestSide);
    if ((factor - 1).abs() < 0.005) return child;

    final logicalSize = media.size / factor;
    return MediaQuery(
      data: media.copyWith(
        size: logicalSize,
        padding: media.padding / factor,
        viewPadding: media.viewPadding / factor,
        viewInsets: media.viewInsets / factor,
        systemGestureInsets: media.systemGestureInsets / factor,
        devicePixelRatio: media.devicePixelRatio * factor,
      ),
      child: FittedBox(
        fit: BoxFit.fill,
        alignment: Alignment.topLeft,
        child: SizedBox.fromSize(size: logicalSize, child: child),
      ),
    );
  }
}
