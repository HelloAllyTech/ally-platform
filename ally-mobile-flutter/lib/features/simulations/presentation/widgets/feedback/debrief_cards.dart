import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../../core/localization/translate_ref.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_fonts.dart';
import '../../../data/learner_debrief_repository.dart';
import 'learner_debrief_controller.dart';

/// Port of the web helpline's `DebriefCards.tsx` + `DebriefCardFeedback.tsx`:
/// the Debrief agent's debrief as structured cards. Only mounted when the
/// learner's organisation is switched on — [LearnerDebriefController.view]
/// is null otherwise and [DebriefTab] keeps today's debrief.
///
/// No score, no percentage and no red anywhere: amber marks what needs
/// attention, and every status carries text plus an icon, never colour alone.
class DebriefCards extends ConsumerWidget {
  const DebriefCards({super.key, required this.controller});

  final LearnerDebriefController controller;

  static const _k = 'postSim.debriefCards';

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return ListenableBuilder(
      listenable: controller,
      builder: (context, _) {
        final view = controller.view;
        if (view == null) return const SizedBox.shrink();
        final Widget content = switch (view.state) {
          LearnerDebriefState.working => _Working(latestStep: view.steps.isEmpty ? null : view.steps.last),
          LearnerDebriefState.onItsWay => _Body(ref.t('$_k.onItsWay'), key: const Key('debrief-on-its-way')),
          LearnerDebriefState.tooShort => _Body(ref.t('$_k.tooShort'), key: const Key('debrief-too-short')),
          LearnerDebriefState.ready when view.cards != null => _ReadyCards(
            cards: view.cards!,
            view: view,
            controller: controller,
          ),
          _ => const SizedBox.shrink(),
        };
        return _Frame(
          title: ref.t('$_k.header'),
          aiLabel: ref.t('$_k.aiLabel'),
          child: ListView(
            key: const Key('debrief-cards'),
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
            children: [content],
          ),
        );
      },
    );
  }
}

/// The same gradient frame as today's debrief ([AskAiGradientCard]), with
/// the "Written by Ally (AI)" label beside the title.
class _Frame extends StatelessWidget {
  const _Frame({required this.title, required this.aiLabel, required this.child});

  final String title;
  final String aiLabel;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(16),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [AppColors.primary, AppColors.blue100, AppColors.brandLogo],
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 12, 8),
            child: Row(
              children: [
                Expanded(
                  child: Semantics(
                    header: true,
                    child: Text(
                      title,
                      style: const TextStyle(
                        fontFamily: AppFonts.ibmPlexSerifMedium,
                        fontSize: 14,
                        height: 20 / 14,
                        letterSpacing: 0.25,
                        color: Colors.white,
                      ),
                    ),
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 2),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.9),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    aiLabel,
                    style: const TextStyle(
                      fontFamily: AppFonts.ibmPlexSerifMedium,
                      fontSize: 11,
                      color: AppColors.highEmphasis,
                    ),
                  ),
                ),
              ],
            ),
          ),
          Expanded(
            child: Container(
              margin: const EdgeInsets.only(left: 4, right: 4, bottom: 4),
              clipBehavior: Clip.antiAlias,
              decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12)),
              child: child,
            ),
          ),
        ],
      ),
    );
  }
}

const _bodyStyle = TextStyle(
  fontFamily: AppFonts.ibmPlexSerifRegular,
  fontSize: 14,
  height: 1.5,
  color: AppColors.highEmphasis,
);

const _smallStyle = TextStyle(
  fontFamily: AppFonts.ibmPlexSerifRegular,
  fontSize: 12,
  height: 1.4,
  color: AppColors.mediumEmphasis,
);

const _leadStyle = TextStyle(
  fontFamily: AppFonts.ibmPlexSerifMedium,
  fontSize: 14,
  height: 1.4,
  color: AppColors.highEmphasis,
);

/// Amber for "needs attention" — never red.
const _amberStrong = Color(0xFFB45309);
const _amberBorder = AppColors.warning;
const _amberFill = AppColors.amber50;

class _Body extends StatelessWidget {
  const _Body(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) => Text(text, style: _bodyStyle);
}

class _Lead extends StatelessWidget {
  const _Lead(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Text(text, style: _leadStyle);
}

class _Quote extends StatelessWidget {
  const _Quote(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.only(left: 12),
      decoration: const BoxDecoration(border: Border(left: BorderSide(color: AppColors.blue100, width: 2))),
      child: Text(
        '“$text”',
        style: _bodyStyle.copyWith(fontStyle: FontStyle.italic, color: AppColors.mediumEmphasis),
      ),
    );
  }
}

