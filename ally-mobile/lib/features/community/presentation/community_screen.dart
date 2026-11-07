import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/localization/translate_ref.dart';

/// RN `CommunityScreen`'s hardcoded URL.
const kCommunityUrl = 'https://community.helloally.ai/';

/// RN `CommunityScreen`'s `useFocusEffect` body: `Linking.openURL(url)`.
/// The other half, `navigation.goBack()`, is the shell's job: every tap on
/// the Community tab calls this and leaves the user on the first tab (the
/// bottom tabs' default `backBehavior: 'firstRoute'`), so the tab can be
/// tapped again and again, each time reopening the browser.
Future<void> openCommunity() async {
  try {
    await launchUrl(Uri.parse(kCommunityUrl), mode: LaunchMode.externalApplication);
  } catch (_) {
    // RN doesn't catch either; a failed open simply does nothing.
  }
}

/// Direct port of ally-mobile (React Native)'s `CommunityScreen`. Its body
/// (`<Text>{t('community.title')}</Text>`) is only ever seen when
/// Community is the first visible tab, where RN's `goBack()` has nowhere
/// to go: then it opens the community site once on mount (RN's first
/// focus) and shows the title.
class CommunityScreen extends ConsumerStatefulWidget {
  const CommunityScreen({super.key});

  @override
  ConsumerState<CommunityScreen> createState() => _CommunityScreenState();
}

class _CommunityScreenState extends ConsumerState<CommunityScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => openCommunity());
  }

  @override
  Widget build(BuildContext context) => Align(
        alignment: Alignment.topLeft,
        child: Text(ref.t('community.title')),
      );
}
