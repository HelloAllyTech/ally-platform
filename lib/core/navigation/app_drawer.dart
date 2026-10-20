import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../../features/account/data/account_repository.dart';
import '../../features/account/data/user_profile.dart';
import '../../features/simulations/data/simulations_repository.dart';
import '../auth/auth_state.dart';
import '../localization/translate_ref.dart';
import '../permissions/user_permissions.dart';
import '../theme/app_colors.dart';
import '../theme/app_fonts.dart';

/// Port of ally-mobile (React Native)'s `CustomDrawerContent.tsx` (exported
/// there as `DrawerContent`) — org logo, user profile block, simulation
/// credits bar, 3 menu items, version footer, Ally logo badge.
class AppDrawer extends ConsumerWidget {
  const AppDrawer({super.key, required this.permissions});

  final List<String> permissions;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final userAsync = ref.watch(currentUserProvider);
    final tenantAsync = ref.watch(tenantInfoProvider);
    final hasCreditsPermission = permissions.contains(UserPermissions.editScenarioSession);

    return Drawer(
      width: MediaQuery.of(context).size.width * 0.85,
      backgroundColor: Colors.white,
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: 16),
              tenantAsync.when(
                data: (tenant) => Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _OrgLogo(tenant: tenant),
                    const _Separator(),
                  ],
                ),
                loading: () => const SizedBox.shrink(),
                error: (_, _) => const SizedBox.shrink(),
              ),
              userAsync.when(
                data: (user) => Row(
                  children: [
                    CircleAvatar(
                      radius: 16,
                      backgroundImage: (user.profileImageUrl?.isNotEmpty ?? false)
                          ? NetworkImage(user.profileImageUrl!)
                          : null,
                      child: (user.profileImageUrl?.isNotEmpty ?? false)
                          ? null
                          : Text(user.name.isNotEmpty ? user.name[0].toUpperCase() : '?'),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            user.name,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            // RN's styles.name: body.large size, but
                            // REPLAY_PRO.HEADLINE family — not bodyLarge's
                            // IBMPlexSerif-Regular default.
                            style: Theme.of(context)
                                .textTheme
                                .bodyLarge
                                ?.copyWith(fontFamily: AppFonts.replayProHeadline),
                          ),
                          if (user.email.isNotEmpty)
                            Text(
                              user.email,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: Theme.of(context)
                                  .textTheme
                                  .bodySmall
                                  ?.copyWith(color: AppColors.mediumEmphasis),
                            ),
                        ],
                      ),
                    ),
                  ],
                ),
                loading: () => const SizedBox(height: 32),
                error: (_, _) => const SizedBox.shrink(),
              ),
              const _Separator(),
              if (hasCreditsPermission) ...[
                const _CreditsSection(),
                const _Separator(),
              ],
              _MenuOption(
                iconAsset: 'assets/icons/profileSettings.svg',
                label: ref.t('profile.settings.title'),
                onTap: () {
                  Navigator.of(context).pop();
                  context.push('/profile');
                },
              ),
              _MenuOption(
                iconAsset: 'assets/icons/help.svg',
                label: ref.t('bugReport.menuLabel'),
                onTap: () {
                  Navigator.of(context).pop();
                  context.push('/bug-report');
                },
              ),
              _MenuOption(
                iconAsset: 'assets/icons/logout.svg',
                label: ref.t('user.logout'),
                onTap: () => _confirmLogout(context, ref),
              ),
              const Spacer(),
              Center(child: _VersionFooter()),
              const SizedBox(height: 8),
              Container(
                margin: const EdgeInsets.only(bottom: 30, top: 8),
                padding: const EdgeInsets.all(12),
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  border: Border.all(color: AppColors.strokePrimary, width: 0.5),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: SvgPicture.asset('assets/icons/allyLogo.svg', height: 24),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _confirmLogout(BuildContext context, WidgetRef ref) async {
    // `ref.tr`, not `ref.t` — this runs inside `showDialog`'s own builder,
    // a separate element from this widget's `build()`, where `ref.watch`
    // would throw.
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(ref.tr('user.logout')),
        content: Text(ref.tr('nav.logout.content')),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(ref.tr('common.cancel')),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(ref.tr('nav.logout.button')),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      if (context.mounted) Navigator.of(context).pop();
      await ref.read(authControllerProvider.notifier).logout();
    }
  }
}

class _OrgLogo extends StatefulWidget {
  const _OrgLogo({required this.tenant});