/// One card: a heading with an icon, then its content.
class _Card extends StatelessWidget {
  const _Card({super.key, required this.title, required this.icon, required this.children, this.attention = false});

  final String title;
  final Widget icon;
  final List<Widget> children;
  final bool attention;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: attention ? _amberFill : Colors.white,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: attention ? _amberBorder : AppColors.blue50, width: attention ? 2 : 1),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Semantics(
            header: true,
            child: Row(
              children: [
                icon,
                const SizedBox(width: 8),
                Expanded(child: Text(title, style: _leadStyle.copyWith(fontSize: 16))),
              ],
            ),
          ),
          for (final child in children) ...[const SizedBox(height: 12), child],
        ],
      ),
    );
  }
}

/// A working state: calm, no percentage. The spinner stops under the
/// system's reduce-motion setting.
class _Working extends ConsumerWidget {
  const _Working({required this.latestStep});

  final String? latestStep;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final reduceMotion = MediaQuery.maybeDisableAnimationsOf(context) ?? false;
    final step = (latestStep == null || latestStep!.trim().isEmpty)
        ? ref.t('postSim.debriefCards.working.defaultStep')
        : latestStep!;
    return Semantics(
      liveRegion: true,
      child: Container(
        key: const Key('debrief-working'),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: AppColors.blue50,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: AppColors.blue100),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 20,
              height: 20,
              child: reduceMotion
                  ? const Icon(Icons.edit_note, key: Key('debrief-working-static'), size: 20, color: AppColors.primary)
                  : const CircularProgressIndicator(strokeWidth: 2, color: AppColors.primary),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(ref.t('postSim.debriefCards.working.title'), style: _leadStyle),
                  const SizedBox(height: 4),
                  Text(step, style: _bodyStyle.copyWith(color: AppColors.mediumEmphasis)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ReadyCards extends ConsumerWidget {
  const _ReadyCards({required this.cards, required this.view, required this.controller});

  final DebriefCardsData cards;
  final LearnerDebriefView view;
  final LearnerDebriefController controller;

  static const _k = 'postSim.debriefCards';

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Sections keep their stored index, the one a flag and a correction name.
    final removed = {for (final c in view.corrections) if (c.removed) c.section};
    DebriefMyFlag? flagFor(String section) => view.flags.where((f) => f.section == section).firstOrNull;
    DebriefCorrection? correctionFor(String section) =>
        view.corrections.where((c) => c.section == section).firstOrNull;
    Widget flag(String section, String cardLabel) => CardFlag(
      key: ValueKey('debrief-flag-$section'),
      controller: controller,
      section: section,
      cardLabel: cardLabel,
      flag: flagFor(section),
      correction: correctionFor(section),
    );

    final moment = removed.contains('important_moment') ? null : cards.importantMoment;
    final worked = [
      for (var i = 0; i < cards.whatWorked.length; i++)
        if (!removed.contains('what_worked[$i]')) (index: i, item: cards.whatWorked[i]),
    ];
    final growth = [
      for (var i = 0; i < cards.workOnThis.length; i++)
        if (!removed.contains('work_on_this[$i]')) (index: i, item: cards.workOnThis[i]),
    ];
    final practise = removed.contains('practise_next') ? null : cards.practiseNext;
    final momentTitle = ref.t('$_k.importantMoment.title');
    final practiseTitle = ref.t('$_k.practiseNext');

    final children = <Widget>[
      if (moment != null)
        _Card(
          key: const Key('debrief-card-important-moment'),
          attention: true,
          title: momentTitle,
          icon: const Icon(Icons.bookmark_outline, size: 20, color: _amberStrong),
          children: [
            _Lead(moment.lead),
            _Quote(moment.quote),
            _Body(moment.body),
            if (moment.others.isNotEmpty)
              Column(
                key: const Key('debrief-other-moments'),
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _Lead(ref.t('$_k.importantMoment.others')),
                  for (final other in moment.others) ...[
                    const SizedBox(height: 8),
                    _Quote(other.quote),
                    const SizedBox(height: 4),
                    _Body(other.note),
                  ],
                ],
              ),
            _Body(ref.t('$_k.importantMoment.support')),
            flag('important_moment', momentTitle),
          ],
        ),
      Text(cards.opening, key: const Key('debrief-card-opening'), style: _bodyStyle.copyWith(fontSize: 15)),
      if (worked.isNotEmpty)
        _Card(
          key: const Key('debrief-card-what-worked'),
          title: ref.t('$_k.whatWorked'),
          icon: const Icon(Icons.thumb_up_outlined, size: 20, color: AppColors.success),
          children: [
            for (final (:index, :item) in worked)
              _Item(
                children: [
                  _Lead(item.lead),
                  _Quote(item.quote),
                  _Body(item.body),
                  flag('what_worked[$index]', item.lead),
                ],
              ),
          ],
        ),
      if (growth.isNotEmpty)
        _Card(
          key: const Key('debrief-card-work-on-this'),
          title: ref.t('$_k.workOnThis'),
          icon: const Icon(Icons.track_changes, size: 20, color: _amberStrong),
          children: [
            for (final (:index, :item) in growth)
              _Item(
                children: [
                  _Lead(item.lead),
                  _Quote(item.quote),
                  _Body(item.why),
                  _TrySaying(label: ref.t('$_k.trySaying'), text: item.trySaying),
                  flag('work_on_this[$index]', item.lead),
                ],
              ),
          ],
        ),
      if (practise != null)
        _Card(
          key: const Key('debrief-card-practise-next'),
          title: practiseTitle,
          icon: const Icon(Icons.eco_outlined, size: 20, color: AppColors.primary),
          children: [
            _Lead(practise.skill),
            _Body(practise.reason),
            flag('practise_next', practiseTitle),
          ],
        ),
      if (cards.skillWords.isNotEmpty)
        _Card(
          key: const Key('debrief-card-skill-words'),
          title: ref.t('$_k.skillWords.title'),
          icon: const Icon(Icons.star_outline, size: 20, color: AppColors.primary),
          children: [
            for (final entry in cards.skillWords)
              Wrap(
                spacing: 8,
                runSpacing: 4,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  Text(entry.skill, style: _leadStyle),
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      _skillWordIcon(entry.word),
                      const SizedBox(width: 4),
                      Flexible(
                        child: Text(
                          ref.t('$_k.skillWords.${entry.word.wire}'),
                          style: _bodyStyle.copyWith(color: AppColors.mediumEmphasis),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
          ],
        ),
      if (cards.progressNote != null)
        _Card(
          key: const Key('debrief-card-progress-note'),
          title: ref.t('$_k.progressNote'),
          icon: const Icon(Icons.trending_up, size: 20, color: AppColors.primary),
          children: [_Body(cards.progressNote!)],
        ),
      _Card(
        key: const Key('debrief-card-reflective-question'),
        title: ref.t('$_k.reflectiveQuestion'),
        icon: const Icon(Icons.help_outline, size: 20, color: AppColors.primary),
        children: [_Body(cards.reflectiveQuestion)],
      ),
      if (removed.isNotEmpty)
        Text(ref.t('$_k.corrections.removed'), key: const Key('debrief-removed-note'), style: _smallStyle),
      _Helpful(controller: controller, helpful: view.helpful),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (var i = 0; i < children.length; i++) ...[if (i > 0) const SizedBox(height: 16), children[i]],
      ],
    );
  }

  static Widget _skillWordIcon(DebriefSkillWord word) => switch (word) {
    DebriefSkillWord.strength => const Icon(Icons.star, size: 16, color: AppColors.success),
    DebriefSkillWord.keepPractising => const Icon(Icons.eco_outlined, size: 16, color: _amberStrong),
    DebriefSkillWord.didntComeUp => const Icon(Icons.radio_button_unchecked, size: 16, color: AppColors.iconDefault),
  };
}

/// One point inside a card that holds several.
class _Item extends StatelessWidget {
  const _Item({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (var i = 0; i < children.length; i++) ...[if (i > 0) const SizedBox(height: 8), children[i]],
      ],
    );
  }
}

/// The distinct "Try saying:" line on a Work-on-this point.
class _TrySaying extends StatelessWidget {
  const _TrySaying({required this.label, required this.text});

  final String label;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const Key('debrief-try-saying'),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: const BoxDecoration(
        color: _amberFill,
        border: Border(left: BorderSide(color: _amberBorder, width: 4)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Padding(
            padding: EdgeInsets.only(top: 2),
            child: Icon(Icons.format_quote, size: 16, color: _amberStrong),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text.rich(
              TextSpan(
                children: [
                  TextSpan(text: '$label ', style: _leadStyle),
                  TextSpan(text: text),
                ],
              ),
              style: _bodyStyle,
            ),
          ),
        ],
      ),
    );
  }
}

