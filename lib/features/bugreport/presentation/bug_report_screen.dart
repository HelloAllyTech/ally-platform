import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_text_field.dart';
import '../../../core/widgets/tab_screen_header.dart';
import '../data/bug_report_repository.dart';

/// Scoped port of ally-mobile (React Native)'s `BugReportScreen` —
/// description field + submit. Device/app-state context attachment not
/// collected in this pass (see repository's doc comment).
class BugReportScreen extends ConsumerStatefulWidget {
  const BugReportScreen({super.key});

  @override
  ConsumerState<BugReportScreen> createState() => _BugReportScreenState();
}

class _BugReportScreenState extends ConsumerState<BugReportScreen> {
  final _controller = TextEditingController();
  bool _isSubmitting = false;
  bool _submitted = false;
  String? _error;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_controller.text.trim().isEmpty) {
      setState(() => _error = ref.tr('bugReport.emptyError'));
      return;
    }
    setState(() {
      _isSubmitting = true;
      _error = null;
    });
    try {
      await ref.read(bugReportRepositoryProvider).createBugReport(_controller.text.trim());
      if (mounted) setState(() => _submitted = true);
    } catch (e) {
      setState(() => _error = '${ref.tr('errors.submitBugReport')}: $e');
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Column(
        children: [
          TabScreenHeader(title: ref.t('bugReport.title')),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: _submitted
                  ? Center(child: Text(ref.t('bugReport.successMessage')))
                  : Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        AppTextField(
                          controller: _controller,
                          maxLines: 6,
                          placeholder: ref.t('bugReport.placeholder'),
                          isError: _error != null,
                        ),
                        if (_error != null) ...[
                          const SizedBox(height: 12),
                          Text(_error!, style: const TextStyle(color: AppColors.red400)),
                        ],
                        const SizedBox(height: 16),
                        AppButton(
                          label: ref.t('bugReport.submit'),
                          isLoading: _isSubmitting,
                          onPressed: _submit,
                        ),
                      ],
                    ),
            ),
          ),
        ],
      ),
    );
  }
}
