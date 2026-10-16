import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/widgets/app_empty_state.dart';
import '../../../core/widgets/app_tab_view.dart';
import '../../../core/widgets/tab_screen_header.dart';
import '../data/analytics_repository.dart';

/// Port of ally-mobile (React Native)'s `UserAnalyticsScreen` — the
/// previously-missing "Session Metrics" tab. Embeds each Metabase dashboard
/// the backend returns in its own WebView; when both call-log and
/// simulation dashboards exist, [AppTabView] filters which set shows
/// (matching the RN screen's `TabView<AnalyticsType>`, locked to the single
/// type when only one is present), using the same shared
/// [TabScreenHeader]/[AppEmptyState] primitives most other tab-root
/// screens use — not a plain Material `AppBar`/`SegmentedButton`.
class UserAnalyticsScreen extends ConsumerStatefulWidget {
  const UserAnalyticsScreen({super.key});

  @override
  ConsumerState<UserAnalyticsScreen> createState() => _UserAnalyticsScreenState();
}

class _UserAnalyticsScreenState extends ConsumerState<UserAnalyticsScreen> {
  AnalyticsType _selectedTab = AnalyticsType.callLogAnalytics;

  @override
  Widget build(BuildContext context) {
    final dashboardsAsync = ref.watch(dashboardsProvider);

    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            TabScreenHeader(title: ref.t('analytics.title'), subtitle: ref.t('analytics.dashboardTitle')),
            Expanded(
              child: dashboardsAsync.when(
                loading: () => const Center(child: CircularProgressIndicator()),
                error: (error, _) => Center(child: Text(ref.t('analytics.empty.description'))),
                data: (dashboards) {
                  if (dashboards.isEmpty) {
                    return Center(
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: AppEmptyState(
                          title: ref.t('analytics.empty.title'),
                          description: ref.t('analytics.empty.description'),
                        ),
                      ),
                    );
                  }

                  final presentTypes = dashboards.map((d) => d.analyticsType).toSet();
                  final effectiveTab =
                      presentTypes.length == 1 ? presentTypes.first : _selectedTab;
                  final filtered =
                      dashboards.where((d) => d.analyticsType == effectiveTab).toList();

                  return Column(
                    children: [
                      if (presentTypes.length > 1)
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
                          child: AppTabView<AnalyticsType>(
                            tabs: [
                              AppTabViewItem(
                                key: AnalyticsType.callLogAnalytics,
                                label: ref.t('analytics.types.callLogs'),
                              ),
                              AppTabViewItem(
                                key: AnalyticsType.simulationAnalytics,
                                label: ref.t('analytics.types.simulations'),
                              ),
                            ],
                            activeTab: effectiveTab,
                            onTabChange: (tab) => setState(() => _selectedTab = tab),
                          ),
                        ),
                      Expanded(
                        child: ListView(
                          padding: const EdgeInsets.all(16),
                          children: [
                            for (final dashboard in filtered)
                              Padding(
                                padding: const EdgeInsets.only(bottom: 16),
                                child: _DashboardWebView(dashboard: dashboard),
                              ),
                          ],
                        ),
                      ),
                    ],
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _DashboardWebView extends ConsumerWidget {
  const _DashboardWebView({required this.dashboard});

  final Dashboard dashboard;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final urlAsync = ref.watch(dashboardUrlProvider(dashboard.externalId));
    final width = MediaQuery.of(context).size.width - 50;

    return ClipRRect(
      borderRadius: BorderRadius.circular(8),
      child: SizedBox(
        width: width,
        height: width,
        child: urlAsync.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (error, _) => Center(child: Text('$error')),
          data: (url) => WebViewWidget(
            controller: WebViewController()
              ..setJavaScriptMode(JavaScriptMode.unrestricted)
              ..loadRequest(Uri.parse(url)),
          ),
        ),
      ),
    );
  }
}
