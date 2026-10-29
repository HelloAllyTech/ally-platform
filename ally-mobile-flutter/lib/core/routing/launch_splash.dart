import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lottie/lottie.dart';

import '../theme/app_colors.dart';

/// RN `SplashScreen`'s Lottie. RN mounts SplashScreen on every cold start
/// (signed in or not) and on every sign-out, plays frames 0→200 of this
/// 360-frame, 120fps file (`lottieRef.play(0, 200)`), then re-renders it at
/// `progress={0.99}` once `onAnimationFinish` fires.
const kSplashAnimationAsset = 'assets/animations/splashAnimation.json';
const kSplashLottieDuration = Duration(milliseconds: 3000);
const kSplashPlayToProgress = 200 / 360;
const kSplashSettledProgress = 0.99;

/// RN `StatusBar.setHidden(true)` on SplashScreen mount.
void hideStatusBarForSplash() {
  SystemChrome.setEnabledSystemUIMode(SystemUiMode.manual, overlays: const [SystemUiOverlay.bottom]);
}

/// RN `onAnimationFinish`: `setTimeout(() => StatusBar.setHidden(false),
/// 1000)`. Not tied to a widget: the signed-in user has already been
/// routed on by then, as in RN.
void showStatusBarAfterSplash() {
  Timer(const Duration(seconds: 1), () {
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
  });
}

/// Launch splash progress, read by the router's redirect.
///
/// [LaunchSplashState.finished]: the cold-start animation has played, so
/// `/splash` may hand over (RN routes only once `isAnimationEnded`).
class LaunchSplashState {
  const LaunchSplashState({this.finished = false});

  final bool finished;
}

class LaunchSplashController extends Notifier<LaunchSplashState> {
  bool _handOffToLogin = false;

  @override
  LaunchSplashState build() => const LaunchSplashState();

  void finish() {
    _handOffToLogin = true;
    state = const LaunchSplashState(finished: true);
  }

  /// Whether the login screen should open already settled on the last frame
  /// and slide its sheet straight up: RN's splash and login are one screen,
  /// so the animation must not replay when a signed-out user moves on from
  /// `/splash`. Taken once (not state, so it's safe from `initState`); a
  /// later sign-out mounts a fresh login screen that replays it, as RN does.
  bool takeLoginHandOff() {
    final handOff = _handOffToLogin;
    _handOffToLogin = false;
    return handOff;
  }
}

final launchSplashProvider = NotifierProvider<LaunchSplashController, LaunchSplashState>(LaunchSplashController.new);

/// `/splash`: RN SplashScreen before the login sheet shows — the full-bleed
/// Lottie on the dark-green background with the status bar hidden. Plays on
/// every cold start; the router moves on once it ends and the session (and,
/// signed in, `/users/me`) has resolved.
class LaunchSplashScreen extends ConsumerStatefulWidget {
  const LaunchSplashScreen({super.key});

  @override
  ConsumerState<LaunchSplashScreen> createState() => _LaunchSplashScreenState();
}

class _LaunchSplashScreenState extends ConsumerState<LaunchSplashScreen> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(vsync: this, duration: kSplashLottieDuration);

  @override
  void initState() {
    super.initState();
    // Played once per process: a later visit (the error boundary's reset
    // goes to `/splash`) passes straight through the router.
    if (ref.read(launchSplashProvider).finished) return;
    hideStatusBarForSplash();
    _controller.animateTo(kSplashPlayToProgress).then((_) {
      if (!mounted) return;
      _controller.value = kSplashSettledProgress;
      showStatusBarAfterSplash();
      ref.read(launchSplashProvider.notifier).finish();
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: AppColors.darkGreen,
        body: SizedBox.expand(
          child: Lottie.asset(kSplashAnimationAsset, controller: _controller, fit: BoxFit.cover),
        ),
      );
}
