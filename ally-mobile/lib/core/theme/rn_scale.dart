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

/// RN's other size-matters helpers, in this app's units under [RnScale].
///
/// [RnScale] reproduces `ms()` (`@ms`), which covers most RN styles. These
/// cover the rest: `s()` / `vs()` (`@s` / `@vs`) scale fully with screen
/// width / height (350 x 680pt guideline), `mvs()` (`@mvs`) is half of
/// `vs()`'s change, and [raw] is for RN numbers written with no scaling at
/// all (fixed icon sizes, hairlines), which [RnScale] would otherwise grow.
///
/// Because [RnScale] lays the app out in a viewport shrunk by its factor,
/// `s` and `vs` reduce to a fraction of the logical screen size (the
/// factor cancels); `mvs` and [raw] need the factor itself, recovered from
/// the devicePixelRatio [RnScale] multiplied by it (1 without [RnScale]).
class RnSize {
  const RnSize._(this._size, this._factor);

  factory RnSize.of(BuildContext context) => RnSize._(
        MediaQuery.sizeOf(context),
        MediaQuery.devicePixelRatioOf(context) / View.of(context).devicePixelRatio,
      );

  final Size _size;
  final double _factor;

  double s(double size) => size * _size.shortestSide / 350;
  double vs(double size) => size * _size.longestSide / 680;
  double mvs(double size) => 0.5 * raw(size) + 0.5 * vs(size);
  double raw(double size) => size / _factor;
}
