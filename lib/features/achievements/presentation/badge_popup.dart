import 'dart:async';
import 'dart:math' show pi;

import 'package:confetti/confetti.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/theme/rn_scale.dart';
import '../data/achievements_repository.dart';
import 'badge_network_image.dart';

/// RN `constants/badgePopup.ts`.
const badgeAutoCloseDelay = Duration(milliseconds: 5000);
const badgeInitialShowDelay = Duration(milliseconds: 1000);
const badgeCloseAnimationDelay = Duration(milliseconds: 300);
const badgeNextBadgeDelay = Duration(milliseconds: 350);
const badgePollingInterval = Duration(milliseconds: 60000);

/// Port of RN `components/BadgePopup` + `hooks/useBadgePopup.ts`: the
/// "You earned a new badge" popup.
///
/// While [active] (RN: the hosting screen is focused and the user has
/// `VIEW_USER_BADGES`), polls `GET /badges/me?viewedStatus=UNVIEWED` now,
/// every 60s and whenever the app comes back to the foreground (RTK's
/// `refetchOnFocus`). Unviewed badges queue up: the first shows after 1s,
/// each auto-closes after 5s (only once its image is laid out, so a badge
/// with no image stays until closed, as in RN), and closing one marks it
/// viewed (`PATCH /badges/me/:badgeId/viewed`) and shows the next 350ms
/// after the 300ms close. Confetti fires for the first badge only.
///
/// RN mounts it on SimulationsScreen, and on ReviewScreen for reviewer-only
/// users; here the home shell mounts one host and makes it [active] on
/// those tabs (see `app_shell_screen.dart`).
class BadgePopupHost extends ConsumerStatefulWidget {
  const BadgePopupHost({super.key, required this.active, this.onShowingChanged});

  final bool active;

  /// Told when a badge appears or goes, e.g. so the host screen can route
  /// Android back to [BadgePopupHostState.close] (RN's `onRequestClose`).
  final ValueChanged<bool>? onShowingChanged;

  @override
  ConsumerState<BadgePopupHost> createState() => BadgePopupHostState();
}

class BadgePopupHostState extends ConsumerState<BadgePopupHost> with WidgetsBindingObserver {
  UserBadge? _current;
  List<UserBadge> _queue = const [];
  bool _isFirstBadge = false;
  bool _hasShownFirstBadge = false;
  bool _isClosing = false;

  /// Badges closed in this session. The list refetched right after a close
  /// can still carry them; RN's queue effect wins that race by timing.
  final Set<String> _closedIds = {};

  Timer? _pollTimer;
  Timer? _showTimer;
  Timer? _autoCloseTimer;
  Timer? _clearTimer;
  Timer? _nextTimer;
  late final ConfettiController _confettiController = ConfettiController(duration: const Duration(seconds: 1));

