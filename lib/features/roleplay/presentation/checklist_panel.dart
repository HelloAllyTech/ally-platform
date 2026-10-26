import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
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

/// Scoped port of ally-mobile (React Native)'s `SessionChecklist` — the live
/// roleplay checklist, populated by `detected_event_ids` LiveKit
/// data-channel messages (see `roleplay_voice_screen.dart`'s
/// `_detectedEventIds`). RN nests this under a Checklist/Reminders/
/// Description tab bar the Flutter screen has no equivalent of yet (neither
/// "Reminders" nor a description tab exist here); rather than build tab
/// chrome around features that don't exist, this renders standalone,
/// matching RN's own `hideHeader: false` (always-shown header) case.
class ChecklistPanel extends StatefulWidget {
  const ChecklistPanel({
    super.key,
    required this.mode,
    required this.items,
    required this.triggeredEventIds,
  });

  final ChecklistMode mode;
  final List<ChecklistItem> items;
  final Set<String> triggeredEventIds;

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

  @override
  Widget build(BuildContext context) {
    if (widget.mode == ChecklistMode.off) return const SizedBox.shrink();

    final sorted = [...widget.items]..sort((a, b) {
      final rankA = a.rank ?? 1 << 30;
      final rankB = b.rank ?? 1 << 30;
      if (rankA != rankB) return rankA.compareTo(rankB);
      return (b.score ?? 0).compareTo(a.score ?? 0);
    });
    final completedCount = sorted
        .where((item) => widget.triggeredEventIds.contains(item.id))
        .length;

    return Consumer(
      key: const ValueKey('checklist-panel'),
      builder: (context, ref, _) {
        return Container(
          margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          padding: const EdgeInsets.all(12),
          constraints: const BoxConstraints(maxHeight: 260),
          decoration: BoxDecoration(
            color: AppColors.surfaceContainerHigh,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                children: [
                  SvgPicture.asset('assets/icons/checklist.svg', width: 24, height: 24),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          ref.t('simulationPage.sessionChecklist'),
                          style: Theme.of(context).textTheme.titleSmall,
                        ),
                        if (widget.mode != ChecklistMode.list)
                          Text(
                            '${ref.t('simulationPage.progress')}: $completedCount of '
                            '${sorted.length} ${ref.t('simulationPage.completed')}',
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Flexible(
                child: ListView.builder(
                  shrinkWrap: true,
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
    // GUIDED/LIST always show the item's name; UNGUIDED reveals the name
    // only once triggered, showing the item's rank until then — mirrors
    // RN's `displayText` exactly.
    final displayText = showsName
        ? item.name
        : (isTriggered ? item.name : (item.rank?.toString() ?? ''));
    final canExpand = showsName && (item.message ?? '').isNotEmpty;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        InkWell(
          onTap: canExpand ? onTap : null,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Row(
              children: [
                if (mode != ChecklistMode.list)
                  Container(
                    key: ValueKey('checklist-status-${item.id}'),
                    width: 22,
                    height: 22,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: isTriggered ? AppColors.emeraldGreen : Colors.transparent,
                      border: Border.all(
                        color: isTriggered ? AppColors.emeraldGreen : AppColors.strokePrimary,
                      ),
                    ),
                    child: isTriggered
                        ? const Icon(Icons.check, size: 14, color: Colors.black)
                        : null,
                  ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(displayText, key: ValueKey('checklist-item-${item.id}')),
                ),
                if (canExpand)
                  AnimatedRotation(
                    turns: isExpanded ? 0.5 : 0,
                    duration: const Duration(milliseconds: 150),
                    child: const Icon(Icons.keyboard_arrow_down, size: 18),
                  ),
              ],
            ),
          ),
        ),
        if (canExpand && isExpanded)
          Padding(
            padding: const EdgeInsets.only(left: 32, bottom: 8),
            child: Text(
              item.message!,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ),
      ],
    );
  }
}
