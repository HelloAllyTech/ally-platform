import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../../../core/localization/translate_ref.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_fonts.dart';
import 'debrief_sections.dart';

/// Ally's 32pt gradient avatar with the rank-badge sparkle (RN
/// `noteAvatar` / AskAI `rankBadgeGradient`).
class AllyAvatar extends StatelessWidget {
  const AllyAvatar({super.key, this.size = 32, this.iconSize = 12});

  final double size;
  final double iconSize;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        border: Border.all(color: AppColors.rankBadgeBorder, width: 0.6),
        gradient: const LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [AppColors.blue50, Colors.white],
        ),
      ),
      child: SvgPicture.asset('assets/icons/rankBadge.svg', width: iconSize, height: iconSize),
    );
  }
}

/// Port of RN `Debrief/SupervisorNote.tsx`: Ally's avatar, "from Ally" with
/// an "AI-generated" disclosure badge (tap for the tooltip), then the note
/// split into its sections. `**bold**` renders in IBM Plex Serif Medium and
/// each `[[msg:<id>]]` anchor becomes a "See this moment" chip that opens
/// that transcript row — or disappears when there's no transcript tab
/// ([onOpenMoment] null), since every sentence reads fine without it.
class SupervisorNote extends ConsumerWidget {
  const SupervisorNote({
    super.key,
    required this.note,
    this.onOpenMoment,
    this.hideClosing = false,
  });

  final String note;
  final ValueChanged<String>? onOpenMoment;

  /// Drops the `[closing]` invitation to reply (Logs: nothing to reply in).
  final bool hideClosing;

  static const paragraphStyle = TextStyle(
    fontFamily: AppFonts.ibmPlexSerifRegular,
    fontSize: 13,
    height: 19 / 13,
    color: AppColors.highEmphasis,
  );

  static const _labelStyle = TextStyle(
    fontFamily: AppFonts.ibmPlexSerifMedium,
    fontSize: 13,
    color: AppColors.highEmphasis,
  );

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    var sections = parseDebriefSections(note);
    if (hideClosing) sections = sections.where((s) => s.key != 'closing').toList();
    final momentLabel = ref.t('postSim.debrief.momentLabel');

    return Row(
      key: const Key('supervisor-note'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Padding(padding: EdgeInsets.only(top: 2), child: AllyAvatar()),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Text(ref.t('postSim.debrief.from'), style: _labelStyle),
                  const SizedBox(width: 8),
                  Tooltip(
                    key: const Key('debrief-ai-disclosure'),
                    triggerMode: TooltipTriggerMode.tap,
                    preferBelow: false,
                    showDuration: const Duration(seconds: 4),
                    constraints: const BoxConstraints(maxWidth: 260),
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    decoration: BoxDecoration(
                      color: AppColors.darkGray17,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    textStyle: const TextStyle(
                      fontFamily: AppFonts.ibmPlexSerifRegular,
                      fontSize: 12,
                      height: 16 / 12,
                      color: Colors.white,
                    ),
                    message: ref.t('postSim.debrief.aiTooltip'),
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                      decoration: BoxDecoration(
                        color: AppColors.blue50,
                        borderRadius: BorderRadius.circular(99),
                      ),
                      child: Text(
                        ref.t('postSim.debrief.aiLabel').toUpperCase(),
                        style: const TextStyle(
                          fontFamily: AppFonts.ibmPlexSerifMedium,
                          fontSize: 10,
                          letterSpacing: 0.3,
                          color: AppColors.primary,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              for (var i = 0; i < sections.length; i++) ...[
                if (i > 0) const SizedBox(height: 16),
                _Section(section: sections[i], momentLabel: momentLabel, onOpenMoment: onOpenMoment),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

class _Section extends ConsumerWidget {
  const _Section({required this.section, required this.momentLabel, this.onOpenMoment});

  final DebriefSection section;
  final String momentLabel;
  final ValueChanged<String>? onOpenMoment;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (section.isLabelled) ...[
          Text(
            ref.t('postSim.debrief.section.${section.key}').toUpperCase(),
            style: const TextStyle(
              fontFamily: AppFonts.ibmPlexSerifMedium,
              fontSize: 11,
              letterSpacing: 0.3,
              color: AppColors.mediumEmphasis,
            ),
          ),
          const SizedBox(height: 4),
        ],
        for (var i = 0; i < section.paragraphs.length; i++) ...[
          if (i > 0) const SizedBox(height: 10),
          Text.rich(_paragraphSpan(section.paragraphs[i])),
        ],
      ],
    );
  }

  TextSpan _paragraphSpan(String paragraph) {
    final children = <InlineSpan>[];
    final lines = paragraph.split('\n');
    for (var l = 0; l < lines.length; l++) {
      if (l > 0) children.add(const TextSpan(text: '\n'));
      for (final segment in parseNoteSegments(lines[l])) {
        switch (segment) {
          case NoteText(:final value):
            children.add(TextSpan(text: value));
          case NoteBold(:final value):
            children.add(
              TextSpan(text: value, style: const TextStyle(fontFamily: AppFonts.ibmPlexSerifMedium)),
            );
          case NoteMoment(:final messageId):
            final open = onOpenMoment;
            if (open == null) break;
            children.add(
              WidgetSpan(
                alignment: PlaceholderAlignment.baseline,
                baseline: TextBaseline.alphabetic,
                child: GestureDetector(
                  key: ValueKey('debrief-moment-$messageId'),
                  behavior: HitTestBehavior.opaque,
                  onTap: () => open(messageId),
                  child: ColoredBox(
                    color: AppColors.blue50,
                    child: Text(
                      ' $momentLabel ',
                      style: const TextStyle(
                        fontFamily: AppFonts.ibmPlexSerifMedium,
                        fontSize: 11,
                        color: AppColors.primary,
                      ),
                    ),
                  ),
                ),
              ),
            );
        }
      }
    }
    return TextSpan(style: SupervisorNote.paragraphStyle, children: children);
  }
}
