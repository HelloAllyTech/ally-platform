import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../../features/account/data/account_repository.dart';
import '../../features/account/data/user_profile.dart';
import '../../features/simulations/data/simulations_repository.dart';
import '../auth/auth_state.dart';
import '../config/app_config.dart';
import '../localization/translate_ref.dart';
import '../permissions/user_permissions.dart';
import '../theme/app_colors.dart';
import '../theme/rn_scale.dart';
import '../theme/app_fonts.dart';
import '../widgets/illustrated_modal.dart';
import '../widgets/sized_network_image.dart';

/// Port of ally-mobile (React Native)'s `CustomDrawerContent.tsx` (exported
/// there as `DrawerContent`) — org logo, user profile block, simulation
/// credits bar, 3 menu items, version footer, Ally logo badge.
class AppDrawer extends ConsumerWidget {
  const AppDrawer({super.key, required this.permissions, this.activeTabName});

  final List<String> permissions;

  /// RN's `BugReportScreen` silently captures "the screen the user was on
  /// right before opening this one" by walking React Navigation's nested
  /// Drawer/BottomTabs state — this app has no equivalent navigation-state
  /// introspection, but the hamburger icon (and so this drawer) is only
  /// ever reachable from the first visible tab anyway (same gate RN's own
  /// `showHamburger: isFirstTab` applies), so the shell's own active tab
  /// name is already exactly that "previous screen".
  final String? activeTabName;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final userAsync = ref.watch(currentUserProvider);
    final tenantAsync = ref.watch(tenantInfoProvider);
    final hasCreditsPermission = permissions.contains(UserPermissions.editScenarioSession);
    final rn = RnSize.of(context);
    final separator = _Separator(rn: rn);

    return Drawer(
      width: MediaQuery.of(context).size.width * 0.85,
      backgroundColor: Colors.white,
      // styles.container: paddingTop 50@mvs from the drawer's top edge (RN
      // doesn't inset this for the status bar), 16pt sides.
      child: Padding(
        padding: EdgeInsets.only(top: rn.mvs(50), left: 16, right: 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            tenantAsync.when(
              data: (tenant) => Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [_OrgLogo(tenant: tenant), separator],
              ),
              loading: () => const SizedBox.shrink(),
              error: (_, _) => const SizedBox.shrink(),
            ),
            userAsync.when(
              data: (user) => Row(
                children: [
                  _UserProfileAvatar(
                    name: user.name,
                    imageUrl: user.profileImageUrl,
                    size: 32,
                    textStyle: const TextStyle(fontSize: 16, height: 24 / 16, letterSpacing: 0.5),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Padding(
                          padding: EdgeInsets.only(bottom: rn.mvs(2)),
                          child: Text(
                            user.name,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            // styles.name: REPLAY_PRO.HEADLINE + body.large.
                            style: const TextStyle(
                              fontFamily: AppFonts.replayProHeadline,
                              fontSize: 16,
                              height: 24 / 16,
                              letterSpacing: 0.5,
                              color: AppColors.highEmphasis,
                            ),
                          ),
                        ),
                        if (user.email.isNotEmpty)
                          Text(
                            user.email,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            // styles.email (+ emailSmall past 30 chars).
                            style: TextStyle(
                              fontFamily: AppFonts.ibmPlexSerifRegular,
                              fontSize: user.email.length > 30 ? 9 : 12,
                              height: 16 / (user.email.length > 30 ? 9 : 12),
                              letterSpacing: 0.2,
                              color: AppColors.mediumEmphasis,
                            ),
                          ),
                      ],
                    ),
                  ),
                ],
              ),
              loading: () => const SizedBox(height: 32),
              error: (_, _) => const SizedBox.shrink(),
            ),
            separator,
            if (hasCreditsPermission) ...[
              _CreditsSection(rn: rn),
              separator,
            ],
            // styles.menuItemsWrapper (flex 1) + MenuOption (gap 8).
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _MenuOption(
                    icon: SvgPicture.asset('assets/icons/profileSettings.svg', width: 24, height: 24),
                    label: ref.t('profile.settings.title'),
                    onTap: () {
                      Navigator.of(context).pop();
                      context.push('/profile');
                    },
                  ),
                  _MenuOption(
                    icon: SvgPicture.asset('assets/icons/help.svg', width: 24, height: 24),
                    label: ref.t('bugReport.menuLabel'),
                    onTap: () {
                      Navigator.of(context).pop();
                      context.push('/bug-report', extra: activeTabName);
                    },
                  ),
                  // RN renders LogoutIcon at its intrinsic 16pt.
                  _MenuOption(
                    icon: SvgPicture.asset('assets/icons/logout.svg'),
                    label: ref.t('user.logout'),
                    onTap: () => _confirmLogout(context, ref),
                  ),
                ],
              ),
            ),
            const Padding(
              padding: EdgeInsets.only(bottom: 16),
              child: Center(child: _VersionFooter()),
            ),
            // styles.logoContainer: 0.5pt stroke, radius lg (8), 12pt
            // padding, 15pt sides, 8@mvs above, 30 below; logo at its
            // intrinsic 72x35.
            Container(
              margin: EdgeInsets.only(left: 15, right: 15, top: rn.mvs(8), bottom: 30),
              padding: const EdgeInsets.all(12),
              alignment: Alignment.center,
              decoration: BoxDecoration(
                border: Border.all(color: AppColors.strokePrimary, width: 0.5),
                borderRadius: BorderRadius.circular(8),
              ),
              child: SvgPicture.asset('assets/icons/allyLogo.svg'),
            ),
          ],
        ),
      ),
    );
  }

  // `ref.tr`, not `ref.t` — the modal's builder is a separate element from
  // this widget's `build()`, where `ref.watch` would throw.
  void _confirmLogout(BuildContext context, WidgetRef ref) {
    IllustratedModal.show(
      context,
      titleMain: ref.tr('nav.logout.title.normal'),
      titleItalic: ref.tr('nav.logout.title.italic'),
      description: ref.tr('nav.logout.content'),
      illustrationAsset: 'assets/images/logOut.png',
      actionButtonText: ref.tr('nav.logout.button'),
      // The X icon dismisses without ever invoking this — matches RN's
      // "X-only cancel, no separate Cancel button" exactly.
      onActionPressed: () {
        Navigator.of(context).pop(); // closes the drawer itself
        ref.read(authControllerProvider.notifier).logout();
      },
    );
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
          ? SizedNetworkImage(
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
                  // styles.orgLogoPlaceholderText: IBM_PLEX_SERIF.MEDIUM, body.large.
                  style: const TextStyle(
                    fontFamily: AppFonts.ibmPlexSerifMedium,
                    fontSize: 16,
                    height: 24 / 16,
                    letterSpacing: 0.5,
                    color: AppColors.mediumEmphasis,
                  ),
                ),
              ),
            ),
    );
  }
}

