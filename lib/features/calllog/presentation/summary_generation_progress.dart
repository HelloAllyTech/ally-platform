import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:lottie/lottie.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/theme/rn_scale.dart';

/// RN `constants/summary.ts` `SummaryGenerationStep` (English literals in
/// RN too, never translated).
const summaryGenerationSteps = <String>[
  'Generating transcription',
  'Deleting audio',
  'Segregating utterances',
  'Understanding conversation',
  'Charting flow',
  'Extracting key points',
  'Identifying themes',
  'Analysing',
  'Generating summary',
  'Enriching summary',
  'Validating summary',
];

/// RN `utils/callSummary.getEstimatedSummaryGenerationTime`: minutes,
/// scaled from one measured call (2503s of audio → 178s to summarise) with
/// a 1.2 buffer.
int estimatedSummaryGenerationMinutes(int callDurationSeconds) {
  final seconds = (178 * callDurationSeconds / 2503) * 1.2;
  return (seconds / 60).ceil();
}

/// Port of RN `SummaryGenerationProgress`: the Lottie + cycling ShinyText
/// step (every 3s, stopping on the last one), the 5s "transcription
/// generated & audio deleted" pill when the steps reach "Segregating
/// utterances", the ETA, and the failed / no-audio / generated variants.
/// [isLiveFlow] is RN's `currentChat` check: the live flow walks every
/// step, opening from the logs shows only the last three.
class SummaryGenerationProgress extends ConsumerStatefulWidget {
  const SummaryGenerationProgress({
    super.key,
    required this.summaryStatus,
    required this.isLiveFlow,
    this.callDurationSeconds = 0,
  });

  final String? summaryStatus;
  final bool isLiveFlow;
  final int callDurationSeconds;

  @override
  ConsumerState<SummaryGenerationProgress> createState() => _SummaryGenerationProgressState();
}

class _SummaryGenerationProgressState extends ConsumerState<SummaryGenerationProgress> {
  int _stepIndex = 0;
  bool _showGeneratedRow = false;
  Timer? _stepTimer;
  Timer? _generatedRowTimer;

  List<String> get _steps => widget.isLiveFlow ? summaryGenerationSteps : summaryGenerationSteps.sublist(8);

  @override
  void initState() {
    super.initState();
    _onStep();
    _stepTimer = Timer.periodic(const Duration(seconds: 3), (timer) {
      if (_stepIndex >= _steps.length - 1) {
        timer.cancel();
        return;
      }
      setState(() => _stepIndex++);
      _onStep();
    });
  }

  void _onStep() {
    if (_steps[_stepIndex] == 'Segregating utterances' && !_showGeneratedRow) {
      _showGeneratedRow = true;
      _generatedRowTimer = Timer(const Duration(seconds: 5), () {
        if (mounted) setState(() => _showGeneratedRow = false);
      });
    }
  }

  @override
  void dispose() {
    _stepTimer?.cancel();
    _generatedRowTimer?.cancel();
    super.dispose();
  }

  static const _title = TextStyle(fontFamily: AppFonts.replayProBold, fontSize: 20, color: AppColors.darkSlate);

  Widget _separator(BuildContext context) => FractionallySizedBox(
    widthFactor: 0.85,
    child: Container(height: 0.5, margin: const EdgeInsets.only(top: 56, bottom: 16), color: AppColors.lightGray4),
  );

