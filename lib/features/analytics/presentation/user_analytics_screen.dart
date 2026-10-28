import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
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

    // RN returns a bare full-screen spinner while the dashboards load, and a
    // bare centred message on error — neither renders the header.
    if (dashboardsAsync.isLoading && !dashboardsAsync.hasValue) {
      return const Scaffold(
        backgroundColor: Colors.white,
        body: Center(child: CircularProgressIndicator(color: AppColors.primary)),
      );
    }
    if (dashboardsAsync.hasError && !dashboardsAsync.hasValue) {
      return Scaffold(
        backgroundColor: Colors.white,
        body: SafeArea(
          child: Center(
            // styles.errorText: REPLAY_PRO.BOLD, 16, darkGray.
            child: Text(
              ref.t('analytics.empty.description'),
              textAlign: TextAlign.center,
              style: const TextStyle(fontFamily: AppFonts.replayProBold, fontSize: 16, color: AppColors.darkGray),
            ),
          ),
        ),
      );
    }
    final dashboards = dashboardsAsync.value ?? const <Dashboard>[];

    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        // styles.container: paddingBottom 40, on top of the safe-area inset
        // (react-native-safe-area-context's SafeAreaView adds them).
        child: Padding(
          padding: const EdgeInsets.only(bottom: 40),
          child: Column(
            children: [
              TabScreenHeader(title: ref.t('analytics.title'), subtitle: ref.t('analytics.dashboardTitle')),
              Expanded(
                child: Builder(
                  builder: (context) {
                    if (dashboards.isEmpty) {
                      // styles.emptyStateContainer: flex 1, centred, 24pt sides.
                      return Center(
                        child: Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 24),
                          child: AppEmptyState(
                            iconAsset: 'assets/icons/dataUnavailable.svg',
                            title: ref.t('analytics.empty.title'),
                            description: ref.t('analytics.empty.description'),
                          ),
                        ),
                      );
                    }

                    final presentTypes = dashboards.map((d) => d.analyticsType).toSet();
                    final effectiveTab = presentTypes.length == 1 ? presentTypes.first : _selectedTab;
                    final filtered = dashboards.where((d) => d.analyticsType == effectiveTab).toList();

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
