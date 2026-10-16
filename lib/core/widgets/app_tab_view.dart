import 'package:flutter/material.dart';

import '../theme/app_colors.dart';

/// Direct port of ally-mobile (React Native)'s `src/components/TabView/
/// TabView.tsx` — an in-screen segmented-control tab switcher (distinct
/// from the app's bottom navigation bar, ported separately as
/// `AppBottomTabBar`). A light-grey rounded-rect container holds a white
/// "active" pill behind the selected tab, not an underline indicator.
class AppTabViewItem<T> {
  const AppTabViewItem({required this.key, required this.label});

  final T key;
  final String label;
}

class AppTabView<T> extends StatelessWidget {
  const AppTabView({super.key, required this.tabs, required this.activeTab, required this.onTabChange});

  final List<AppTabViewItem<T>> tabs;
  final T activeTab;
  final ValueChanged<T> onTabChange;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.lightGray19,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.lightGray4, width: 0.5),
      ),
      child: Row(
        children: [
          for (final tab in tabs)
            Expanded(
              child: GestureDetector(
                onTap: () => onTabChange(tab.key),
                child: Container(
                  margin: const EdgeInsets.all(1),
                  padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 4),
                  decoration: tab.key == activeTab
                      ? BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(7),
                          border: Border.all(color: AppColors.lightGray2, width: 0.5),
                        )
                      : null,
                  child: Text(
                    tab.label,
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.labelMedium?.copyWith(
                          color: tab.key == activeTab
                              ? AppColors.highEmphasis
                              : AppColors.mediumEmphasis,
                        ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
