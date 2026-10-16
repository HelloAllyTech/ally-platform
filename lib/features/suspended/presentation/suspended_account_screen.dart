import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../core/auth/auth_state.dart';
import '../../../core/localization/translate_ref.dart';
import '../../../core/widgets/app_button.dart';

/// Port of ally-mobile (React Native)'s `SuspendedAccountScreen` — static
/// message + a button that signs out back to the login screen (the RN
/// version resets navigation to Splash; here, logging out triggers the
/// same router redirect to /login already built in Phase 0).
class SuspendedAccountScreen extends ConsumerWidget {
  const SuspendedAccountScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                SvgPicture.asset('assets/icons/suspendedAccount.svg', width: 64, height: 64),
                const SizedBox(height: 16),
                Text(
                  ref.t('suspended.title'),
                  style: Theme.of(context).textTheme.titleLarge,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 8),
                Text(
                  '${ref.t('suspended.description.line1')}${ref.t('suspended.description.line2')}',
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 32),
                AppButton(
                  label: ref.t('suspended.goToLogin'),
                  onPressed: () => ref.read(authControllerProvider.notifier).logout(),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