  Widget _pill(
    BuildContext context, {
    required String icon,
    required String text,
    required Color color,
    Color? background,
  }) {
    final rn = RnSize.of(context);
    return Container(
      padding: EdgeInsets.symmetric(vertical: rn.vs(4), horizontal: 8),
      decoration: BoxDecoration(
        color: background,
        border: Border.all(color: color, width: 0.4),
        borderRadius: BorderRadius.circular(rn.s(16)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          SvgPicture.asset(icon),
          const SizedBox(width: 8),
          Text(
            text,
            style: TextStyle(fontFamily: AppFonts.robotoRegular, fontSize: 14, color: color),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final status = widget.summaryStatus;
    if (status == 'FAILED' || status == 'NO_AUDIO') {
      return Container(
        width: double.infinity,
        color: Colors.white,
        padding: const EdgeInsets.only(top: 28),
        child: Column(
          children: [
            if (status == 'NO_AUDIO')
              _pill(
                context,
                icon: 'assets/icons/hexagonClose.svg',
                text: ref.t('calls.status.noAudio'),
                color: AppColors.brickRed,
              ),
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 40),
              child: Image.asset('assets/images/summaryFailed.png'),
            ),
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Text(ref.t('summaryLoading.failedTitle'), style: _title, textAlign: TextAlign.center),
            ),
            _separator(context),
          ],
        ),
      );
    }

    final isGenerated = status == 'SUCCESS';
    return Stack(
      alignment: Alignment.topCenter,
      children: [
        Container(
          width: double.infinity,
          color: Colors.white,
          padding: const EdgeInsets.only(top: 28),
          child: Column(
            children: [
              if (isGenerated)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 40),
                  child: Image.asset('assets/images/summaryGenerated.png'),
                )
              else
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: AspectRatio(
                    aspectRatio: 16 / 9,
                    child: Lottie.asset('assets/animations/summaryLoading.json', fit: BoxFit.contain),
                  ),
                ),
              if (!isGenerated)
                Padding(
                  padding: const EdgeInsets.only(top: 8, bottom: 24),
                  child: Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: ShinyText('${_steps[_stepIndex]}...', style: _title),
                  ),
                )
              else
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Text(ref.t('summaryLoading.generated'), style: _title, textAlign: TextAlign.center),
                ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: Opacity(
                  opacity: 0.7,
                  child: Text(
                    isGenerated
                        ? ref.t('summaryLoading.generatedDesc')
                        : ref.t('summaryLoading.processingDescMain${widget.isLiveFlow ? '' : '2'}'),
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontFamily: AppFonts.ibmPlexSerifRegular,
                      fontSize: 16,
                      color: AppColors.darkSlate,
                    ),
                  ),
                ),
              ),
              if (!isGenerated)
                Padding(
                  padding: const EdgeInsets.only(top: 16),
                  child: Opacity(
                    opacity: 0.8,
                    child: Text(
                      ref.t('summaryLoading.estimatedTime', {
                        'time': estimatedSummaryGenerationMinutes(widget.callDurationSeconds),
                      }),
                      style: const TextStyle(
                        fontFamily: AppFonts.ibmPlexSerifRegular,
                        fontSize: 12,
                        color: AppColors.mediumGray2,
                      ),
                    ),
                  ),
                ),
              _separator(context),
            ],
          ),
        ),
        if (_showGeneratedRow)
          Positioned(
            // RN: absolute `top: 2` + `marginTop: 16` from the container.
            top: 2 + 16,
            child: _pill(
              context,
              icon: 'assets/icons/shieldWithTick.svg',
              text: ref.t('summaryLoading.transcriptionDeleted'),
              color: AppColors.azureBlue,
              background: AppColors.iceBlue,
            ),
          ),
      ],
    );
  }
}

/// Port of RN `components/ShinyText`: the text with a 300-wide white
/// (0 → 0.8 → 0 alpha) band sweeping across its glyphs, -300 → 300 every
/// 2.5s (`speed` 5 × 500ms).
class ShinyText extends StatefulWidget {
  const ShinyText(this.text, {super.key, required this.style});

  final String text;
  final TextStyle style;

  @override
  State<ShinyText> createState() => _ShinyTextState();
}

class _ShinyTextState extends State<ShinyText> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 2500),
  )..repeat();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        final dx = -300 + 600 * _controller.value;
        return ShaderMask(
          blendMode: BlendMode.srcATop,
          shaderCallback: (bounds) =>
              const LinearGradient(colors: [Color(0x00FFFFFF), Color(0xCCFFFFFF), Color(0x00FFFFFF)])
                  .createShader(Rect.fromLTWH(dx, 0, 300, bounds.height)),
          child: child,
        );
      },
      child: Text(widget.text, style: widget.style, textAlign: TextAlign.center),
    );
  }
}

/// Port of RN `SummaryGenerationProgress/AddNotesSection`: a collapsible
/// "Add Notes (optional)" row (chevron rotated -90° when closed, page icon,
/// IBM Plex Serif Medium 14) with an info tooltip, opening onto a bulleted
/// multiline note. Every keystroke goes to [onNoteChange] (the caller
/// debounces the `POST /chats/:id/notes`). [savedNotes] re-seeds the field
/// only while it isn't focused, as RN does.
class AddNotesSection extends ConsumerStatefulWidget {
  const AddNotesSection({super.key, required this.savedNotes, required this.onNoteChange});

  final String savedNotes;
  final ValueChanged<String> onNoteChange;

  @override
  ConsumerState<AddNotesSection> createState() => _AddNotesSectionState();
}

class _AddNotesSectionState extends ConsumerState<AddNotesSection> {
  bool _isExpanded = false;
  late final TextEditingController _controller = TextEditingController(text: widget.savedNotes);
  final _focusNode = FocusNode();

