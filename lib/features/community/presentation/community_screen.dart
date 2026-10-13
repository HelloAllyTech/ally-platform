import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

/// Direct port of ally-mobile (React Native)'s `CommunityScreen` — the
/// original is trivial by design: it immediately navigates back and opens
/// `community.helloally.ai` in the system browser rather than rendering
/// any in-app UI. Same behavior here.
class CommunityScreen extends StatefulWidget {
  const CommunityScreen({super.key});

  @override
  State<CommunityScreen> createState() => _CommunityScreenState();
}

class _CommunityScreenState extends State<CommunityScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      if (context.canPop()) context.pop();
      await launchUrl(
        Uri.parse('https://community.helloally.ai/'),
        mode: LaunchMode.externalApplication,
      );
    });
  }

  @override
  Widget build(BuildContext context) => const SizedBox.shrink();
}
