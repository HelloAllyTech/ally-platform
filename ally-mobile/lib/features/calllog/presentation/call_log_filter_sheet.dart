import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/settings/settings_repository.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_text_field.dart';
import '../data/call_log_repository.dart';
import '../data/custom_fields_filter.dart';
import '../data/custom_fields_repository.dart';

const _modeOptions = [(label: 'Scribe', value: 'SCRIBE'), (label: 'Dictation', value: 'DICTATION')];

const _statusOptions = [
  (label: 'Generated', value: 'SUCCESS'),
  (label: 'Processing', value: 'PROCESSING'),
  (label: 'Error', value: 'FAILED'),
  (label: 'No Audio', value: 'NO_AUDIO'),
];

const _sourceOptions = [(label: 'Live Session', value: 'LIVE'), (label: 'Uploaded', value: 'UPLOAD')];

/// Direct port of ally-mobile (React Native)'s `CallLogFilterSheet`: the
/// built-in filters (date range, duration range, mode/status/channel/tags
/// multiselects) plus, now, the tenant-configured custom-field filters
/// (`fieldFilters`, driven by `CustomFieldDefinition` via
/// `custom_fields_repository.dart`/`custom_fields_filter.dart`). Unlike RN's
/// single data-driven `getFilterFields` (which merges both kinds into one
/// list), the built-ins stay hand-built here and the custom fields are
/// appended as their own section — this app has no generic field-filter
/// catalog for the *built-in* columns, only for the custom ones. Field/option
/// labels are literal English here for the built-ins, matching RN's
/// `fieldFilters.ts` exactly (it hardcodes these rather than running them
/// through `t()`, the same inconsistency `StatusBadge`'s own doc comment
/// already documents for the identical Status options); custom-field names
/// are tenant-authored text, never translated in RN either.
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

  // Custom-field text/range controllers can't be created up front like the
  // built-in ones above — the field catalog itself only arrives once
  // `customFieldDefinitionsProvider` resolves — so these are created lazily
  // on first render of each field and cached here for the sheet's lifetime.
  final Map<String, TextEditingController> _customTextControllers = {};
  final Map<String, List<TextEditingController>> _customRangeControllers = {};

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
    for (final controller in _customTextControllers.values) {
      controller.dispose();
    }
    for (final pair in _customRangeControllers.values) {
      for (final controller in pair) {
        controller.dispose();
      }
    }
    super.dispose();
  }

  TextEditingController _customTextController(String id) => _customTextControllers.putIfAbsent(
    id,
    () => TextEditingController(text: _draft.customFieldValues[id] is String ? _draft.customFieldValues[id] as String : ''),
  );

  List<TextEditingController> _customRangeController(String id) => _customRangeControllers.putIfAbsent(id, () {
    final current = _draft.customFieldValues[id];
    final list = current is List ? current : const [];
    return [
      TextEditingController(text: list.isNotEmpty ? list[0].toString() : ''),
      TextEditingController(text: list.length > 1 ? list[1].toString() : ''),
    ];
  });

  void _setCustomFieldText(String id, String value) {
    setState(() => _draft = _draft.copyWith(customFieldValues: {..._draft.customFieldValues, id: value}));
  }

  void _setCustomFieldRange(String id, int index, String value) {
    setState(() {
      final current = _draft.customFieldValues[id];
      final list = current is List ? List<String>.from(current.map((e) => e.toString())) : ['', ''];
      list[index] = value;
      _draft = _draft.copyWith(customFieldValues: {..._draft.customFieldValues, id: list});
    });
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
      for (final controller in _customTextControllers.values) {
        controller.clear();
      }
      for (final pair in _customRangeControllers.values) {
        for (final controller in pair) {
          controller.clear();
        }
      }
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
                    ..._customFieldsSection(),
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

  /// Mirrors RN's `getFilterFields`'s custom-field half: shown only when the
  /// tenant has the custom-fields system enabled at all (loading/error both
  /// render nothing rather than flashing fields that may not apply).
  List<Widget> _customFieldsSection() {
    final enabledAsync = ref.watch(customFieldsEnabledProvider);
    final enabled = enabledAsync.value ?? false;
    if (!enabled) return const [];

    final defsAsync = ref.watch(customFieldDefinitionsProvider);
    return defsAsync.maybeWhen(
      data: (defs) => [
        for (final def in customFieldFilterDefs(defs)) _field(def.label, _controlForCustomField(def)),
      ],
      orElse: () => const [],
    );
  }

  Widget _controlForCustomField(CustomFieldFilterDef def) {
    switch (def.control) {
      case FilterControl.multiselect:
        final selected = switch (_draft.customFieldValues[def.id]) {
          final List list => list.map((e) => e.toString()).toList(),
          _ => const <String>[],
        };
        return _chipRow(
          def.options,
          selected,
          (next) => setState(() => _draft = _draft.copyWith(customFieldValues: {..._draft.customFieldValues, def.id: next})),
        );

      case FilterControl.number:
      case FilterControl.date:
        final controllers = _customRangeController(def.id);
        final isNumber = def.control == FilterControl.number;
        return Row(
          children: [
            Expanded(
              child: AppTextField(
                shape: AppTextFieldShape.line,
                controller: controllers[0],
                placeholder: isNumber ? ref.t('calls.filters.min') : ref.t('calls.filters.from'),
                keyboardType: isNumber ? TextInputType.number : TextInputType.text,
                onChanged: (text) => _setCustomFieldRange(def.id, 0, text),
              ),
            ),
            const SizedBox(width: 8),
            const Text('–', style: TextStyle(color: AppColors.mediumEmphasis)),
            const SizedBox(width: 8),
            Expanded(
              child: AppTextField(
                shape: AppTextFieldShape.line,
                controller: controllers[1],
                placeholder: isNumber ? ref.t('calls.filters.max') : ref.t('calls.filters.to'),
                keyboardType: isNumber ? TextInputType.number : TextInputType.text,
                onChanged: (text) => _setCustomFieldRange(def.id, 1, text),
              ),
            ),
          ],
        );

      case FilterControl.text:
        return AppTextField(
          shape: AppTextFieldShape.line,
          controller: _customTextController(def.id),
          placeholder: ref.t('calls.filters.searchPlaceholder'),
          onChanged: (text) => _setCustomFieldText(def.id, text),
        );
    }
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
            onChanged: (text) => _draft = _draft.withDates(start: text, end: _draft.endDate),
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
            onChanged: (text) => _draft = _draft.withDates(start: _draft.startDate, end: text),
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
            onChanged: (text) =>
                _draft = _draft.withDuration(min: double.tryParse(text), max: _draft.maxDuration),
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
            onChanged: (text) =>
                _draft = _draft.withDuration(min: _draft.minDuration, max: double.tryParse(text)),
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
