import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/sized_network_image.dart';

/// RN `components/NetworkImage` (BadgePopup, AchievementsScreen): badge art
/// is usually an SVG URL, so `.svg` URLs go through flutter_svg (an
/// `Image.network` draws them blank) and anything else as a bitmap. A small
/// primary-blue spinner shows while it loads; a failed load leaves RN's
/// grey[100] placeholder box.
///
/// Pass [width]/[height] inside intrinsic-sizing parents; without them it
/// fills its constraints.
class BadgeNetworkImage extends StatelessWidget {
  const BadgeNetworkImage({super.key, required this.url, this.width, this.height});

  final String url;
  final double? width;
  final double? height;

  static const _spinner = Center(
    child: SizedBox(
      width: 20,
      height: 20,
      child: CircularProgressIndicator.adaptive(
        strokeWidth: 2,
        valueColor: AlwaysStoppedAnimation(AppColors.primary),
      ),
    ),
  );

  /// RN `isSvg`: the URL's extension, case-insensitively.
  @visibleForTesting
  static bool isSvgUrl(String url) => url.toLowerCase().endsWith('.svg');

  Widget _error() => Container(width: width, height: height, color: AppColors.grey100);

  @override
  Widget build(BuildContext context) {
    final w = width ?? double.infinity;
    final h = height ?? double.infinity;
    if (isSvgUrl(url)) {
      return SvgPicture.network(
        url,
        fit: BoxFit.contain,
        width: w,
        height: h,
        placeholderBuilder: (_) => SizedBox(width: width, height: height, child: _spinner),
        errorBuilder: (_, _, _) => _error(),
      );
    }
    return SizedNetworkImage(
      url,
      fit: BoxFit.contain,
      width: w,
      height: h,
      loadingBuilder: (context, child, progress) =>
          progress == null ? child : Stack(alignment: Alignment.center, children: [child, _spinner]),
      errorBuilder: (_, _, _) => _error(),
    );
  }
}