  /// Whether a badge is on screen.
  bool get isShowing => _current != null;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    if (widget.active) _startPolling();
  }

  @override
  void didUpdateWidget(BadgePopupHost oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.active == oldWidget.active) return;
    widget.active ? _startPolling() : _stopPolling();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && widget.active) unawaited(_fetch());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _stopPolling();
    for (final timer in [_showTimer, _autoCloseTimer, _clearTimer, _nextTimer]) {
      timer?.cancel();
    }
    _confettiController.dispose();
    super.dispose();
  }

  void _startPolling() {
    unawaited(_fetch());
    _pollTimer?.cancel();
    _pollTimer = Timer.periodic(badgePollingInterval, (_) => _fetch());
  }

  void _stopPolling() {
    _pollTimer?.cancel();
    _pollTimer = null;
  }

  Future<void> _fetch() async {
    final List<UserBadge> badges;
    try {
      badges = await ref.read(achievementsRepositoryProvider).getUnviewedBadges();
    } catch (_) {
      return;
    }
    if (!mounted) return;
    _onBadges(badges);
  }

  bool _isBusy(Timer? timer) => timer?.isActive ?? false;

  /// RN's "initial badge queue setup" effect: with nothing on screen or
  /// queued, show the first unviewed badge after 1s and queue the rest.
  void _onBadges(List<UserBadge> badges) {
    final fresh = badges.where((b) => !_closedIds.contains(b.id)).toList();
    if (fresh.isEmpty || _current != null || _queue.isNotEmpty) return;
    if (_isBusy(_showTimer) || _isBusy(_nextTimer) || _isBusy(_clearTimer)) return;
    _showTimer = Timer(badgeInitialShowDelay, () {
      if (!mounted) return;
      _show(fresh.first, queue: fresh.sublist(1), isFirst: !_hasShownFirstBadge);
      _hasShownFirstBadge = true;
    });
  }

  void _show(UserBadge badge, {required List<UserBadge> queue, required bool isFirst}) {
    setState(() {
      _current = badge;
      _queue = queue;
      _isFirstBadge = isFirst;
      _isClosing = false;
    });
    widget.onShowingChanged?.call(true);
    if (isFirst && !MediaQuery.of(context).disableAnimations) _confettiController.play();
    // RN starts the auto-close timer once the image container has laid out
    // (`isLayoutReady`); with no image it never does.
    _autoCloseTimer?.cancel();
    if (badge.imageUrl.isNotEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted || _current != badge) return;
        _autoCloseTimer = Timer(badgeAutoCloseDelay, close);
      });
    }
  }

  /// RN `handleClose`: mark the badge viewed, then clear it after the close
  /// animation delay and move on to the next queued badge.
  Future<void> close() async {
    final badge = _current;
    if (badge == null || _isClosing) return;
    _isClosing = true;
    _autoCloseTimer?.cancel();
    _clearTimer?.cancel();
    _closedIds.add(badge.id);
    try {
      await ref.read(achievementsRepositoryProvider).markBadgeAsViewed(badge.badgeId);
      // RN's mutation invalidates every `Badges` tag (Achievements too).
      ref.invalidate(badgesProvider);
    } catch (_) {
      // RN logs and closes anyway.
    }
    if (!mounted) return;
    _clearTimer = Timer(badgeCloseAnimationDelay, () {
      if (!mounted) return;
      setState(() => _current = null);
      widget.onShowingChanged?.call(false);
      if (_queue.isEmpty) return;
      final [next, ...rest] = _queue;
      _nextTimer = Timer(badgeNextBadgeDelay, () {
        if (mounted) _show(next, queue: rest, isFirst: false);
      });
    });
  }

  @override
  Widget build(BuildContext context) {
    final badge = _current;
    if (badge == null) return const SizedBox.shrink();
    return Stack(
      fit: StackFit.expand,
      children: [
        // styles.overlay.
        ColoredBox(
          color: AppColors.blackTransparent50,
          child: Center(child: _BadgeCard(badge: badge, onClose: close)),
        ),
        // ConfettiCannon count 100, origin {x: 0, y: 0}, fadeOut.
        if (_isFirstBadge)
          Align(
            alignment: Alignment.topLeft,
            child: ConfettiWidget(
              confettiController: _confettiController,
              blastDirection: pi / 4,
              blastDirectionality: BlastDirectionality.explosive,
              emissionFrequency: 0,
              numberOfParticles: 100,
              maxBlastForce: 60,
              minBlastForce: 20,
              gravity: 0.2,
            ),
          ),
      ],
    );
  }
}

class _BadgeCard extends ConsumerWidget {
  const _BadgeCard({required this.badge, required this.onClose});

  final UserBadge badge;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final size = RnSize.of(context);
    return FractionallySizedBox(
      // styles.container: width 60%, padding 16@s, radius 12@s.
      widthFactor: 0.6,
      child: Material(
        color: Colors.white,
        borderRadius: BorderRadius.circular(size.s(12)),
        child: Stack(
          children: [
            Padding(
              padding: EdgeInsets.all(size.s(16)),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (badge.imageUrl.isNotEmpty)
                    Container(
                      width: size.s(100),
                      height: size.s(100),
                      margin: EdgeInsets.symmetric(vertical: size.s(8)),
                      decoration: const BoxDecoration(color: AppColors.grey100),
                      clipBehavior: Clip.hardEdge,
                      alignment: Alignment.center,
                      child: BadgeNetworkImage(url: badge.imageUrl),
                    ),
                  Padding(
                    padding: EdgeInsets.only(bottom: size.s(8)),
                    child: Text(
                      ref.t('achievements.modal.newBadge'),
                      textAlign: TextAlign.center,
                      style: _bodyMedium.copyWith(
                        fontFamily: AppFonts.ibmPlexSerifRegular,
                        fontWeight: FontWeight.w400,
                        color: AppColors.highEmphasis,
                      ),
                    ),
                  ),
                  Text(
                    badge.name,
                    textAlign: TextAlign.center,
                    // typography.body.large, medium weight.
                    style: const TextStyle(
                      fontFamily: AppFonts.ibmPlexSerifRegular,
                      fontSize: 16,
                      height: 24 / 16,
                      letterSpacing: 0.5,
                      fontWeight: FontWeight.w500,
                      color: AppColors.highEmphasis,
                    ),
                  ),
                  Text(
                    badge.description,
                    textAlign: TextAlign.center,
                    style: _bodyMedium.copyWith(
                      fontFamily: AppFonts.ibmPlexSerifMedium,
                      fontWeight: FontWeight.w500,
                      color: AppColors.mediumEmphasis,
                    ),
                  ),
                ],
              ),
            ),
            // styles.closeButton: absolute, 8@s from the top right; the
            // CloseIcon is given an unscaled 24x24.
            Positioned(
              top: size.s(8),
              right: size.s(8),
              child: GestureDetector(
                key: const ValueKey('badge-popup-close'),
                behavior: HitTestBehavior.opaque,
                onTap: onClose,
                child: SvgPicture.asset('assets/icons/close.svg', width: size.raw(24), height: size.raw(24)),
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// typography.body.medium.
  static const _bodyMedium = TextStyle(fontSize: 14, height: 22 / 14, letterSpacing: 0.2);
}

