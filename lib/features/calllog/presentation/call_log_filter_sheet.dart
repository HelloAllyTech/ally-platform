import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_text_field.dart';
import '../data/call_log_repository.dart';

const _modeOptions = [(label: 'Scribe', value: 'SCRIBE'), (label: 'Dictation', value: 'DICTATION')];

const _statusOptions = [
  (label: 'Generated', value: 'SUCCESS'),
  (label: 'Processing', value: 'PROCESSING'),
  (label: 'Error', value: 'FAILED'),
  (label: 'No Audio', value: 'NO_AUDIO'),
];

const _sourceOptions = [(label: 'Live Session', value: 'LIVE'), (label: 'Uploaded', value: 'UPLOAD')];

/// Direct port of ally-mobile (React Native)'s `CallLogFilterSheet` — scoped
/// to the built-in filters (date range, duration range, mode/status/channel/
/// tags multiselects). RN's dynamic, tenant-configured custom-field filters
/// (`fieldFilters`, driven by a `CustomFieldDefinition` catalog) aren't
/// ported — this app has no client for that catalog yet. Field/option labels
/// are literal English here, matching RN's `fieldFilters.ts` exactly (it
/// hardcodes these rather than running them through `t()`, the same
/// inconsistency `StatusBadge`'s own doc comment already documents for the
/// identical Status options).
class CallLogFilterSheet extends ConsumerStatefulWidget {
  const CallLogFilterSheet({super.key, required this.hasTagsPermission});

  final bool hasTagsPermission;

  static Future<void> show(BuildContext context, {required bool hasTagsPermission}) {
    return showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (context) => CallLogFilterSheet(hasTagsPermission: hasTagsPermission),
    );
  }

  @override
  ConsumerState<CallLogFilterSheet> createState() => _CallLogFilterSheetState();
}

class _CallLogFilterSheetState extends ConsumerState<CallLogFilterSheet> {
  late CallLogFilterState _draft;
  late final TextEditingController _startDateController;
  late final TextEditingController _endDateController;
  late final TextEditingController _minDurationController;
  late final TextEditingController _maxDurationController;

  @override
  void initState() {
    super.initState();
    _draft = ref.read(callLogFilterProvider);
    _startDateController = TextEditingController(text: _draft.startDate ?? '');
    _endDateController = TextEditingController(text: _draft.endDate ?? '');
    _minDurationController = TextEditingController(text: _draft.minDuration?.toString() ?? '');
    _maxDurationController = TextEditingController(text: _draft.maxDuration?.toString() ?? '');
  }

  @override
  void dispose() {
    _startDateController.dispose();
    _endDateController.dispose();
    _minDurationController.dispose();
    _maxDurationController.dispose();
    super.dispose();
  }

  void _toggle(List<String> current, String value, ValueChanged<List<String>> onChanged) {
    onChanged(
      current.contains(value)
          ? current.where((v) => v != value).toList()
          : [...current, value],
    );
  }

  void _handleClear() {
    setState(() {
      _draft = const CallLogFilterState();
      _startDateController.clear();
      _endDateController.clear();
      _minDurationController.clear();
      _maxDurationController.clear();
    });
  }

  void _handleApply() {
    ref.read(callLogFilterProvider.notifier).apply(_draft);
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      initialChildSize: 0.7,
      expand: false,
      builder: (context, scrollController) {
        return Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20).add(
            EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: 12),
              Text(
                ref.t('calls.filters.title'),
                style: const TextStyle(
                  fontFamily: AppFonts.ibmPlexSerifMedium,
                  fontSize: 14,
                  color: AppColors.highEmphasis,
                ),
              ),
              const SizedBox(height: 12),
              Expanded(
                child: ListView(
                  controller: scrollController,
                  children: [
                    _field('Date & Time', _dateRangeRow()),
                    _field('Duration (mins)', _durationRangeRow()),
                    _field(
                      'Mode',
                      _chipRow(
                        _modeOptions,
                        _draft.modes,
                        (next) => setState(() => _draft = _draft.copyWith(modes: next)),
                      ),
                    ),
                    _field(
                      'Status',
                      _chipRow(
                        _statusOptions,
                        _draft.statuses,
                        (next) => setState(() => _draft = _draft.copyWith(statuses: next)),
                      ),
                    ),
                    _field(
                      'Channel',
                      _chipRow(
                        _sourceOptions,
                        _draft.sources,
                        (next) => setState(() => _draft = _draft.copyWith(sources: next)),
                      ),
                    ),
                    if (widget.hasTagsPermission) _tagsField(),
                  ],
                ),
              ),
              Row(
                children: [
                  Expanded(
                    child: AppButton(
                      label: ref.t('calls.filters.clear'),
                      variant: AppButtonVariant.secondary,
                      onPressed: _handleClear,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: AppButton(
                      label: ref.t('calls.filters.apply'),
                      onPressed: _handleApply,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
            ],
          ),
        );
      },
    );
  }

