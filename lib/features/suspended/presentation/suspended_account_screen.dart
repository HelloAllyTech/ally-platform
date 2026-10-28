import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';

import '../../../core/auth/auth_state.dart';
import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/app_empty_state.dart';

/// Port of ally-mobile (React Native)'s `SuspendedAccountScreen`: RN's
/// `EmptyState` (the suspended illustration at EmptyState's default
/// 160×130, IBM Plex Serif title/description) and an outlined white
/// "Go to login" pill below it, the pair centred vertically on white.
///
/// RN resets navigation to Splash (the login screen). Here the button
/// clears any session and goes to /login: the login screen pushes this
/// route while still signed out, so a logout alone wouldn't change auth
/// state and the router would have nothing to redirect on.
class SuspendedAccountScreen extends ConsumerWidget {
  const SuspendedAccountScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final verticalScale = MediaQuery.sizeOf(context).height / 680; // @vs
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            AppEmptyState(
              icon: SvgPicture.asset('assets/icons/suspendedAccount.svg', width: 160, height: 130),
              title: ref.t('suspended.title'),
              description: _joinLines(ref.t('suspended.description.line1'), ref.t('suspended.description.line2')),
            ),
            // styles.buttonContainer + styles.button.
            Padding(
              padding: EdgeInsets.only(left: 24, right: 24, bottom: 32 * verticalScale),
              child: Padding(
                padding: const EdgeInsets.only(top: 16, left: 24, right: 24),
                child: Material(
                  color: Colors.white,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(24),
                    side: const BorderSide(color: AppColors.ashGray),
                  ),
                  child: InkWell(
                    borderRadius: BorderRadius.circular(24),
                    onTap: () async {
                      final router = GoRouter.maybeOf(context);
                      await ref.read(authControllerProvider.notifier).logout();
                      router?.go('/login');
                    },
                    child: Padding(
                      padding: EdgeInsets.symmetric(vertical: 10 * verticalScale),
                      child: Text(
                        ref.t('suspended.goToLogin'),
                        textAlign: TextAlign.center,
                        // No fontFamily in RN → system font.
                        style: const TextStyle(
                          fontFamily: 'CupertinoSystemText',
                          fontSize: 16,
                          fontWeight: FontWeight.w500,
                          color: AppColors.darkGray2,
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// RN concatenates the two lines with nothing between them, which renders
/// "Contact youradministrator"; same text, minus that typo.
String _joinLines(String line1, String line2) {
  if (line1.isEmpty || line2.isEmpty || line1.endsWith(' ') || line2.startsWith(' ')) return '$line1$line2';
  return '$line1 $line2';
}
