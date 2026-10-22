import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_text_field.dart';
import '../../../core/widgets/root_scaffold_messenger.dart';
import '../data/bug_report_repository.dart';

const _maxDescriptionLength = 1000;
const _httpTooManyRequests = 429;

/// Port of ally-mobile (React Native)'s `BugReportScreen` — a guided
/// free-text field, submitted with silently-captured diagnostic context
/// (see `BugReportRepository`). Submit stays disabled until there's a
/// non-empty description, matching RN's own `canSubmit`/`isDisabled`
/// wiring — there's no separate "please describe the issue" message to
/// show, since the button simply can't be tapped empty.
///
class BugReportScreen extends ConsumerStatefulWidget {
  const BugReportScreen({super.key, this.screenName});

  /// The active tab's name when the drawer was opened — this app's
  /// equivalent of RN's "screen the user was on right before opening this
  /// one" (see `AppDrawer.activeTabName`'s doc comment for why that's
  /// exactly equivalent here, not an approximation).
  final String? screenName;

  @override
  ConsumerState<BugReportScreen> createState() => _BugReportScreenState();
}

class _BugReportScreenState extends ConsumerState<BugReportScreen> {
  final _controller = TextEditingController();
  bool _isSubmitting = false;

  @override
  void initState() {
    super.initState();
    _controller.addListener(_onDescriptionChanged);
  }

  @override
  void dispose() {
    _controller.removeListener(_onDescriptionChanged);
    _controller.dispose();
    super.dispose();
  }

  void _onDescriptionChanged() => setState(() {});

  bool get _canSubmit =>
      _controller.text.trim().isNotEmpty && _controller.text.length <= _maxDescriptionLength;

  Future<void> _submit() async {
    if (!_canSubmit || _isSubmitting) return;
    setState(() => _isSubmitting = true);
    try {
      await ref
          .read(bugReportRepositoryProvider)
          .createBugReport(_controller.text.trim(), screen: widget.screenName);
      if (!mounted) return;
      // Shown via the root key, not this screen's own `ScaffoldMessenger` —
      // `context.pop()` right after removes this Scaffold before an
      // ordinary SnackBar could finish displaying.
      rootScaffoldMessengerKey.currentState?.showSnackBar(
        SnackBar(content: Text(ref.tr('bugReport.successMessage'))),
      );
      context.pop();
    } catch (e) {
      final isRateLimited = e is DioException && e.response?.statusCode == _httpTooManyRequests;
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              isRateLimited
                  ? ref.tr('bugReport.rateLimitMessage')
                  : '${ref.tr('errors.submitBugReport')}: $e',
            ),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(icon: const Icon(Icons.arrow_back), onPressed: () => context.pop()),
        title: Text(ref.t('bugReport.title')),
      ),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(ref.t('bugReport.prompt')),
            const SizedBox(height: 12),
            AppTextField(
              controller: _controller,
              maxLines: 6,
              maxLength: _maxDescriptionLength,
              placeholder: ref.t('bugReport.placeholder'),
              enabled: !_isSubmitting,
            ),
            Align(
              alignment: Alignment.centerRight,
              child: Text('${_controller.text.length}/$_maxDescriptionLength'),
            ),
            const SizedBox(height: 16),
            AppButton(
              label: ref.t('bugReport.submit'),
              isLoading: _isSubmitting,
              isDisabled: !_canSubmit,
              onPressed: _submit,
            ),
          ],
        ),
      ),
    );
  }
}
