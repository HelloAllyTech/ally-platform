import 'dart:async';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';

/// `Image.network` that decodes the image at the size it is drawn at
/// instead of the source's full resolution.
///
/// Avatars, logos and card covers come from S3 at whatever size was
/// uploaded (often 1000px+ photos) but are drawn at 24-200pt; a plain
/// `Image.network` decodes and keeps the full bitmap in the image cache
/// (a 2000x2000 photo is ~16MB of RGBA) for a 36pt avatar. This decodes it
/// so it still covers [width] x [height] logical pixels at the device pixel
/// ratio — the most any `BoxFit` draws of it — keeping the aspect ratio,
/// so what is drawn is pixel-for-pixel what `Image.network` drew. Images
/// already smaller than that are left alone (never upscaled).
///
/// When [width]/[height] are not given (or infinite), the size comes from
/// the incoming constraints via a [LayoutBuilder]; pass explicit sizes
/// inside intrinsic-sizing parents (`IntrinsicHeight`), which a
/// [LayoutBuilder] cannot answer.
class SizedNetworkImage extends StatelessWidget {
  const SizedNetworkImage(
    this.url, {
    super.key,
    this.width,
    this.height,
    this.fit,
    this.alignment = Alignment.center,
    this.errorBuilder,
    this.loadingBuilder,
    this.frameBuilder,
    this.semanticLabel,
  });

  final String url;
  final double? width;
  final double? height;
  final BoxFit? fit;
  final AlignmentGeometry alignment;
  final ImageErrorWidgetBuilder? errorBuilder;
  final ImageLoadingBuilder? loadingBuilder;
  final ImageFrameBuilder? frameBuilder;
  final String? semanticLabel;

  static bool _finite(double? v) => v != null && v.isFinite && v > 0;

  Widget _image(BuildContext context, double? decodeWidth, double? decodeHeight) {
    final dpr = MediaQuery.maybeDevicePixelRatioOf(context) ?? 1;
    return Image(
      image: decodeSizedImage(
        NetworkImage(url),
        width: _finite(decodeWidth) ? (decodeWidth! * dpr).ceil() : null,
        height: _finite(decodeHeight) ? (decodeHeight! * dpr).ceil() : null,
      ),
      width: width,
      height: height,
      fit: fit,
      alignment: alignment,
      errorBuilder: errorBuilder,
      loadingBuilder: loadingBuilder,
      frameBuilder: frameBuilder,
      semanticLabel: semanticLabel,
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_finite(width) && _finite(height)) return _image(context, width, height);
    return LayoutBuilder(
      builder: (context, constraints) => _image(
        context,
        _finite(width) ? width : (constraints.hasBoundedWidth ? constraints.maxWidth : null),
        _finite(height) ? height : (constraints.hasBoundedHeight ? constraints.maxHeight : null),
      ),
    );
  }
}

/// Wraps [provider] so it decodes at the smallest size that still covers
/// [width] x [height] physical pixels with the aspect ratio kept (either
/// may be null: then only the other one bounds it). Returns [provider]
/// unchanged when neither is given.
ImageProvider decodeSizedImage(ImageProvider provider, {int? width, int? height}) {
  if (width == null && height == null) return provider;
  return _CoverResizeImage(provider, width: width, height: height);
}

/// Like [ResizeImage] with a "cover" policy, which [ResizeImagePolicy]
/// lacks: `exact` distorts the aspect ratio and `fit` decodes too small
/// for a `BoxFit.cover` box with a differently-shaped image.
class _CoverResizeImage extends ImageProvider<_CoverResizeKey> {
  const _CoverResizeImage(this.imageProvider, {this.width, this.height});

  final ImageProvider imageProvider;
  final int? width;
  final int? height;

  @override
  Future<_CoverResizeKey> obtainKey(ImageConfiguration configuration) {
    // Same synchronous-when-possible dance as ResizeImage.obtainKey, so a
    // cached image still shows on the first frame.
    Completer<_CoverResizeKey>? completer;
    SynchronousFuture<_CoverResizeKey>? result;
    imageProvider.obtainKey(configuration).then((Object key) {
      final resizeKey = _CoverResizeKey(key, width, height);
      if (completer == null) {
        result = SynchronousFuture<_CoverResizeKey>(resizeKey);
      } else {
        completer.complete(resizeKey);
      }
    });
    if (result != null) return result!;
    completer = Completer<_CoverResizeKey>();
    return completer.future;
  }

  @override
  ImageStreamCompleter loadImage(_CoverResizeKey key, ImageDecoderCallback decode) {
    Future<ui.Codec> decodeCover(ui.ImmutableBuffer buffer, {ui.TargetImageSizeCallback? getTargetSize}) {
      return decode(
        buffer,
        getTargetSize: (intrinsicWidth, intrinsicHeight) {
          final scale = math.max(
            width == null ? 0.0 : width! / intrinsicWidth,
            height == null ? 0.0 : height! / intrinsicHeight,
          );
          if (scale >= 1 || scale <= 0) return const ui.TargetImageSize();
          return ui.TargetImageSize(
            width: (intrinsicWidth * scale).ceil(),
            height: (intrinsicHeight * scale).ceil(),
          );
        },
      );
    }

    // ignore: invalid_use_of_protected_member
    return imageProvider.loadImage(key.providerKey, decodeCover);
  }
}

@immutable
class _CoverResizeKey {
  const _CoverResizeKey(this.providerKey, this.width, this.height);

  final Object providerKey;
  final int? width;
  final int? height;

  @override
  bool operator ==(Object other) =>
      other is _CoverResizeKey && other.providerKey == providerKey && other.width == width && other.height == height;

  @override
  int get hashCode => Object.hash(providerKey, width, height);
}
