import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
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
        // Horizontally scrollable rather than a fixed `Row`: translated tab
        // labels vary a lot in length across this app's languages, and a
        // fixed-width Row overflows even at this test's wide 800px default
        // viewport with just two short English labels.
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              for (final tab in tabs) _InfoTabButton(
                tab: tab,
                isActive: tab == _activeTab,
                onTap: () => setState(() => _activeTab = tab),
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        switch (_activeTab) {
          SessionInfoTab.checklist => ChecklistPanel(
              mode: checklistModeFromString(widget.scenario.checklistType),
              items: widget.scenario.checklistEvents,
              triggeredEventIds: widget.triggeredEventIds,
            ),
          SessionInfoTab.reminders => _RemindersTab(reminders: widget.scenario.reminders),
          SessionInfoTab.description => Container(
              key: const ValueKey('session-info-description'),
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppColors.surfaceContainerHigh,
                borderRadius: BorderRadius.circular(12),
              ),
              child: HtmlRichText(html: widget.scenario.description, dark: false),
            ),
        },
      ],
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
    final labelKey = switch (tab) {
      SessionInfoTab.checklist => 'simulationPage.checklistTab',
      SessionInfoTab.reminders => 'simulationPage.remindersTab',
      SessionInfoTab.description => 'simulationPage.descriptionTab',
    };
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 6),
      child: InkWell(
        key: ValueKey('session-info-tab-${tab.name}'),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Column(
            children: [
              Text(
                ref.t(labelKey),
                style: TextStyle(
                  color: isActive ? AppColors.primary : AppColors.mediumEmphasis,
                  fontWeight: isActive ? FontWeight.w600 : FontWeight.normal,
                ),
              ),
              const SizedBox(height: 2),
              Container(height: 2, width: 24, color: isActive ? AppColors.primary : Colors.transparent),
            ],
          ),
        ),
      ),
    );
  }
}

class _RemindersTab extends StatelessWidget {
  const _RemindersTab({required this.reminders});

  // Never empty in practice — the Reminders tab itself doesn't exist
  // unless `scenario.reminders.isNotEmpty` (see `SessionInfoTabs.build`),
  // matching RN's own `hasReminders` gate exactly. No empty-state UI here,
  // matching real RN behavior (confirmed from source), even though RN's
  // own `SessionInfoTabs` component separately happens to define one that
  // this condition keeps unreachable.
  final List<String> reminders;

  @override
  Widget build(BuildContext context) {
    return Column(
      key: const ValueKey('session-info-reminders'),
      children: [
        for (final reminder in reminders)
          Container(
            width: double.infinity,
            margin: const EdgeInsets.only(bottom: 8),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: AppColors.surfaceContainerHigh,
              borderRadius: BorderRadius.circular(16),
            ),
            child: Text(reminder),
          ),
      ],
    );
  }
}