/// A text button with at least a 44pt touch target.
class _LinkButton extends StatelessWidget {
  const _LinkButton({super.key, required this.label, required this.onPressed, this.icon, this.semanticLabel});

  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final String? semanticLabel;

  @override
  Widget build(BuildContext context) {
    final button = TextButton(
      onPressed: onPressed,
      style: TextButton.styleFrom(
        minimumSize: const Size(44, 44),
        padding: const EdgeInsets.symmetric(horizontal: 8),
        foregroundColor: AppColors.mediumEmphasis,
        textStyle: _smallStyle.copyWith(fontSize: 13, decoration: TextDecoration.underline),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[Icon(icon, size: 14), const SizedBox(width: 4)],
          Text(label),
        ],
      ),
    );
    if (semanticLabel == null) return button;
    return Semantics(label: semanticLabel, excludeSemantics: true, button: true, child: button);
  }
}

/// "This isn't right" for one card: pick a reason, add a note if you like,
/// send, and undo while the undo window is open. A reviewed flag shows what
/// the Ally team decided instead of the control.
class CardFlag extends ConsumerStatefulWidget {
  const CardFlag({
    super.key,
    required this.controller,
    required this.section,
    required this.cardLabel,
    this.flag,
    this.correction,
  });

  final LearnerDebriefController controller;
  final String section;
  final String cardLabel;
  final DebriefMyFlag? flag;
  final DebriefCorrection? correction;

