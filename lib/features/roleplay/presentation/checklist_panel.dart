import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../simulations/data/simulation_models.dart';

/// Mirrors ally-mobile (React Native)'s `ChecklistType` enum
/// (`src/types/simulations.ts`).
enum ChecklistMode { off, guided, unguided, list }

ChecklistMode checklistModeFromString(String? value) {
  switch (value) {
    case 'GUIDED':
      return ChecklistMode.guided;
    case 'UNGUIDED':
      return ChecklistMode.unguided;
    case 'LIST':
      return ChecklistMode.list;
    default:
      return ChecklistMode.off;
  }
}

/// Port of ally-mobile (React Native)'s `SessionChecklist` — the live
/// roleplay checklist, ticked off from `detected_event_ids` LiveKit
/// data-channel messages (see `roleplay_voice_screen.dart`). RN's dark
/// look: a `#1d2020` panel, an optional header (checklist icon, "Session
/// Checklist", "Progress: N of M completed" with N in green), then one
/// `#282B31` card per item with a green/grey tick circle, the name (or the
/// rank, in UNGUIDED mode until it's triggered) and, in GUIDED/LIST mode,
/// a chevron that expands the item's coaching message. The live screen
/// passes [hideHeader] (its tab bar already says "Checklist").
class ChecklistPanel extends StatefulWidget {
  const ChecklistPanel({
    super.key,
    required this.mode,
    required this.items,
    required this.triggeredEventIds,
    this.hideHeader = false,
  });

  final ChecklistMode mode;
  final List<ChecklistItem> items;
  final Set<String> triggeredEventIds;
  final bool hideHeader;

  @override
  State<ChecklistPanel> createState() => _ChecklistPanelState();
}

class _ChecklistPanelState extends State<ChecklistPanel> {
  final _expanded = <String>{};

  void _toggleExpand(String id) {
    setState(() {
      if (!_expanded.add(id)) _expanded.remove(id);
    });
  }

  static const _panel = Color(0xFF1D2020); // '#1d2020' literal

  @override
  Widget build(BuildContext context) {
    if (widget.mode == ChecklistMode.off) return const SizedBox.shrink();

    final sorted = [...widget.items]..sort((a, b) {
      final rankA = a.rank ?? 1 << 30;
      final rankB = b.rank ?? 1 << 30;
      if (rankA != rankB) return rankA.compareTo(rankB);
      return (b.score ?? 0).compareTo(a.score ?? 0);
    });
    final completedCount = sorted.where((item) => widget.triggeredEventIds.contains(item.id)).length;
    final isList = widget.mode == ChecklistMode.list;

    return Consumer(
      key: const ValueKey('checklist-panel'),
      builder: (context, ref, _) {
        const italic = TextStyle(
          fontFamily: AppFonts.ibmPlexSerifRegular,
          fontSize: 12,
          fontStyle: FontStyle.italic,
          color: AppColors.infoTabInactive,
        );
        return Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(color: _panel, borderRadius: BorderRadius.circular(8)),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (!widget.hideHeader)
                Padding(
                  padding: const EdgeInsets.only(left: 4, bottom: 24),
                  child: Row(
                    crossAxisAlignment: isList ? CrossAxisAlignment.center : CrossAxisAlignment.start,
                    children: [
                      Padding(
                        padding: EdgeInsets.only(top: isList ? 0 : 4, right: 16),
                        child: SvgPicture.asset(
                          'assets/icons/checklist.svg',
                          width: 40,
                          height: 40,
                          colorFilter: const ColorFilter.mode(Colors.white, BlendMode.srcIn),
                        ),
                      ),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              ref.t('simulationPage.sessionChecklist'),
                              style: const TextStyle(
                                fontFamily: AppFonts.ibmPlexSerifRegular,
                                fontSize: 18,
                                height: 22 / 18,
                                fontWeight: FontWeight.w500,
                                color: Colors.white,
                              ),
                            ),
                            if (!isList)
                              Padding(
                                padding: const EdgeInsets.only(top: 4),
                                child: Text.rich(
                                  TextSpan(
                                    style: italic,
                                    children: [
                                      TextSpan(text: '${ref.t('simulationPage.progress')}: '),
                                      TextSpan(
                                        text: '$completedCount',
                                        style: const TextStyle(color: AppColors.callGreen, fontWeight: FontWeight.bold),
                                      ),
                                      const TextSpan(text: ' of '),
                                      TextSpan(
                                        text: '${sorted.length} ${ref.t('simulationPage.completed')}',
                                        style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w500),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              Flexible(
                child: ListView.builder(
                  shrinkWrap: true,
                  padding: const EdgeInsets.only(bottom: 20, right: 4),
                  itemCount: sorted.length,
                  itemBuilder: (context, index) {
                    final item = sorted[index];
                    return _ChecklistRow(
                      item: item,
                      mode: widget.mode,
                      isTriggered: widget.triggeredEventIds.contains(item.id),
                      isExpanded: _expanded.contains(item.id),
                      onTap: () => _toggleExpand(item.id),
                    );
                  },
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _ChecklistRow extends StatelessWidget {
  const _ChecklistRow({
    required this.item,
    required this.mode,
    required this.isTriggered,
    required this.isExpanded,
    required this.onTap,
  });

  final ChecklistItem item;
  final ChecklistMode mode;
  final bool isTriggered;
  final bool isExpanded;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final showsName = mode == ChecklistMode.guided || mode == ChecklistMode.list;
    // GUIDED/LIST always show the name; UNGUIDED shows the rank until the
    // item is triggered — RN's `displayText`.
    final displayText = showsName ? item.name : (isTriggered ? item.name : (item.rank?.toString() ?? ''));
    final canExpand = showsName && (item.message ?? '').isNotEmpty;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(color: AppColors.darkGray10, borderRadius: BorderRadius.circular(16)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: canExpand ? onTap : null,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  if (mode != ChecklistMode.list) ...[
                    Container(
                      key: ValueKey('checklist-status-${item.id}'),
                      width: 24,
                      height: 24,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: isTriggered ? AppColors.callGreen : AppColors.callDivider,
                      ),
                      child: SvgPicture.asset(
                        'assets/icons/tick.svg',
                        width: 14,
                        height: 14,
                        colorFilter: ColorFilter.mode(
                          isTriggered ? Colors.black : const Color(0xFF25272A),
                          BlendMode.srcIn,
                        ),
                      ),
                    ),
                    const SizedBox(width: 4),
                  ],
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.only(left: 16),
                      child: Text(
                        displayText,
                        key: ValueKey('checklist-item-${item.id}'),
                        style: const TextStyle(
                          fontFamily: AppFonts.ibmPlexSerifRegular,
                          fontSize: 15,
                          fontWeight: FontWeight.w500,
                          color: Colors.white,
                        ),
                      ),
                    ),
                  ),
                  if (canExpand)
                    Opacity(
                      opacity: 0.7,
                      child: AnimatedRotation(
                        turns: isExpanded ? 0.5 : 0,
                        duration: const Duration(milliseconds: 150),
                        child: SizedBox(
                          width: 12,
                          height: 12,
                          child: SvgPicture.asset(
                            'assets/icons/chevronDown.svg',
                            colorFilter: const ColorFilter.mode(Colors.white, BlendMode.srcIn),
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
          if (canExpand && isExpanded)
            Padding(
              padding: const EdgeInsets.only(left: 56, right: 16, bottom: 16),
              child: Text(
                item.message!,
                style: const TextStyle(
                  fontFamily: AppFonts.ibmPlexSerifRegular,
                  fontSize: 13,
                  height: 20 / 13,
                  color: Color(0xFFB6B5B9),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