class _CreditsSection extends ConsumerWidget {
  const _CreditsSection({required this.rn});

  final RnSize rn;

  static const _small = TextStyle(
    fontFamily: AppFonts.ibmPlexSerifRegular,
    fontSize: 12,
    height: 16 / 12,
    letterSpacing: 0.2,
    color: AppColors.mediumEmphasis,
  );

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final creditsAsync = ref.watch(simulationCreditsProvider);
    return creditsAsync.when(
      data: (credits) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // styles.creditHeader: gap 18, 8@mvs below.
          Padding(
            padding: EdgeInsets.only(bottom: rn.mvs(8)),
            child: Row(
              children: [
                SizedBox(
                  width: 16,
                  height: 16,
                  child: SvgPicture.asset('assets/icons/bolt.svg'),
                ),
                const SizedBox(width: 18),
                Text(
                  ref.t('user.creditUsage'),
                  // styles.creditTitle: label.large, IBM_PLEX_SERIF.REGULAR.
                  style: const TextStyle(
                    fontFamily: AppFonts.ibmPlexSerifRegular,
                    fontSize: 14,
                    height: 22 / 14,
                    letterSpacing: 0.2,
                    color: AppColors.highEmphasis,
                  ),
                ),
              ],
            ),
          ),
          Padding(
            padding: EdgeInsets.only(bottom: rn.mvs(8)),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text.rich(
                  TextSpan(
                    children: [
                      TextSpan(
                        text: '${credits.consumedCredits}',
                        // styles.creditConsumedText: body.large, MEDIUM.
                        style: const TextStyle(
                          fontFamily: AppFonts.ibmPlexSerifMedium,
                          fontSize: 16,
                          height: 24 / 16,
                          letterSpacing: 0.5,
                          color: AppColors.highEmphasis,
                        ),
                      ),
                      TextSpan(text: '/${credits.creditLimit}', style: _small),
                    ],
                  ),
                ),
                Text('${credits.usagePercentage}%', style: _small),
              ],
            ),
          ),
          // styles.progressBarContainer: 6@mvs, lightGray2, radius 4.
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(
              value: credits.usagePercentage / 100,
              minHeight: rn.mvs(6),
              backgroundColor: AppColors.lightGray2,
              color: credits.isLow ? AppColors.softCoralRed : AppColors.brandLogo,
              borderRadius: BorderRadius.circular(4),
            ),
          ),
        ],
      ),
      loading: () => const SizedBox(height: 40),
      error: (_, _) => const SizedBox.shrink(),
    );
  }
}