  @override
  void didUpdateWidget(AddNotesSection oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.savedNotes != oldWidget.savedNotes && !_focusNode.hasFocus) {
      _controller.text = widget.savedNotes;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      color: Colors.white,
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.only(left: 8, right: 8, bottom: 200),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(
              children: [
                Expanded(
                  child: GestureDetector(
                    key: const Key('add-notes-header'),
                    behavior: HitTestBehavior.opaque,
                    onTap: () => setState(() => _isExpanded = !_isExpanded),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      child: Row(
                        children: [
                          Padding(
                            padding: const EdgeInsets.only(left: 4, right: 10),
                            child: Transform.rotate(
                              angle: _isExpanded ? 0 : -1.5707963267948966,
                              child: SvgPicture.asset('assets/icons/arrowDown.svg', width: 20, height: 20),
                            ),
                          ),
                          SvgPicture.asset('assets/icons/page.svg'),
                          const SizedBox(width: 8),
                          Flexible(
                            child: Text(
                              ref.t('summaryLoading.addNotes'),
                              style: const TextStyle(
                                fontFamily: AppFonts.ibmPlexSerifMedium,
                                fontSize: 14,
                                color: AppColors.darkSlate,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
                Tooltip(
                  key: const Key('add-notes-info'),
                  triggerMode: TooltipTriggerMode.tap,
                  showDuration: const Duration(seconds: 5),
                  margin: const EdgeInsets.symmetric(horizontal: 40),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(8),
                    boxShadow: const [BoxShadow(color: Color(0x33000000), blurRadius: 8)],
                  ),
                  textStyle: const TextStyle(color: Colors.black, fontSize: 14),
                  message: ref.t('summaryLoading.notesTooltip'),
                  child: Padding(padding: const EdgeInsets.all(8), child: SvgPicture.asset('assets/icons/info.svg')),
                ),
              ],
            ),
          ),
          if (_isExpanded)
            Padding(
              padding: const EdgeInsets.only(left: 16, right: 16, bottom: 16),
              child: Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Padding(
                      padding: EdgeInsets.only(right: 8),
                      child: Text(
                        '•',
                        style: TextStyle(fontFamily: 'CupertinoSystemText', fontSize: 16, color: AppColors.darkSlate),
                      ),
                    ),
                    Expanded(
                      child: TextField(
                        key: const Key('add-notes-input'),
                        controller: _controller,
                        focusNode: _focusNode,
                        onChanged: widget.onNoteChange,
                        minLines: 1,
                        maxLines: null,
                        keyboardType: TextInputType.multiline,
                        style: const TextStyle(
                          fontFamily: AppFonts.ibmPlexSerifRegular,
                          fontSize: 14,
                          color: AppColors.darkSlate,
                        ),
                        decoration: InputDecoration(
                          isCollapsed: true,
                          border: InputBorder.none,
                          constraints: const BoxConstraints(minHeight: 24),
                          hintText: ref.t('callSummary.enterNote'),
                          hintStyle: const TextStyle(
                            fontFamily: AppFonts.ibmPlexSerifRegular,
                            fontSize: 14,
                            color: AppColors.lightGray3,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// RN `CallSummaryScreen.renderSummaryButtons`: the white footer under the
/// progress view — a pill "See if its ready" / "Retry" / "Setting up…"
/// button (spinner while busy; hidden for NO_AUDIO) and, unless busy, the
/// "I'll check later" button (bordered only for NO_AUDIO).
class SummaryProgressButtons extends ConsumerWidget {
  const SummaryProgressButtons({
    super.key,
    required this.summaryStatus,
    required this.isBusy,
    required this.label,
    required this.onPrimary,
    required this.onCheckLater,
  });

  final String? summaryStatus;
  final bool isBusy;
  final String label;
  final VoidCallback onPrimary;
  final VoidCallback onCheckLater;

  static const _text = TextStyle(
    fontFamily: AppFonts.robotoRegular,
    fontWeight: FontWeight.w600,
    fontSize: 16,
    color: AppColors.darkGray10,
  );

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final rn = RnSize.of(context);
    final isNoAudio = summaryStatus == 'NO_AUDIO';
    return Container(
      color: Colors.white,
      padding: const EdgeInsets.only(left: 24, right: 24, top: 10, bottom: 46),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (!isNoAudio)
            Padding(
              padding: const EdgeInsets.only(bottom: 8 + 10),
              child: GestureDetector(
                key: const Key('summary-progress-primary'),
                onTap: isBusy ? null : onPrimary,
                child: Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    border: Border.all(color: AppColors.lightGray4),
                    borderRadius: BorderRadius.circular(24),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      if (isBusy) ...[
                        const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator.adaptive(
                            valueColor: AlwaysStoppedAnimation(AppColors.azureBlue),
                          ),
                        ),
                        const SizedBox(width: 10),
                      ],
                      Flexible(
                        child: Text(label, style: _text, textAlign: TextAlign.center),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          if (!isBusy)
            GestureDetector(
              key: const Key('summary-progress-check-later'),
              onTap: onCheckLater,
              child: Container(
                width: double.infinity,
                constraints: BoxConstraints(minHeight: rn.vs(44)),
                margin: const EdgeInsets.only(bottom: 4),
                padding: EdgeInsets.symmetric(vertical: isNoAudio ? 10 : 2),
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(999),
                  border: isNoAudio ? Border.all(color: AppColors.lightGray4) : null,
                ),
                child: Text(
                  ref.t('summaryLoading.checkLater'),
                  style: _text.copyWith(height: 22 / 16, letterSpacing: 0.2),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
