import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../../core/localization/translate_ref.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_fonts.dart';
import '../../../../core/theme/rn_scale.dart';

/// The modals ally-mobile (React Native) shows around starting a role play
/// (`hooks/useStartSimulation.ts` and the screens that use it):
///
/// - [PreStartNotificationModal] — `components/NotificationModal`, the
///   "Before you get started" confirmation.
/// - [LowCreditsModal] — the `IllustratedModal` with `NoCreditsIcon`.
/// - [ActiveSimulationModal] — `SimulationDetailsScreen/components/
///   ActiveSimulationModal` (an `IllustratedActionModal`), shown when the
///   start call fails with an `entityId` (the running session).
/// - [RetrySessionModal] — `CallLog/components/RetrySessionModal`, shown on
///   a 429 (max active users), with a 30 s auto-retry.
///
/// RN draws these as absolute overlays (`blackTransparent50`) rather than
/// dialogs; here they're dialogs with the same barrier colour. The shared
/// `IllustratedModal` in `lib/core/widgets` isn't used: it only takes PNG
/// illustrations and lays its close button out in-flow, where RN's is
/// absolutely positioned over the card.

/// iOS system font — RN's `Button` text and these modals' buttons set no
/// `fontFamily`.
const _systemFont = 'CupertinoSystemText';

/// RN `Button`'s label: `typography.body.medium` in the system font.
const _buttonTextStyle = TextStyle(
  fontFamily: _systemFont,
  fontSize: 14,
  height: 22 / 14,
  letterSpacing: 0.2,
);

/// `styles.title` shared by IllustratedModal, IllustratedActionModal and
/// NotificationModal: REPLAY_PRO.HEADLINE 20, darkGray12, centred.
const _illustratedTitleStyle = TextStyle(
  fontFamily: AppFonts.replayProHeadline,
  fontSize: 20,
  color: AppColors.darkGray12,
);

const _italicTitleStyle = TextStyle(
  fontFamily: AppFonts.replayProBoldItalic,
  fontStyle: FontStyle.italic,
);

Future<T?> _showOverlay<T>(
  BuildContext context,
  WidgetBuilder builder, {
  bool barrierDismissible = false,
  Color barrierColor = AppColors.blackTransparent50,
}) {
  return showDialog<T>(
    context: context,
    barrierDismissible: barrierDismissible,
    barrierColor: barrierColor,
    useRootNavigator: true,
    builder: builder,
  );
}

/// RN's modal card: white, radius 12, centred; `minWidth 280`, `maxWidth`
/// a share of the overlay, shrink-wrapped to its content (RN's
/// `alignItems: 'center'` on the overlay).
class _ModalCard extends StatelessWidget {
  const _ModalCard({
    super.key,
    required this.padding,
    required this.child,
    this.maxWidthFactor = 0.8,
    this.fixedWidthFactor,
    this.closeButton,
  });

  final EdgeInsets padding;
  final Widget child;
  final double maxWidthFactor;

  /// RetrySessionModal's container is a flat `width: '80%'`.
  final double? fixedWidthFactor;
  final Widget? closeButton;

  @override
  Widget build(BuildContext context) {
    final screenWidth = MediaQuery.sizeOf(context).width;
    Widget card = Container(
      padding: padding,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
      ),
      child: child,
    );
    if (closeButton != null) {
      card = Stack(children: [card, closeButton!]);
    }
    final constrained = fixedWidthFactor != null
        ? SizedBox(width: screenWidth * fixedWidthFactor!, child: card)
        : ConstrainedBox(
            constraints: BoxConstraints(
              minWidth: 280,
              maxWidth: screenWidth * maxWidthFactor,
            ),
            child: IntrinsicWidth(child: card),
          );
    return Center(
      child: Material(type: MaterialType.transparency, child: constrained),
    );
  }
}

