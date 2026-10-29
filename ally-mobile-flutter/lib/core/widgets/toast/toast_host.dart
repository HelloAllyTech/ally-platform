import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/physics.dart';

import '../../theme/app_colors.dart';
import '../../theme/app_fonts.dart';
import '../../theme/rn_scale.dart';
import 'toast_controller.dart';

/// RN `ToastProvider` (mounted in `App.tsx` above the navigator, so toasts
/// survive navigation and the auth stack swap). Mount once, around the
/// router's child in `MaterialApp.builder`, inside [RnScale].
class ToastHost extends StatefulWidget {
  const ToastHost({super.key, required this.child, this.controller});

  final Widget child;

  /// Defaults to the app-wide [toastController].
  final ToastController? controller;

  @override
  State<ToastHost> createState() => _ToastHostState();
}

class _ToastHostState extends State<ToastHost> {
  ToastController get _controller => widget.controller ?? toastController;

  /// RN Toast's `setTimeout(..., duration)`, restarted for every show.
  Timer? _timer;
  int? _timerFor;

  @override
  void initState() {
    super.initState();
    _controller
      ..attachHost()
      ..addListener(_onChanged);
  }

  @override
  void didUpdateWidget(ToastHost oldWidget) {
    super.didUpdateWidget(oldWidget);
    final old = oldWidget.controller ?? toastController;
    if (old != _controller) {
      old
        ..removeListener(_onChanged)
        ..detachHost();
      _controller
        ..attachHost()
        ..addListener(_onChanged);
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    _controller
      ..removeListener(_onChanged)
      ..detachHost();
    super.dispose();
  }

  void _onChanged() {
    final toast = _controller.current;
    if (toast?.id != _timerFor) {
      _timer?.cancel();
      _timerFor = toast?.id;
      _timer = toast == null ? null : Timer(toast.duration, () => _controller.expire(toast.id));
    }
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final toast = _controller.current;
    return Stack(
      children: [
        widget.child,
        // A replacement reuses this element (no second entrance), as RN's
        // Toast isn't remounted; a show after a hide builds a fresh one.
        if (toast != null) _ToastPositioned(toast: toast),
      ],
    );
  }
}

/// RN `Toast.tsx` `styles.container` + the top/bottom offset.
class _ToastPositioned extends StatelessWidget {
  const _ToastPositioned({required this.toast});

  final ToastData toast;

  @override
  Widget build(BuildContext context) {
    final top = toast.position == ToastPosition.top;
    return Positioned(
      left: 20,
      right: 20,
      top: top ? 100 : null,
      bottom: top ? null : 100,
      child: Material(
        type: MaterialType.transparency,
        child: Center(child: AppToast(message: toast.message, type: toast.type)),
      ),
    );
  }
}

/// RN `components/Toast/Toast.tsx`: the bubble, with its slide-up spring
/// (`withSpring(0, {damping: 15, stiffness: 120})` from translateY 100) and
/// 300ms fade-in. RN unmounts it the moment its timer fires, so there is no
/// exit animation.
class AppToast extends StatefulWidget {
  const AppToast({super.key, required this.message, required this.type});

  final String message;
  final ToastType type;

  @override
  State<AppToast> createState() => _AppToastState();
}

/// RN `TOAST_STYLES`.
({Color background, Color border, Color text}) toastColors(ToastType type) => switch (type) {
      ToastType.success => (
          background: AppColors.green50,
          border: AppColors.green700,
          text: AppColors.green800,
        ),
      ToastType.error => (
          background: AppColors.red50,
          border: AppColors.red500,
          text: AppColors.red500,
        ),
    };

class _AppToastState extends State<AppToast> with TickerProviderStateMixin {
  static const _spring = SpringDescription(mass: 1, stiffness: 120, damping: 15);

  late final AnimationController _slide = AnimationController.unbounded(vsync: this);
  late final AnimationController _fade = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 300),
  );

  @override
  void initState() {
    super.initState();
    _slide.value = 1;
    _slide.animateWith(SpringSimulation(_spring, 1, 0, 0));
    _fade.forward();
  }

  @override
  void dispose() {
    _slide.dispose();
    _fade.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final size = RnSize.of(context);
    final colors = toastColors(widget.type);
    return LayoutBuilder(
      builder: (context, constraints) => AnimatedBuilder(
        animation: Listenable.merge([_slide, _fade]),
        builder: (context, child) => Opacity(
          opacity: _fade.value,
          // translateY is a plain RN number (not `@ms`).
          child: Transform.translate(offset: Offset(0, size.raw(100) * _slide.value), child: child),
        ),
        child: ConstrainedBox(
          constraints: BoxConstraints(minWidth: 200, maxWidth: constraints.maxWidth * 0.9),
          child: Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: colors.background,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: colors.border, width: size.raw(0.5)),
              boxShadow: [
                BoxShadow(color: AppColors.black.withValues(alpha: 0.05), offset: Offset(0, size.raw(2))),
              ],
            ),
            child: Text(
              widget.message,
              textAlign: TextAlign.center,
              style: TextStyle(
                fontFamily: AppFonts.ibmPlexSerifRegular,
                fontSize: 14,
                color: colors.text,
                decoration: TextDecoration.none,
              ),
            ),
          ),
        ),
      ),
    );
  }
}
