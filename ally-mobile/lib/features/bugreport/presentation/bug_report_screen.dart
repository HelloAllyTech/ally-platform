import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/theme/rn_scale.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/back_title_header.dart';
import '../../../core/widgets/toast/toast_controller.dart';
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
  final _focusNode = FocusNode();
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
    _focusNode.dispose();
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
      // The app-root toast outlives the `pop()` right after, as RN's does.
      showToast(ref.tr('bugReport.successMessage'));
      context.pop();
    } catch (e) {
      final isRateLimited = e is DioException && e.response?.statusCode == _httpTooManyRequests;
      if (mounted) {
        if (isRateLimited) {
          showToast(ref.tr('bugReport.rateLimitMessage'), type: ToastType.error);
        } else {
          showErrorToast(e, 'errors.submitBugReport', t: ref.tr);
        }
      }
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  static const _bodyMedium = TextStyle(
    fontFamily: AppFonts.ibmPlexSerifRegular,
    fontSize: 14,
    height: 22 / 14,
    letterSpacing: 0.2,
  );

  @override
  Widget build(BuildContext context) {
    final rn = RnSize.of(context);
    final insets = MediaQuery.paddingOf(context);
    // RN's KeyboardAvoidingView wraps only the scroll view: the footer stays
    // at the bottom (behind the keyboard) while the content gains room.
    final keyboard = MediaQuery.viewInsetsOf(context).bottom;
    return Scaffold(
      backgroundColor: Colors.white,
      resizeToAvoidBottomInset: false,
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // styles.header: 16 padding all round, 16 after the arrow, 0.5
          // ds.stroke.primary bottom border; ReplayPro display.small light.
          BackTitleHeader(
            title: ref.t('bugReport.title'),
            margin: EdgeInsets.zero,
            padding: const EdgeInsets.all(16),
            gap: 16,
            borderColor: AppColors.strokePrimary,
          ),
          Expanded(
            child: SingleChildScrollView(
              keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.manual,
              padding: EdgeInsets.only(left: 24, right: 24, top: rn.mvs(24), bottom: keyboard),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    ref.t('bugReport.prompt'),
                    style: _bodyMedium.copyWith(color: AppColors.highEmphasis),
                  ),
                  SizedBox(height: rn.mvs(12)),
                  // styles.textArea: minHeight 160@vs, 0.5 stroke, radius 8,
                  // padding 12; a tap anywhere in the box focuses the input.
                  GestureDetector(
                    onTap: _focusNode.requestFocus,
                    child: Container(
                      constraints: BoxConstraints(minHeight: rn.vs(160)),
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(color: AppColors.strokePrimary, width: 0.5),
                      ),
                      child: TextField(
                        key: const Key('bug-report-input'),
                        controller: _controller,
                        focusNode: _focusNode,
                        enabled: !_isSubmitting,
                        maxLines: null,
                        maxLength: _maxDescriptionLength,
                        buildCounter: (_, {required currentLength, required isFocused, maxLength}) => null,
                        style: _bodyMedium.copyWith(color: Colors.black),
                        decoration: InputDecoration.collapsed(
                          hintText: ref.t('bugReport.placeholder'),
                          hintStyle: _bodyMedium.copyWith(color: AppColors.lowEmphasis),
                        ),
                      ),
                    ),
                  ),
                  SizedBox(height: rn.mvs(8)),
                  Text(
                    '${_controller.text.length}/$_maxDescriptionLength',
                    textAlign: TextAlign.right,
                    style: const TextStyle(
                      fontFamily: AppFonts.ibmPlexSerifRegular,
                      fontSize: 12,
                      height: 16 / 12,
                      letterSpacing: 0.2,
                      color: AppColors.lowEmphasis,
                    ),
                  ),
                ],
              ),
            ),
          ),
          // styles.footer, pinned under the scroll view (RN container's
          // paddingBottom: insets.bottom).
          Padding(
            padding: EdgeInsets.only(left: 24, right: 24, top: rn.mvs(16), bottom: rn.mvs(24) + insets.bottom),
            child: AppButton(
              key: const Key('bug-report-submit-button'),
              label: ref.t('bugReport.submit'),
              isLoading: _isSubmitting,
              isDisabled: !_canSubmit,
              onPressed: _submit,
            ),
          ),
        ],
      ),
    );
  }
}
