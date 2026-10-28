import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../../../../core/localization/translate_ref.dart';
import '../../../../core/theme/app_colors.dart';
import '../../data/start_item_payload.dart';
import '../course_bottom_sheet.dart';
import '../course_styles.dart';

/// RN `EMBED_TIMEOUT_MS`: a WebView that never finishes loading (a framing
/// block or a stalled bot challenge) hands off to the OS browser after this.
const externalResourceEmbedTimeout = Duration(seconds: 8);

Future<void> _openExternally(String url) async {
  final uri = Uri.tryParse(url);
  if (uri == null) return;
  try {
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  } catch (_) {}
}

/// Port of RN `components/players/ExternalResourceSheet.tsx` — a curated
/// article resource loaded in an in-app WebView inside an 85% bottom sheet,
/// with an "Open externally" action in the header. A load error or HTTP
/// error, or no load within [externalResourceEmbedTimeout], opens the OS
/// browser and closes the sheet.
class ExternalResourceSheet extends ConsumerStatefulWidget {
  const ExternalResourceSheet({super.key, required this.resource});

  final ArticleResource resource;

  static Future<void> show(BuildContext context, ArticleResource resource) => showCourseBottomSheet<void>(
    context,
    heightFraction: 0.85,
    builder: (_) => ExternalResourceSheet(resource: resource),
  );

  @override
  ConsumerState<ExternalResourceSheet> createState() => _ExternalResourceSheetState();
}

class _ExternalResourceSheetState extends ConsumerState<ExternalResourceSheet> {
  WebViewController? _controller;
  Timer? _timer;
  bool _loading = true;
  bool _closed = false;

  @override
  void initState() {
    super.initState();
    _timer = Timer(externalResourceEmbedTimeout, _fallBack);
    try {
      _controller = WebViewController()
        ..setJavaScriptMode(JavaScriptMode.unrestricted)
        ..setNavigationDelegate(
          NavigationDelegate(
            onPageFinished: (_) => _handleLoadEnd(),
            onWebResourceError: (error) {
              if (error.isForMainFrame ?? true) _fallBack();
            },
            onHttpError: (error) {
              if (error.request?.uri.toString() == widget.resource.url ||
                  error.request == null) {
                _fallBack();
              }
            },
          ),
        )
        ..loadRequest(Uri.parse(widget.resource.url));
    } catch (_) {
      // No WebView platform (widget tests): keep the spinner until the timeout.
      _controller = null;
    }
  }

  void _handleLoadEnd() {
    _timer?.cancel();
    if (mounted) setState(() => _loading = false);
  }

  void _fallBack() {
    _timer?.cancel();
    if (_closed) return;
    _closed = true;
    _openExternally(widget.resource.url);
    if (mounted) Navigator.of(context).maybePop();
  }

  @override
  void dispose() {
    _closed = true;
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final controller = _controller;
    return Column(
      children: [
        // styles.header: row, space-between, gap 12, paddingHorizontal 16,
        // paddingBottom 12@mvs.
        Padding(
          padding: const EdgeInsets.only(left: 16, right: 16, bottom: 12),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  widget.resource.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: CourseText.serifMedium(CourseType.bodyLarge, AppColors.highEmphasis, weight: FontWeight.w500),
                ),
              ),
              const SizedBox(width: 12),
              GestureDetector(
                key: const Key('external-resource-open-externally'),
                behavior: HitTestBehavior.opaque,
                onTap: () => _openExternally(widget.resource.url),
                child: Text(
                  ref.t('courses.article.openExternally'),
                  style: CourseText.roboto(CourseType.bodySmall, AppColors.primary, weight: FontWeight.w500),
                ),
              ),
            ],
          ),
        ),
        Expanded(
          child: Stack(
            children: [
              if (controller != null) Positioned.fill(child: WebViewWidget(controller: controller)),
              if (_loading)
                const Positioned.fill(
                  child: ColoredBox(
                    key: Key('external-resource-loading'),
                    color: Colors.white,
                    child: Center(child: CircularProgressIndicator(color: AppColors.primary)),
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}
