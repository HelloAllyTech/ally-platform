import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/localization/translate_ref.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/widgets/html_rich_text.dart';
import '../../simulations/data/simulation_models.dart';
import 'checklist_panel.dart';

enum SessionInfoTab { checklist, reminders, description }

/// Scoped port of RN's unified Checklist/Reminders/Description tab bar
/// (`SimulationAssistantScreen.tsx`'s `infoTabs`/`SessionInfoTabs`) — direct
/// port of RN's exact per-tab gates, confirmed from source: Checklist needs
/// `hasChecklist`, Reminders needs `reminders.isNotEmpty`, Description needs
/// a non-empty `description` — each tab is entirely ABSENT (not just empty)
/// when its gate fails, not shown-with-an-empty-state. [hasAnyTab] mirrors
/// RN's `hasTabs`, for the caller to decide whether to render this widget
/// at all.
class SessionInfoTabs extends StatefulWidget {
  const SessionInfoTabs({
    super.key,
    required this.scenario,
    required this.triggeredEventIds,
  });

  final Scenario scenario;
  final Set<String> triggeredEventIds;

  static bool hasAnyTab(Scenario scenario) =>
      scenario.hasChecklist || scenario.reminders.isNotEmpty || (scenario.description ?? '').isNotEmpty;

  @override
  State<SessionInfoTabs> createState() => _SessionInfoTabsState();
}

class _SessionInfoTabsState extends State<SessionInfoTabs> {
  late SessionInfoTab _activeTab = widget.scenario.hasChecklist
      ? SessionInfoTab.checklist
      : (widget.scenario.reminders.isNotEmpty
            ? SessionInfoTab.reminders
            : SessionInfoTab.description);

  @override
  Widget build(BuildContext context) {
    final tabs = [
      if (widget.scenario.hasChecklist) SessionInfoTab.checklist,
      if (widget.scenario.reminders.isNotEmpty) SessionInfoTab.reminders,
      if ((widget.scenario.description ?? '').isNotEmpty) SessionInfoTab.description,
    ];
    if (tabs.isEmpty) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // RN `infoTabBar`: icon + label buttons 16 apart over a #3D4045
        // rule; the active one is white with a green underline.
        Container(
          key: const ValueKey('simulation-info-tab-bar'),
          margin: const EdgeInsets.only(bottom: 12),
          decoration: const BoxDecoration(
            border: Border(bottom: BorderSide(color: AppColors.callDivider)),
          ),
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                for (var i = 0; i < tabs.length; i++) ...[
                  if (i > 0) const SizedBox(width: 16),
                  _InfoTabButton(
                    tab: tabs[i],
                    isActive: tabs[i] == _activeTab,
                    onTap: () => setState(() => _activeTab = tabs[i]),
                  ),
                ],
              ],
            ),
          ),
        ),
        Flexible(
          child: switch (_activeTab) {
            SessionInfoTab.checklist => ChecklistPanel(
              mode: checklistModeFromString(widget.scenario.checklistType),
              items: widget.scenario.checklistEvents,
              triggeredEventIds: widget.triggeredEventIds,
              hideHeader: true,
            ),
            SessionInfoTab.reminders => _DarkPane(child: _RemindersTab(reminders: widget.scenario.reminders)),
            SessionInfoTab.description => _DarkPane(
              child: Container(
                key: const ValueKey('session-info-description'),
                child: HtmlRichText(html: widget.scenario.description, dark: true),
              ),
            ),
          },
        ),
      ],
    );
  }
}

/// RN `SessionInfoTabs` container: `#1d2020`, radius 8, padding 10,
/// scrolling its content.
class _DarkPane extends StatelessWidget {
  const _DarkPane({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(color: const Color(0xFF1D2020), borderRadius: BorderRadius.circular(8)),
      child: SingleChildScrollView(padding: const EdgeInsets.only(bottom: 8), child: child),
    );
  }
}

class _InfoTabButton extends ConsumerWidget {
  const _InfoTabButton({required this.tab, required this.isActive, required this.onTap});

  final SessionInfoTab tab;
  final bool isActive;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final (labelKey, icon) = switch (tab) {
      SessionInfoTab.checklist => ('simulationPage.checklistTab', 'assets/icons/checklist.svg'),
      SessionInfoTab.reminders => ('simulationPage.remindersTab', 'assets/icons/bulb.svg'),
      SessionInfoTab.description => ('simulationPage.descriptionTab', 'assets/icons/notes.svg'),
    };
    final color = isActive ? Colors.white : AppColors.infoTabInactive;
    return GestureDetector(
      key: ValueKey('session-info-tab-${tab.name}'),
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 4),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                SizedBox(
                  width: 16,
                  height: 16,
                  child: SvgPicture.asset(icon, colorFilter: ColorFilter.mode(color, BlendMode.srcIn)),
                ),
                const SizedBox(width: 6),
                Text(
                  ref.t(labelKey),
                  style: TextStyle(
                    fontFamily: AppFonts.ibmPlexSerifRegular,
                    fontSize: 14,
                    fontWeight: FontWeight.w500,
                    color: color,
                  ),
                ),
              ],
            ),
          ),
          if (isActive)
            Positioned(
              left: 0,
              right: 0,
              bottom: -1,
              child: Container(
                height: 2,
                decoration: const BoxDecoration(
                  color: AppColors.callGreen,
                  borderRadius: BorderRadius.vertical(top: Radius.circular(2)),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _RemindersTab extends StatelessWidget {
  const _RemindersTab({required this.reminders});

  // Never empty in practice — the tab only exists when there are
  // reminders (RN `hasReminders`).
  final List<String> reminders;

  @override
  Widget build(BuildContext context) {
    return Column(
      key: const ValueKey('session-info-reminders'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (var i = 0; i < reminders.length; i++) ...[
          if (i > 0) const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(color: AppColors.darkGray10, borderRadius: BorderRadius.circular(16)),
            child: Text(
              reminders[i],
              style: const TextStyle(
                fontFamily: AppFonts.ibmPlexSerifRegular,
                fontSize: 14,
                height: 20 / 14,
                color: Colors.white,
              ),
            ),
          ),
        ],
      ],
    );
  }
}