/// RN's `Button` with the per-modal `customContainerStyle`s these modals
/// pass (colour, radius, padding), md size: `minHeight 44@vs`,
/// `paddingVertical 10@vs`; disabled swaps in `disabledContainer`; loading
/// shows a small spinner in the label colour.
class _RnButton extends StatelessWidget {
  const _RnButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.background = AppColors.primary,
    this.textColor = Colors.white,
    this.borderColor,
    this.borderRadius = 999,
    this.paddingVertical,
    this.paddingHorizontal = 0,
    this.fontWeight,
    this.isLoading = false,
    this.isDisabled = false,
  });

  final String label;
  final VoidCallback? onPressed;
  final Color background;
  final Color textColor;
  final Color? borderColor;
  final double borderRadius;
  final double? paddingVertical;
  final double paddingHorizontal;
  final FontWeight? fontWeight;
  final bool isLoading;
  final bool isDisabled;

  @override
  Widget build(BuildContext context) {
    final rn = RnSize.of(context);
    final disabled = isDisabled || isLoading;
    final radius = BorderRadius.circular(borderRadius);
    return Material(
      color: isDisabled ? AppColors.disabledContainer : background,
      shape: RoundedRectangleBorder(
        borderRadius: radius,
        side: borderColor == null
            ? BorderSide.none
            : BorderSide(color: borderColor!),
      ),
      child: InkWell(
        borderRadius: radius,
        onTap: disabled ? null : onPressed,
        child: Container(
          constraints: BoxConstraints(minHeight: rn.vs(44)),
          padding: EdgeInsets.symmetric(
            vertical: paddingVertical ?? rn.vs(10),
            horizontal: paddingHorizontal,
          ),
          alignment: Alignment.center,
          child: isLoading
              ? Padding(
                  padding: const EdgeInsets.symmetric(vertical: 2.5),
                  child: SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: textColor,
                    ),
                  ),
                )
              : Text(
                  label,
                  textAlign: TextAlign.center,
                  style: _buttonTextStyle.copyWith(
                    color: textColor,
                    fontWeight: fontWeight,
                  ),
                ),
        ),
      ),
    );
  }
}

/// RN `components/NotificationModal` — "Before you get started": the
/// title's first word plain, the rest italic; an X (24x24, top/right 10)
/// that closes without starting; the "Start Session" button confirms.
/// Resolves `true` only when confirmed.
class PreStartNotificationModal extends ConsumerWidget {
  const PreStartNotificationModal({super.key});

  static Future<bool> show(
    BuildContext context, {
    Color barrierColor = AppColors.blackTransparent50,
  }) async {
    final confirmed = await _showOverlay<bool>(
      context,
      (_) => const PreStartNotificationModal(),
      barrierColor: barrierColor,
    );
    return confirmed ?? false;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final rn = RnSize.of(context);
    final words = ref.t('learn.scenario.preStart.titleNormal').split(' ');
    final firstWord = words.first;
    final rest = words.skip(1).join(' ');

    return _ModalCard(
      key: const Key('pre-start-modal'),
      // styles.modalContainer: padding 20@s, maxWidth 85%.
      padding: EdgeInsets.all(rn.s(20)),
      maxWidthFactor: 0.85,
      closeButton: Positioned(
        top: 10,
        right: 10,
        child: GestureDetector(
          key: const Key('pre-start-modal-close'),
          behavior: HitTestBehavior.opaque,
          onTap: () => Navigator.of(context).pop(false),
          // hitSlop 10 on every side.
          child: Padding(
            padding: const EdgeInsets.all(10),
            child: SizedBox(
              width: rn.raw(24),
              height: rn.raw(24),
              child: SvgPicture.asset(
                'assets/icons/close.svg',
              ),
            ),
          ),
        ),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: EdgeInsets.only(top: rn.mvs(8), bottom: rn.mvs(16)),
            child: Text.rich(
              TextSpan(
                text: '$firstWord ',
                children: [TextSpan(text: rest, style: _italicTitleStyle)],
              ),
              textAlign: TextAlign.center,
              style: _illustratedTitleStyle,
            ),
          ),
          Padding(
            padding: EdgeInsets.only(bottom: rn.mvs(20)),
            // styles.description: IBM_PLEX_SERIF.REGULAR 14, black, 22 lh.
            child: Text(
              ref.t('learn.scenario.preStart.content'),
              textAlign: TextAlign.center,
              style: TextStyle(
                fontFamily: AppFonts.ibmPlexSerifRegular,
                fontSize: 14,
                height: rn.mvs(22) / 14,
                color: Colors.black,
              ),
            ),
          ),
          // styles.actionButton: azureBlue, radius 24, 16@mvs x 24 padding.
          _RnButton(
            key: const Key('pre-start-modal-confirm'),
            label: ref.t('learn.scenario.preStart.button'),
            borderRadius: 24,
            paddingVertical: rn.mvs(16),
            paddingHorizontal: 24,
            fontWeight: FontWeight.w600,
            onPressed: () => Navigator.of(context).pop(true),
          ),
        ],
      ),
    );
  }
}

/// RN's low-credits `IllustratedModal` (`NoCreditsIcon`, no action
/// button). The screens show it when credits turn low and hide it again
/// after `LOW_CREDITS_MODAL_DISPLAY_MS` (5 s) — see
/// `StartSimulationController.watchLowCredits`.
class LowCreditsModal extends ConsumerWidget {
  const LowCreditsModal({super.key, this.largeDescription = false});