  @override
  ConsumerState<CardFlag> createState() => _CardFlagState();
}

class _CardFlagState extends ConsumerState<CardFlag> {
  static const _k = 'postSim.debriefCards.flag';

  final _note = TextEditingController();
  bool _open = false;
  DebriefFlagReason? _reason;
  bool _sending = false;
  bool _failed = false;
  bool _undoing = false;
  Timer? _undoTimer;

  @override
  void initState() {
    super.initState();
    _scheduleUndoExpiry();
  }

  @override
  void didUpdateWidget(CardFlag oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.flag?.id != widget.flag?.id || oldWidget.flag?.canUndoUntil != widget.flag?.canUndoUntil) {
      _scheduleUndoExpiry();
    }
  }

  /// Re-render when the undo window closes, so Undo does not outlive it.
  void _scheduleUndoExpiry() {
    _undoTimer?.cancel();
    final until = widget.flag?.canUndoUntil;
    if (until == null) return;
    final remaining = until.difference(DateTime.now());
    if (remaining.isNegative) return;
    _undoTimer = Timer(remaining + const Duration(milliseconds: 50), () {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _undoTimer?.cancel();
    _note.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final reason = _reason;
    if (reason == null || _sending) return;
    setState(() {
      _sending = true;
      _failed = false;
    });
    final note = _note.text.trim();
    try {
      await widget.controller.flagCard(section: widget.section, reason: reason, note: note.isEmpty ? null : note);
      if (!mounted) return;
      setState(() {
        _sending = false;
        _open = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _sending = false;
        _failed = true;
      });
    }
  }

  Future<void> _undo(String flagId) async {
    setState(() => _undoing = true);
    await widget.controller.undoFlag(flagId);
    if (mounted) setState(() => _undoing = false);
  }

  @override
  Widget build(BuildContext context) {
    final correction = widget.correction;
    if (correction != null && !correction.removed) {
      return Text(
        ref.t('postSim.debriefCards.corrections.kept', {'note': correction.note ?? ''}).trim(),
        key: const Key('debrief-correction'),
        style: _smallStyle,
      );
    }

    final flag = widget.flag;
    if (flag != null) {
      final canUndo = flag.canUndoAt(DateTime.now());
      return Semantics(
        liveRegion: true,
        child: Wrap(
          key: const Key('debrief-flag-status'),
          crossAxisAlignment: WrapCrossAlignment.center,
          spacing: 4,
          children: [
            Text(ref.t(canUndo ? '$_k.sent' : '$_k.waiting'), style: _smallStyle),
            if (canUndo)
              _LinkButton(
                key: const Key('debrief-flag-undo'),
                label: ref.t('$_k.undo'),
                onPressed: _undoing ? null : () => _undo(flag.id),
              ),
          ],
        ),
      );
    }

    if (!_open) {
      return Align(
        alignment: Alignment.centerLeft,
        child: _LinkButton(
          key: const Key('debrief-flag-open'),
          label: ref.t('$_k.open'),
          icon: Icons.outlined_flag,
          semanticLabel: ref.t('$_k.openLabel', {'card': widget.cardLabel}),
          onPressed: () => setState(() => _open = true),
        ),
      );
    }

    return Container(
      key: const Key('debrief-flag-form'),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.blue50,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.blue100),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Semantics(header: true, child: Text(ref.t('$_k.question'), style: _leadStyle)),
          const SizedBox(height: 4),
          for (final reason in DebriefFlagReason.values)
            _ReasonOption(
              key: ValueKey('debrief-flag-reason-${reason.wire}'),
              label: ref.t('$_k.reasons.${reason.wire}'),
              selected: _reason == reason,
              onTap: () => setState(() => _reason = reason),
            ),
          const SizedBox(height: 8),
          Text(ref.t('$_k.noteLabel'), style: _bodyStyle),
          const SizedBox(height: 4),
          TextField(
            key: const Key('debrief-flag-note'),
            controller: _note,
            minLines: 2,
            maxLines: 4,
            maxLength: 1000,
            style: _bodyStyle,
            decoration: InputDecoration(
              isDense: true,
              filled: true,
              fillColor: Colors.white,
              counterText: '',
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(6),
                borderSide: const BorderSide(color: AppColors.blue100),
              ),
            ),
          ),
          if (_failed) ...[
            const SizedBox(height: 8),
            Semantics(
              liveRegion: true,
              child: Text(ref.t('$_k.failed'), key: const Key('debrief-flag-failed'), style: _bodyStyle),
            ),
          ],
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              FilledButton(
                key: const Key('debrief-flag-send'),
                onPressed: (_reason == null || _sending) ? null : _submit,
                style: FilledButton.styleFrom(
                  minimumSize: const Size(64, 44),
                  backgroundColor: AppColors.primary,
                  textStyle: _leadStyle,
                ),
                child: Text(ref.t(_sending ? '$_k.sending' : '$_k.send')),
              ),
              _LinkButton(
                key: const Key('debrief-flag-cancel'),
                label: ref.t('$_k.cancel'),
                onPressed: () => setState(() {
                  _open = false;
                  _failed = false;
                }),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// One radio choice in the flag form, a full-width 44pt row.
class _ReasonOption extends StatelessWidget {
  const _ReasonOption({super.key, required this.label, required this.selected, required this.onTap});

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      inMutuallyExclusiveGroup: true,
      checked: selected,
      selected: selected,
      button: true,
      child: InkWell(
        onTap: onTap,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 44),
          child: Row(
            children: [
              Icon(
                selected ? Icons.radio_button_checked : Icons.radio_button_unchecked,
                size: 20,
                color: selected ? AppColors.primary : AppColors.iconDefault,
              ),
              const SizedBox(width: 8),
              Expanded(child: Text(label, style: _bodyStyle)),
            ],
          ),
        ),
      ),
    );
  }
}

