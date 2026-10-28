import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';

import '../../../core/chat/current_chat_provider.dart';
import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/widgets/app_button.dart';
import '../../calllog/data/call_log_repository.dart';
import 'breath_sound_player.dart';
import 'call_end_overlay.dart';
import 'flower_petal_painter.dart';

/// Port of ally-mobile (React Native)'s `BoxBreathingScreen/BreathingScreen`
/// and its `BoxBreathingAnimation`/`BreathingControls`/`CallEndOverlay`
/// components — the screen Scribe lands on when a call ends.
///
/// Flow: [CallEndOverlay] for 3s, then the `breathingBackground` image
/// under RN's darkGray→black0 gradient with the "Return to self" heading,
/// the box animation, a white 1–4 countdown, mute/play-pause controls and
/// a "View Call Summary" button for [chatId] (the call that just ended).
/// Back (Android hardware back / iOS pop) clears the current chat and
/// resets to the home shell — RN's `navigation.reset` to `CALL_LOG`, which
/// is the root stack's Drawer/Tab navigator route.
///
/// Animation (RN `BoxBreathingAnimation`): four 4s phases — "one" Hold
/// (dot → top-left, flower closes), "two" Inhale (→ top-right, opens),
/// "three" Hold (→ bottom-right, stays open), "four" Exhale (→ bottom-left,
/// closes). Playing advances to "two" immediately. Pausing resets
/// everything to phase "one" (dot top-left, flower closed, label "Hold",
/// countdown 1), exactly like RN; resuming starts again at Inhale.
///
/// Sound (RN `SoundPlayer` + `sounds.breath`): starts when the animation
/// mounts, restarts from 0 on every Inhale unless muted and on resume,
/// pauses on pause, mute sets volume 0, stopped when the screen goes away.
class BoxBreathingScreen extends ConsumerStatefulWidget {
  const BoxBreathingScreen({super.key, this.chatId});

  /// The chat that just ended — falls back to [currentChatProvider]'s
  /// (RN's `CallSummaryScreen` reads `currentChat` the same way).
  final int? chatId;

  @override
  ConsumerState<BoxBreathingScreen> createState() => _BoxBreathingScreenState();
}

/// RN's `phases` array, in order: label key, dot corner (left, top), bloom
/// target.
const _phases = <({String label, Offset corner, double bloom})>[
  (label: 'boxBreathing.phaseHold', corner: Offset(0, 0), bloom: 0),
  (label: 'boxBreathing.phaseInhale', corner: Offset(1, 0), bloom: 1),
  (label: 'boxBreathing.phaseHold', corner: Offset(1, 1), bloom: 1),
  (label: 'boxBreathing.phaseExhale', corner: Offset(0, 1), bloom: 0),
];

const _inhalePhase = 1;

