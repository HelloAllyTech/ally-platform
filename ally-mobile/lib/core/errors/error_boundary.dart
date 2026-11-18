import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../localization/translate_ref.dart';
import '../theme/app_colors.dart';
import '../theme/app_fonts.dart';
import '../theme/rn_scale.dart';

/// The render error the app is currently showing [ErrorFallback] for, or
/// null. Set by [renderErrorWidgetBuilder], cleared by "Try again".
final ValueNotifier<FlutterErrorDetails?> renderErrorNotifier = ValueNotifier(null);

/// Installed as `ErrorWidget.builder` (see `crash_reporting.dart`). Flutter
/// calls it, after reporting the error through `FlutterError.onError`, for a
/// widget that threw while building. RN's ErrorBoundary unmounts the whole
/// navigator on a render error; the equivalent here is to flag the error
/// and let [AppErrorBoundary] swap the app for the fallback. The broken
/// widget itself renders nothing meanwhile.
Widget renderErrorWidgetBuilder(FlutterErrorDetails details) {
  // Can't notify listeners mid-build; flag it once this frame is done.
  SchedulerBinding.instance.addPostFrameCallback((_) => renderErrorNotifier.value ??= details);
  return const SizedBox.shrink();
}

/// Port of RN `components/ErrorBoundary/ErrorBoundary.tsx` as `App.tsx`
/// uses it, around the root navigator: while [renderErrorNotifier] holds an
/// error the app is replaced by [ErrorFallback]. "Try again" clears it and
/// calls [onReset], which sends the router back to the start of the app,
/// like RN re-mounting the navigator (Splash, then wherever auth routes).
class AppErrorBoundary extends StatelessWidget {
  const AppErrorBoundary({super.key, required this.child, required this.onReset});

  final Widget child;
  final VoidCallback onReset;

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<FlutterErrorDetails?>(
      valueListenable: renderErrorNotifier,
      builder: (context, error, child) {
        if (error == null) return child!;
        return ErrorFallback(
          onReset: () {
            onReset();
            renderErrorNotifier.value = null;
          },
        );
      },
      child: child,
    );
  }
}

/// RN ErrorBoundary's `ErrorFallback`: centred "Something went wrong!",
/// the reassurance line and a "Try again" button.
class ErrorFallback extends ConsumerWidget {
  const ErrorFallback({super.key, required this.onReset});

  final VoidCallback onReset;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final size = RnSize.of(context);
    return Material(
      color: Colors.white,
      child: Padding(
        // styles.container: paddingHorizontal 24@s.
        padding: EdgeInsets.symmetric(horizontal: size.s(24)),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Padding(
              padding: EdgeInsets.only(bottom: size.vs(10)),
              child: Text(
                ref.t('common.somethingWentWrong'),
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontFamily: AppFonts.replayProHeadline,
                  fontSize: 20,
                  color: AppColors.darkGray12,
                ),
              ),
            ),
            Padding(
              padding: EdgeInsets.only(bottom: size.vs(24)),
              child: Text(
                ref.t('common.unexpectedErrorDesc'),
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontFamily: AppFonts.ibmPlexSerifRegular,
                  fontSize: 14,
                  height: 20 / 14,
                  color: AppColors.darkGray16,
                ),
              ),
            ),
            FractionallySizedBox(
              widthFactor: 0.6,
              child: _PrimaryButton(label: ref.t('common.offline.tryAgain'), onPressed: onReset),
            ),
          ],
        ),
      ),
    );
  }
}

/// RN `Button` (primary, md): pill, `ds.theme.primary`, 10@vs padding,
/// 44@vs min height, body.medium label in the system font (Button sets no
/// fontFamily; the shared `AppButton` uses Roboto, so it isn't used here).
class _PrimaryButton extends StatefulWidget {
  const _PrimaryButton({required this.label, required this.onPressed});

  final String label;
  final VoidCallback onPressed;

  @override
  State<_PrimaryButton> createState() => _PrimaryButtonState();
}

class _PrimaryButtonState extends State<_PrimaryButton> {
  bool _pressed = false;

  @override
  Widget build(BuildContext context) {
    final size = RnSize.of(context);
    return GestureDetector(
      key: const ValueKey('error-boundary-retry'),
      behavior: HitTestBehavior.opaque,
      onTapDown: (_) => setState(() => _pressed = true),
      onTapUp: (_) => setState(() => _pressed = false),
      onTapCancel: () => setState(() => _pressed = false),
      onTap: widget.onPressed,
      child: Opacity(
        opacity: _pressed ? 0.8 : 1,
        child: Container(
          constraints: BoxConstraints(minHeight: size.vs(44)),
          padding: EdgeInsets.symmetric(vertical: size.vs(10)),
          alignment: Alignment.center,
          decoration: BoxDecoration(color: AppColors.primary, borderRadius: BorderRadius.circular(999)),
          child: Text(
            widget.label,
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontFamily: 'CupertinoSystemText',
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
