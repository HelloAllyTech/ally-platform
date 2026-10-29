import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';

/// Port of RN's `BoxBreathingScreen/components/CallEndOverlay` — the
/// full-screen black→darkBlue3 gradient shown for the first 3s after a call
/// ends. "You gave your best in that session" fades out at 1s (500ms), is
/// swapped for "Now, take a moment for yourself", which fades back in
/// (500ms). Reanimated's `withTiming` default easing is inOut(quad).
class CallEndOverlay extends ConsumerStatefulWidget {
  const CallEndOverlay({super.key});

  @override
  ConsumerState<CallEndOverlay> createState() => _CallEndOverlayState();
}

class _CallEndOverlayState extends ConsumerState<CallEndOverlay> {
  int _messageIndex = 0;
  double _opacity = 1;
  Timer? _fadeOutTimer;
  Timer? _swapTimer;

  @override
  void initState() {
    super.initState();
    _fadeOutTimer = Timer(const Duration(seconds: 1), () {
      setState(() => _opacity = 0);
      _swapTimer = Timer(const Duration(milliseconds: 500), () {
        setState(() {
          _messageIndex = 1;
          _opacity = 1;
        });
      });
    });
  }

  @override
  void dispose() {
    _fadeOutTimer?.cancel();
    _swapTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Colors.black, AppColors.darkBlue3],
        ),
      ),
      child: SizedBox.expand(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24),
          child: Center(
            child: AnimatedOpacity(
              key: const ValueKey('animated-message'),
              opacity: _opacity,
              duration: const Duration(milliseconds: 500),
              curve: Curves.easeInOutQuad,
              child: SizedBox(
                width: double.infinity,
                child: Text(
                  ref.t(
                    _messageIndex == 0
                        ? 'stressBuster.messages.gaveBest'
                        : 'stressBuster.messages.momentForYourself',
                  ),
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 32,
                    height: 42 / 32,
                    fontFamily: AppFonts.replayProHeadline,
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