/// "Was this helpful?" at the end of the debrief; answering again changes it.
class _Helpful extends ConsumerWidget {
  const _Helpful({required this.controller, required this.helpful});

  final LearnerDebriefController controller;
  final bool? helpful;

  static const _k = 'postSim.debriefCards.helpful';

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    Widget choice(bool value, String label, IconData icon) {
      final pressed = helpful == value;
      return Semantics(
        toggled: pressed,
        child: OutlinedButton.icon(
          key: Key('debrief-helpful-${value ? 'yes' : 'no'}'),
          onPressed: controller.helpfulSending ? null : () => controller.setHelpful(value),
          icon: Icon(icon, size: 16),
          label: Text(label),
          style: OutlinedButton.styleFrom(
            minimumSize: const Size(64, 44),
            foregroundColor: AppColors.highEmphasis,
            backgroundColor: pressed ? AppColors.blue50 : Colors.white,
            side: BorderSide(color: pressed ? AppColors.primary : AppColors.blue100, width: pressed ? 2 : 1),
            textStyle: pressed ? _leadStyle : _bodyStyle,
          ),
        ),
      );
    }

    return Wrap(
      key: const Key('debrief-helpful'),
      spacing: 8,
      runSpacing: 8,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        Text(ref.t('$_k.question'), style: _leadStyle),
        choice(true, ref.t('$_k.yes'), Icons.thumb_up_outlined),
        choice(false, ref.t('$_k.no'), Icons.thumb_down_outlined),
        if (helpful != null) Semantics(liveRegion: true, child: Text(ref.t('$_k.thanks'), style: _smallStyle)),
      ],
    );
  }
}