/// RN's `MenuOption` with `gap={8}`: a 24pt centred icon box, then
/// IBM_PLEX_SERIF.REGULAR 14 / 18.2 / 0.15 in black, 16pt below each row.
class _MenuOption extends StatelessWidget {
  const _MenuOption({required this.icon, required this.label, required this.onTap});

  final Widget icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.only(bottom: 16),
        child: Row(
          children: [
            SizedBox(width: 24, height: 24, child: Center(child: icon)),
            const SizedBox(width: 8),
            Text(
              label,
              style: const TextStyle(
                fontFamily: AppFonts.ibmPlexSerifRegular,
                fontSize: 14,
                height: 18.2 / 14,
                letterSpacing: 0.15,
                color: Colors.black,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// RN: `{t('common.version')}: {getAppVersion()} {env.ENVIRONMENT ===
/// 'development' && t('drawer.dev')}` — e.g. "Version: 1.23.46 (Dev)";
/// outside development the `false` renders nothing, leaving the trailing
/// space. IBM_PLEX_SERIF.REGULAR body.small in mediumEmphasis.
class _VersionFooter extends StatefulWidget {
  const _VersionFooter();

  @override
  State<_VersionFooter> createState() => _VersionFooterState();
}

class _VersionFooterState extends State<_VersionFooter> {
  String _version = '';

  @override
  void initState() {
    super.initState();
    // RN's `getAppVersion()` (`react-native-version-check`'s
    // `getCurrentVersion`) returns only the marketing version — no build
    // number appended.
    PackageInfo.fromPlatform().then((info) {
      if (mounted) setState(() => _version = info.version);
    });
  }

  @override
  Widget build(BuildContext context) {
    return Consumer(
      builder: (context, ref, _) => Text(
        drawerVersionLabel(
          versionLabel: ref.t('common.version'),
          version: _version,
          environment: AppConfig.environment,
          devLabel: ref.t('drawer.dev'),
        ),
        style: const TextStyle(
          fontFamily: AppFonts.ibmPlexSerifRegular,
          fontSize: 12,
          height: 16 / 12,
          letterSpacing: 0.2,
          color: AppColors.mediumEmphasis,
        ),
      ),
    );
  }
}

/// The drawer's version line, as RN builds it.
@visibleForTesting
String drawerVersionLabel({
  required String versionLabel,
  required String version,
  required String environment,
  required String devLabel,
}) =>
    '$versionLabel: $version ${environment == 'development' ? devLabel : ''}';

/// styles.separator: 0.5@vs tall, strokePrimary, 12@mvs above and below.
class _Separator extends StatelessWidget {
  const _Separator({required this.rn});

  final RnSize rn;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: rn.vs(0.5),
      margin: EdgeInsets.symmetric(vertical: rn.mvs(12)),
      color: AppColors.strokePrimary,
    );
  }
}

/// Port of RN's shared `UserProfileImage`: a circle with a 1pt lightGray17
/// (#D2D2D2) border on lightGray, showing the image or the name's first
/// letter in IBM_PLEX_SERIF.MEDIUM, black, upper-cased.
class _UserProfileAvatar extends StatelessWidget {
  const _UserProfileAvatar({
    required this.name,
    required this.imageUrl,
    required this.size,
    required this.textStyle,
  });

  final String? name;
  final String? imageUrl;
  final double size;

  /// The `typography.body[textSize]` slot RN passes (size/line height).
  final TextStyle textStyle;

  @override
  Widget build(BuildContext context) {
    final url = imageUrl;
    final initial = (name ?? '').trim();
    return Container(
      key: const Key('user-profile-avatar'),
      width: size,
      height: size,
      clipBehavior: Clip.antiAlias,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: AppColors.lightGray,
        shape: BoxShape.circle,
        border: Border.all(color: AppColors.strokePrimary),
      ),
      child: (url != null && url.isNotEmpty)
          ? SizedNetworkImage(url, width: size, height: size, fit: BoxFit.cover)
          : Text(
              initial.isEmpty ? '' : initial[0].toUpperCase(),
              style: textStyle.copyWith(fontFamily: AppFonts.ibmPlexSerifMedium, color: Colors.black),
            ),
    );
  }
}