  /// SimulationDetailsScreen passes `descriptionStyle={styles.
  /// lowCreditsDescription}` (14, 10 horizontal margin, -2 bottom); the
  /// path/case screens keep IllustratedModal's own 12.
  final bool largeDescription;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final rn = RnSize.of(context);
    return _ModalCard(
      key: const Key('low-credits-modal'),
      padding: EdgeInsets.all(rn.s(16)),
      closeButton: Positioned(
        top: 8,
        right: 8,
        child: GestureDetector(
          key: const Key('low-credits-modal-close'),
          behavior: HitTestBehavior.opaque,
          onTap: () => Navigator.of(context).pop(),
          child: SizedBox(
            width: 24,
            height: 24,
            child: Center(child: SvgPicture.asset('assets/icons/close.svg')),
          ),
        ),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Padding(
            padding: EdgeInsets.only(top: rn.mvs(8), bottom: rn.mvs(16)),
            child: Text(
              ref.t('learn.scenario.noCredits.title'),
              textAlign: TextAlign.center,
              style: _illustratedTitleStyle,
            ),
          ),
          Padding(
            padding: EdgeInsets.only(bottom: rn.mvs(20)),
            child: SvgPicture.asset('assets/icons/noCredits.svg'),
          ),
          Padding(
            padding: largeDescription
                ? EdgeInsets.only(left: 10, right: 10, bottom: rn.mvs(16) - 2)
                : EdgeInsets.only(bottom: rn.mvs(16)),
            child: Text(
              ref.t('learn.scenario.noCredits.desc'),
              textAlign: TextAlign.center,
              style: TextStyle(
                fontFamily: AppFonts.ibmPlexSerifRegular,
                fontSize: largeDescription ? 14 : 12,
                height: rn.mvs(20) / (largeDescription ? 14 : 12),
                color: AppColors.darkGray2,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// RN `ActiveSimulationModal`: "Active Simulation *Detected*", the
/// running-simulation illustration, and Cancel / End session side by side.
/// No X and no backdrop dismiss (IllustratedActionModal has neither). End
/// session calls [onEndSession] with a spinner on that button, then closes
/// whatever the outcome — the caller shows the success/error toast.
class ActiveSimulationModal extends ConsumerStatefulWidget {
  const ActiveSimulationModal({super.key, required this.onEndSession});

  final Future<void> Function() onEndSession;

  static Future<void> show(
    BuildContext context, {
    required Future<void> Function() onEndSession,
  }) {
    return _showOverlay<void>(
      context,
      (_) => ActiveSimulationModal(onEndSession: onEndSession),
    );
  }

  @override
  ConsumerState<ActiveSimulationModal> createState() =>
      _ActiveSimulationModalState();
}

class _ActiveSimulationModalState extends ConsumerState<ActiveSimulationModal> {
  bool _isEnding = false;

  Future<void> _end() async {
    setState(() => _isEnding = true);
    try {
      await widget.onEndSession();
    } finally {
      if (mounted) Navigator.of(context).pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    final rn = RnSize.of(context);
    return PopScope(
      canPop: !_isEnding,
      child: _ModalCard(
        key: const Key('active-simulation-modal'),
        padding: EdgeInsets.all(rn.s(16)),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: EdgeInsets.only(top: rn.mvs(8), bottom: rn.mvs(16)),
              child: Text.rich(
                TextSpan(
                  // RN: `{titleMain} ` + the italic part.
                  text: '${ref.t('learn.scenario.existing.titleNormal')} ',
                  children: [
                    TextSpan(
                      text: ref.t('learn.scenario.existing.titleItalic'),
                      style: _italicTitleStyle,
                    ),
                  ],
                ),
                textAlign: TextAlign.center,
                style: _illustratedTitleStyle,
              ),
            ),
            Padding(
              padding: EdgeInsets.only(bottom: rn.mvs(20)),
              child: Center(
                child: SvgPicture.asset('assets/icons/runningSimulation.svg'),
              ),
            ),
            Padding(
              padding: EdgeInsets.only(bottom: rn.mvs(16)),
              // styles.description: IBM_PLEX_SERIF.REGULAR 12, black.
              child: Text(
                ref.t('learn.scenario.existing.content'),
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontFamily: AppFonts.ibmPlexSerifRegular,
                  fontSize: 12,
                  height: rn.mvs(20) / 12,
                  color: Colors.black,
                ),
              ),
            ),
            // styles.actionsRow: two half-width buttons, gap 12.
            Row(
              children: [
                Expanded(
                  child: _RnButton(
                    key: const Key('active-simulation-cancel'),
                    label: ref.t('common.cancel'),
                    background: Colors.white,
                    borderColor: AppColors.lightGrayD9,
                    textColor: AppColors.charcoalGray,
                    onPressed: _isEnding
                        ? null
                        : () => Navigator.of(context).pop(),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _RnButton(
                    key: const Key('active-simulation-end'),
                    label: ref.t('simulationPage.endSession'),
                    borderRadius: 24,
                    isLoading: _isEnding,
                    onPressed: _end,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// RN `RetrySessionModal` (shown on a 429 start): counts down 30 s and
/// retries by itself; a failed retry (still 429) switches to a 30 s
/// cooldown with Retry disabled, after which auto-retry resumes. The X or
/// a backdrop tap closes it. [onRetry] resolves `true` once the retry got
/// past the rate limit (started, or failed some other way the caller
/// handled) — the modal then closes.
class RetrySessionModal extends ConsumerStatefulWidget {
  const RetrySessionModal({
    super.key,
    required this.onRetry,
    this.autoRetrySeconds = autoRetrySecondsDefault,
    this.cooldownSeconds = cooldownSecondsDefault,
  });

  static const autoRetrySecondsDefault = 30;
  static const cooldownSecondsDefault = 30;

  final Future<bool> Function() onRetry;
  final int autoRetrySeconds;
  final int cooldownSeconds;

  static Future<void> show(
    BuildContext context, {
    required Future<bool> Function() onRetry,
  }) {
    return _showOverlay<void>(
      context,
      (_) => RetrySessionModal(onRetry: onRetry),
      barrierDismissible: true,
    );
  }

  @override
  ConsumerState<RetrySessionModal> createState() => _RetrySessionModalState();
}

class _RetrySessionModalState extends ConsumerState<RetrySessionModal> {
  late int _timeLeft = widget.autoRetrySeconds;
  bool _cooldown = false;
  bool _isRetrying = false;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) => _tick());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  void _tick() {
    if (_isRetrying || !mounted) return;
    if (_timeLeft <= 1) {
      if (_cooldown) {
        setState(() {
          _cooldown = false;
          _timeLeft = widget.autoRetrySeconds;
        });
      } else {
        setState(() => _timeLeft = 0);
        _retry();
      }
      return;
    }
    setState(() => _timeLeft--);
  }

  Future<void> _retry() async {
    if (_isRetrying) return;
    setState(() => _isRetrying = true);
    bool done;
    try {
      done = await widget.onRetry();
    } catch (_) {
      done = false;
    }
    if (!mounted) return;
    if (done) {
      Navigator.of(context).pop();
      return;
    }
    setState(() {
      _isRetrying = false;
      _cooldown = true;
      _timeLeft = widget.cooldownSeconds;
    });
  }

  @override
  Widget build(BuildContext context) {
    final rn = RnSize.of(context);
    return _ModalCard(
      key: const Key('retry-session-modal'),
      padding: EdgeInsets.all(rn.s(16)),
      fixedWidthFactor: 0.8,
      closeButton: Positioned(
        top: 5,
        right: 7,
        child: GestureDetector(
          key: const Key('retry-session-modal-close'),
          behavior: HitTestBehavior.opaque,
          onTap: () => Navigator.of(context).pop(),
          child: Padding(
            padding: const EdgeInsets.all(6),
            child: SvgPicture.asset('assets/icons/close.svg'),
          ),
        ),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // styles.title: REPLAY_PRO.HEADLINE + body.large, medium weight.
          Text(
            ref.t('common.maxActiveUsers.title'),
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontFamily: AppFonts.replayProBold,
              fontSize: 16,
              height: 24 / 16,
              letterSpacing: 0.5,
              fontWeight: FontWeight.w500,
              color: AppColors.darkGray12,
            ),
          ),
          SvgPicture.asset('assets/icons/retrySession.svg'),
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 10),
            // styles.description: IBM_PLEX_SERIF.REGULAR + body.small.
            child: Text(
              ref.t('common.maxActiveUsers.description'),
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontFamily: AppFonts.ibmPlexSerifRegular,
                fontSize: 12,
                height: 16 / 12,
                letterSpacing: 0.2,
                color: AppColors.darkGray2,
              ),
            ),
          ),
          // styles.button: width auto, 20 horizontal padding.
          IntrinsicWidth(
            child: _RnButton(
            key: const Key('retry-session-modal-retry'),
            label: ref.t('common.retry'),
            paddingHorizontal: 20,
            isDisabled: _cooldown || _isRetrying,
            isLoading: _isRetrying,
            onPressed: _retry,
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 10),
            // RN renders these keys without `seconds` and appends the
            // count after them; the count is interpolated here instead so
            // the line doesn't read "…retry in s 30".
            child: Text(
              ref.t(
                _cooldown
                    ? 'common.maxActiveUsers.manualRetry'
                    : 'common.maxActiveUsers.autoRetry',
                {'seconds': _timeLeft},
              ),
              key: const Key('retry-session-modal-countdown'),
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontFamily: AppFonts.ibmPlexSerifRegular,
                fontSize: 10,
                height: 14 / 10,
                letterSpacing: 0.3,
                color: AppColors.darkGray16,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