  final TenantInfo tenant;

  @override
  State<_OrgLogo> createState() => _OrgLogoState();
}

class _OrgLogoState extends State<_OrgLogo> {
  bool _logoError = false;

  @override
  Widget build(BuildContext context) {
    final logoUrl = widget.tenant.logoUrl;
    return SizedBox(
      width: 40,
      height: 40,
      child: (logoUrl != null && logoUrl.isNotEmpty && !_logoError)
          ? Image.network(
              logoUrl,
              fit: BoxFit.contain,
              errorBuilder: (_, _, _) {
                WidgetsBinding.instance.addPostFrameCallback((_) {
                  if (mounted) setState(() => _logoError = true);
                });
                return const SizedBox.shrink();
              },
            )
          : DecoratedBox(
              decoration: BoxDecoration(
                color: AppColors.lightGray2,
                borderRadius: BorderRadius.circular(4),
              ),
              child: Center(
                child: Text(
                  widget.tenant.name.isNotEmpty ? widget.tenant.name[0].toUpperCase() : 'NA',
                  style: const TextStyle(color: AppColors.mediumEmphasis),
                ),
              ),
            ),
    );
  }
}

class _CreditsSection extends ConsumerWidget {
  const _CreditsSection();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final creditsAsync = ref.watch(simulationCreditsProvider);
    return creditsAsync.when(
      data: (credits) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              SvgPicture.asset('assets/icons/bolt.svg', width: 16, height: 16),
              const SizedBox(width: 8),
              // RN's styles.creditTitle: label.large size, but
              // IBM_PLEX_SERIF.REGULAR family — not labelLarge's Roboto.
              Text(
                ref.t('user.creditUsage'),
                style: Theme.of(context)
                    .textTheme
                    .labelLarge
                    ?.copyWith(fontFamily: AppFonts.ibmPlexSerifRegular),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text.rich(
                TextSpan(
                  children: [
                    TextSpan(
                      // RN's styles.creditConsumedText: body.large size, but
                      // IBM_PLEX_SERIF.MEDIUM family — not bodyLarge's
                      // Regular weight.
                      text: '${credits.consumedCredits}',
                      style: Theme.of(context)
                          .textTheme
                          .bodyLarge
                          ?.copyWith(fontFamily: AppFonts.ibmPlexSerifMedium),
                    ),
                    TextSpan(
                      text: '/${credits.creditLimit}',
                      style: Theme.of(context)
                          .textTheme
                          .bodySmall
                          ?.copyWith(color: AppColors.mediumEmphasis),
                    ),
                  ],
                ),
              ),
              Text(
                '${credits.usagePercentage}%',
                style:
                    Theme.of(context).textTheme.bodySmall?.copyWith(color: AppColors.mediumEmphasis),
              ),
            ],
          ),
          const SizedBox(height: 8),
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(
              value: credits.usagePercentage / 100,
              minHeight: 6,
              backgroundColor: AppColors.lightGray2,
              color: credits.isLow ? AppColors.softCoralRed : AppColors.brandLogo,
            ),
          ),
        ],
      ),
      loading: () => const SizedBox(height: 40),
      error: (_, _) => const SizedBox.shrink(),
    );
  }
}

class _MenuOption extends StatelessWidget {
  const _MenuOption({required this.iconAsset, required this.label, required this.onTap});

  final String iconAsset;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Row(
          children: [
            SvgPicture.asset(iconAsset, width: 24, height: 24),
            const SizedBox(width: 8),
            Text(label, style: Theme.of(context).textTheme.bodyLarge),
          ],
        ),
      ),
    );
  }
}

class _VersionFooter extends StatefulWidget {
  @override
  State<_VersionFooter> createState() => _VersionFooterState();
}

class _VersionFooterState extends State<_VersionFooter> {
  String _version = '';

  @override
  void initState() {
    super.initState();
    PackageInfo.fromPlatform().then((info) {
      if (mounted) setState(() => _version = '${info.version}+${info.buildNumber}');
    });
  }

  @override
  Widget build(BuildContext context) {
    return Consumer(
      builder: (context, ref, _) => Text(
        '${ref.t('common.version')}: $_version',
        style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppColors.mediumEmphasis),
      ),
    );
  }
}

class _Separator extends StatelessWidget {
  const _Separator();

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.symmetric(vertical: 12),
      child: Divider(height: 0.5, color: AppColors.strokePrimary),
    );
  }
}