  Widget _tagsField() {
    final tagOptionsAsync = ref.watch(callLogTagOptionsProvider);
    return tagOptionsAsync.maybeWhen(
      data: (tagOptions) => tagOptions.isEmpty
          ? const SizedBox.shrink()
          : _field(
              'Tags',
              _chipRow(
                [for (final tag in tagOptions) (label: tag, value: tag)],
                _draft.tags,
                (next) => setState(() => _draft = _draft.copyWith(tags: next)),
              ),
            ),
      orElse: () => const SizedBox.shrink(),
    );
  }

  Widget _field(String label, Widget control) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: const TextStyle(
              fontFamily: AppFonts.ibmPlexSerifMedium,
              fontSize: 14,
              color: AppColors.highEmphasis,
            ),
          ),
          const SizedBox(height: 8),
          control,
        ],
      ),
    );
  }

  Widget _chipRow(
    List<({String label, String value})> options,
    List<String> selected,
    ValueChanged<List<String>> onChanged,
  ) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        for (final option in options)
          _FilterChip(
            label: option.label,
            selected: selected.contains(option.value),
            onTap: () => _toggle(selected, option.value, onChanged),
          ),
      ],
    );
  }

  Widget _dateRangeRow() {
    return Row(
      children: [
        Expanded(
          child: AppTextField(
            shape: AppTextFieldShape.line,
            controller: _startDateController,
            placeholder: ref.t('calls.filters.from'),
            onChanged: (text) => _draft = _draft.copyWith(startDate: text),
          ),
        ),
        const SizedBox(width: 8),
        const Text('–', style: TextStyle(color: AppColors.mediumEmphasis)),
        const SizedBox(width: 8),
        Expanded(
          child: AppTextField(
            shape: AppTextFieldShape.line,
            controller: _endDateController,
            placeholder: ref.t('calls.filters.to'),
            onChanged: (text) => _draft = _draft.copyWith(endDate: text),
          ),
        ),
      ],
    );
  }

  Widget _durationRangeRow() {
    return Row(
      children: [
        Expanded(
          child: AppTextField(
            shape: AppTextFieldShape.line,
            controller: _minDurationController,
            placeholder: ref.t('calls.filters.min'),
            keyboardType: TextInputType.number,
            onChanged: (text) => _draft = _draft.copyWith(minDuration: double.tryParse(text)),
          ),
        ),
        const SizedBox(width: 8),
        const Text('–', style: TextStyle(color: AppColors.mediumEmphasis)),
        const SizedBox(width: 8),
        Expanded(
          child: AppTextField(
            shape: AppTextFieldShape.line,
            controller: _maxDurationController,
            placeholder: ref.t('calls.filters.max'),
            keyboardType: TextInputType.number,
            onChanged: (text) => _draft = _draft.copyWith(maxDuration: double.tryParse(text)),
          ),
        ),
      ],
    );
  }
}

class _FilterChip extends StatelessWidget {
  const _FilterChip({required this.label, required this.selected, required this.onTap});

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: selected ? AppColors.primary : null,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: selected ? AppColors.primary : AppColors.strokePrimary),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontFamily: AppFonts.ibmPlexSerifRegular,
            fontSize: 12,
            color: selected ? Colors.white : AppColors.mediumEmphasis,
          ),
        ),
      ),
    );
  }
}