class _BoxBreathingScreenState extends ConsumerState<BoxBreathingScreen>
    with SingleTickerProviderStateMixin, WidgetsBindingObserver {
  static const _overlayDuration = Duration(seconds: 3);
  static const _phaseDuration = Duration(seconds: 4);

  late final AnimationController _controller;
  bool _showOverlay = true;
  bool _isPlaying = true;
  bool _isMuted = false;
  int _seconds = 1;
  int _phaseIndex = 0;

  /// Where the dot/flower start the current phase's tween from.
  Offset _fromCorner = Offset.zero;
  double _fromBloom = 0;

  Timer? _overlayTimer;
  Timer? _countdownTimer;
  BreathSoundPlayer? _sound;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _controller = AnimationController(vsync: this, duration: _phaseDuration)
      ..addStatusListener((status) {
        if (status == AnimationStatus.completed && _isPlaying) {
          _enterPhase((_phaseIndex + 1) % _phases.length);
        }
      });
    _overlayTimer = Timer(_overlayDuration, _onOverlayDone);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _overlayTimer?.cancel();
    _countdownTimer?.cancel();
    _controller.dispose();
    _sound?.stop();
    super.dispose();
  }

  /// RN's `AppState` listener: going inactive pauses playback.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.inactive || state == AppLifecycleState.paused) {
      if (_isPlaying) _setPlaying(false);
    }
  }

  void _onOverlayDone() {
    setState(() => _showOverlay = false);
    // BoxBreathingAnimation's mount effect: play the breath sound.
    final sound = _sound = ref.read(breathSoundPlayerFactoryProvider)();
    if (_isPlaying) {
      sound.playAsset();
      _enterPhase(_inhalePhase);
    } else {
      // RN plays, then its isPlaying effect immediately pauses.
      sound.playAsset();
      sound.pause();
    }
  }

  void _enterPhase(int index) {
    final current = _phases[_phaseIndex];
    setState(() {
      _fromCorner = current.corner;
      _fromBloom = current.bloom;
      _phaseIndex = index;
    });
    _controller.forward(from: 0);
    _restartCountdown();
    if (index == _inhalePhase && !_isMuted) _sound?.replay();
  }

  /// RN's `onPhaseChange`: count 1→4, one per second, only while playing.
  void _restartCountdown() {
    _countdownTimer?.cancel();
    setState(() => _seconds = 1);
    if (!_isPlaying) return;
    var count = 1;
    _countdownTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      count += 1;
      if (count > 4) {
        timer.cancel();
        return;
      }
      setState(() => _seconds = count);
    });
  }

  void _setPlaying(bool playing) {
    if (playing == _isPlaying) return;
    setState(() => _isPlaying = playing);
    if (_showOverlay) return;
    if (playing) {
      _sound?.replay();
      // Reset state is phase "one"; playing advances straight to Inhale.
      _enterPhase(_inhalePhase);
    } else {
      _sound?.pause();
      _controller.stop();
      _countdownTimer?.cancel();
      setState(() {
        _phaseIndex = 0;
        _fromCorner = _phases[0].corner;
        _fromBloom = 0;
        _seconds = 1;
      });
      _controller.value = 0;
    }
  }

  void _toggleMute() {
    setState(() => _isMuted = !_isMuted);
    _sound?.setVolume(_isMuted ? 0 : 1);
    // RN's Inhale effect also depends on isMuted: unmuting mid-Inhale
    // restarts the sound.
    if (!_isMuted && _phaseIndex == _inhalePhase && _isPlaying) _sound?.replay();
  }

  void _resetToCallLog() {
    ref.read(currentChatProvider.notifier).set(null);
    _setPlaying(false);
    context.go('/home');
  }

  Future<void> _viewCallSummary() async {
    _setPlaying(false);
    final chatId = widget.chatId ?? ref.read(currentChatProvider)?.chatId;
    if (chatId == null) return;
    CallLogItem log;
    try {
      log = await ref.read(callLogRepositoryProvider).getCallLogItem(chatId);
    } catch (_) {
      log = CallLogItem(
        id: chatId,
        startedAt: '',
        endedAt: '',
        status: 'ENDED',
        sessionName: null,
        score: null,
      );
    }
    if (!mounted) return;
    context.push('/call-log/$chatId', extra: log);
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _resetToCallLog();
      },
      child: Scaffold(
        backgroundColor: Colors.black,
        body: _showOverlay ? const CallEndOverlay() : _buildBreathing(context),
      ),
    );
  }

  Widget _buildBreathing(BuildContext context) {
    return Stack(
      fit: StackFit.expand,
      children: [
        Image.asset('assets/images/breathingBackground.png', fit: BoxFit.cover),
        const DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [AppColors.darkGray, AppColors.black0],
            ),
          ),
        ),
        Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 60, 20, 20),
              child: Text(
                ref.t('stressBuster.returnToSelf'),
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 32,
                  fontFamily: AppFonts.replayProHeadline,
                ),
              ),
            ),
            Expanded(
              child: Column(
                children: [
                  Expanded(child: _buildAnimation(context)),
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Text(
                      '$_seconds',
                      key: const ValueKey('breathing-timer'),
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 48,
                        fontWeight: FontWeight.bold,
                        fontFamily: AppFonts.robotoRegular,
                      ),
                    ),
                  ),
                  _BreathingControls(
                    isMuted: _isMuted,
                    isPlaying: _isPlaying,
                    onToggleMute: _toggleMute,
                    onTogglePlayPause: () => _setPlaying(!_isPlaying),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.only(bottom: 40),
              child: FractionallySizedBox(
                widthFactor: 0.7,
                child: AppButton(
                  label: ref.t('stressBuster.viewCallSummary'),
                  onPressed: _viewCallSummary,
                ),
              ),
            ),
          ],
        ),
      ],
    );
  }

  /// RN `BoxBreathingAnimation`: a `min(SCREEN_WIDTH * 0.8, 350)` square
  /// (2px #555 border, radius 16) with the dot travelling its corners and,
  /// in an absolutely-positioned 100%×90% centered container, the phase
  /// label (18/600, marginTop 60, system font) above the flower.
  Widget _buildAnimation(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final widthBudget = math.min(MediaQuery.sizeOf(context).width * 0.8, 350.0);
        // Never overflow a short viewport (RN assumes a tall phone).
        final squareSize = math.min(widthBudget, math.max(constraints.maxHeight - 16, 80.0));
        final flowerSize = math.min(squareSize * 0.8, 280.0);
        const dotSize = 14.0;
        final phase = _phases[_phaseIndex];
        return Center(
          child: SizedBox(
            width: squareSize,
            height: squareSize,
            child: AnimatedBuilder(
              animation: _controller,
              builder: (context, _) {
                // RN: Animated.timing (default easeInOut) for the dot,
                // Reanimated withTiming (default inOut(quad)) for the bloom.
                final dotT = Curves.easeInOut.transform(_controller.value);
                final bloomT = Curves.easeInOutQuad.transform(_controller.value);
                final position = _isPlaying
                    ? Offset.lerp(_fromCorner, phase.corner, dotT)!
                    : _phases[0].corner;
                final bloom = _isPlaying ? _fromBloom + (phase.bloom - _fromBloom) * bloomT : 0.0;
                return Stack(
                  clipBehavior: Clip.none,
                  children: [
                    Positioned.fill(
                      child: DecoratedBox(
                        decoration: BoxDecoration(
                          border: Border.all(color: const Color(0xFF555555), width: 2),
                          borderRadius: BorderRadius.circular(16),
                        ),
                      ),
                    ),
                    Positioned(
                      left: position.dx * squareSize - dotSize / 2,
                      top: position.dy * squareSize - dotSize / 2,
                      child: Container(
                        key: const ValueKey('box-breathing-dot'),
                        width: dotSize,
                        height: dotSize,
                        decoration: BoxDecoration(
                          color: Colors.white,
                          shape: BoxShape.circle,
                          boxShadow: [
                            BoxShadow(color: Colors.white.withValues(alpha: 0.5), blurRadius: 8),
                          ],
                        ),
                      ),
                    ),
                    Positioned.fill(
                      child: Center(
                        child: SizedBox(
                          width: squareSize,
                          height: squareSize * 0.9,
                          child: OverflowBox(
                            maxHeight: double.infinity,
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Padding(
                                  padding: const EdgeInsets.only(top: 60),
                                  child: Text(
                                    ref.t(phase.label),
                                    // No fontFamily in RN → iOS system font;
                                    // inherit:false keeps the theme's
                                    // IBM Plex Serif from leaking in.
                                    style: const TextStyle(
                                      inherit: false,
                                      color: Colors.white,
                                      fontSize: 18,
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                ),
                                // RN's <Svg height={size * 1.5} viewBox="0 0
                                // size size"> centres the drawing a quarter
                                // of `size` below the size×size View.
                                SizedBox(
                                  width: flowerSize,
                                  height: flowerSize,
                                  child: Transform.translate(
                                    offset: Offset(0, flowerSize * 0.25),
                                    child: CustomPaint(
                                      size: Size.square(flowerSize),
                                      painter: FlowerPetalPainter(bloomProgress: bloom),
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                  ],
                );
              },
            ),
          ),
        );
      },
    );
  }
}

/// RN `BreathingVideo/BreathingControls`: two 56pt lightGray6 circles,
/// 20 apart, 40 above the button; icons at their SVGs' intrinsic sizes.
class _BreathingControls extends StatelessWidget {
  const _BreathingControls({
    required this.isMuted,
    required this.isPlaying,
    required this.onToggleMute,
    required this.onTogglePlayPause,
  });

  final bool isMuted;
  final bool isPlaying;
  final VoidCallback onToggleMute;
  final VoidCallback onTogglePlayPause;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 40),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          _ControlButton(
            key: const ValueKey('volume-button'),
            onPressed: onToggleMute,
            child: SvgPicture.asset(
              isMuted ? 'assets/icons/volumeMute.svg' : 'assets/icons/volumeUnmute.svg',
              key: ValueKey(isMuted ? 'volume-off-icon' : 'volume-on-icon'),
            ),
          ),
          const SizedBox(width: 20),
          _ControlButton(
            key: const ValueKey('play-pause-button'),
            onPressed: onTogglePlayPause,
            child: isPlaying
                ? SvgPicture.asset('assets/icons/pauseWhite.svg', key: const ValueKey('pause-icon'))
                : SvgPicture.asset(
                    'assets/icons/playWhite.svg',
                    key: const ValueKey('play-icon'),
                    colorFilter: const ColorFilter.mode(Colors.white, BlendMode.srcIn),
                  ),
          ),
        ],
      ),
    );
  }
}

/// A `TouchableOpacity activeOpacity={0.8}` circle.
class _ControlButton extends StatefulWidget {
  const _ControlButton({super.key, required this.onPressed, required this.child});

  final VoidCallback onPressed;
  final Widget child;

  @override
  State<_ControlButton> createState() => _ControlButtonState();
}

class _ControlButtonState extends State<_ControlButton> {
  bool _pressed = false;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTapDown: (_) => setState(() => _pressed = true),
      onTapCancel: () => setState(() => _pressed = false),
      onTapUp: (_) => setState(() => _pressed = false),
      onTap: widget.onPressed,
      child: Opacity(
        opacity: _pressed ? 0.8 : 1,
        child: Container(
          width: 56,
          height: 56,
          alignment: Alignment.center,
          decoration: const BoxDecoration(color: AppColors.lightGray6, shape: BoxShape.circle),
          child: widget.child,
        ),
      ),
    );
  }
}
