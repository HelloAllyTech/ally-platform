import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../../../core/localization/localization_controller.dart';
import '../../../../../core/localization/translate_ref.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_fonts.dart';
import '../../../../../core/theme/app_radius.dart';
import '../../../data/simulation_models.dart';
import '../../../data/simulations_repository.dart';
import '../../../../../core/widgets/sized_network_image.dart';
import '../../simulation_info_modal.dart';

/// Port of RN `SimulationFeedbackScreen/components/SummaryCard`: a white
/// card (0.5 stroke border, radius 8, soft shadow) with an optional title
/// row ruled off underneath.
class FeedbackSummaryCard extends StatelessWidget {
  const FeedbackSummaryCard({
    super.key,
    this.title,
    this.titleRight,
    required this.child,
    this.expand = false,
  });

  final String? title;
  final Widget? titleRight;
  final Widget child;

  /// RN's `flex: 1`: fill the available height, [child] taking the rest
  /// (needs bounded height — the transcript list). Otherwise sizes to fit.
  final bool expand;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.strokePrimary, width: 0.5),
        boxShadow: [
          BoxShadow(
            color: AppColors.grey900.withValues(alpha: 0.1),
            offset: const Offset(0, 2),
            blurRadius: 8,
          ),
        ],
      ),
      child: Column(
        mainAxisSize: expand ? MainAxisSize.max : MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (title != null && title!.isNotEmpty)
            Container(
              margin: const EdgeInsets.only(bottom: 16),
              padding: const EdgeInsets.only(bottom: 14),
              decoration: const BoxDecoration(
                border: Border(bottom: BorderSide(color: AppColors.strokePrimary, width: 0.5)),
              ),
              child: Row(
                children: [
                  Flexible(
                    child: Text(
                      title!,
                      style: const TextStyle(
                        fontFamily: AppFonts.ibmPlexSerifMedium,
                        fontSize: 14,
                        height: 22 / 14,
                        letterSpacing: 0.25,
                        color: AppColors.highEmphasis,
                      ),
                    ),
                  ),
                  if (titleRight != null) ...[const Spacer(), titleRight!],
                ],
              ),
            ),
          if (expand) Expanded(child: child) else child,
        ],
      ),
    );
  }
}

/// Port of RN `EventChecklist`: "Evaluation Checklist" and one tinted row
/// per event — green with a check when it happened in the session, red
/// with a cross when it didn't. Nothing at all when the list is empty.
class EventChecklist extends ConsumerWidget {
  const EventChecklist({super.key, required this.scenarioSessionId});

  final String scenarioSessionId;

  static const _itemText = TextStyle(
    fontFamily: AppFonts.ibmPlexSerifRegular,
    fontSize: 14,
    height: 22 / 14,
    letterSpacing: 0.2,
    color: AppColors.highEmphasis,
  );

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final checklist = ref.watch(eventChecklistProvider(scenarioSessionId));
    if (checklist.isLoading && !checklist.hasValue) {
      return const Center(
        child: SizedBox(
          width: 20,
          height: 20,
          child: CircularProgressIndicator.adaptive(
            strokeWidth: 2,
            valueColor: AlwaysStoppedAnimation(AppColors.primary),
          ),
        ),
      );
    }
    final items = checklist.value ?? const <EventChecklistItem>[];
    if (items.isEmpty) return const SizedBox.shrink();

    return Column(
      key: const Key('event-checklist'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Text(
            ref.t('learn.evaluationChecklist'),
            style: _itemText.copyWith(
              fontFamily: AppFonts.ibmPlexSerifMedium,
              color: AppColors.mediumEmphasis,
            ),
          ),
        ),
        for (var i = 0; i < items.length; i++) ...[
          if (i > 0) const SizedBox(height: 12),
          Container(
            key: ValueKey('event-checklist-${items[i].id}'),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: items[i].hasOccurred ? AppColors.lightGreen2 : AppColors.lightRed,
              borderRadius: BorderRadius.circular(AppRadius.lg),
              border: Border.all(
                color: items[i].hasOccurred ? AppColors.green200 : AppColors.red200,
                width: 0.5,
              ),
            ),
            child: Row(
              children: [
                SvgPicture.asset(
                  items[i].hasOccurred ? 'assets/icons/checkCircle.svg' : 'assets/icons/cancel.svg',
                  width: 19,
                  height: 19,
                ),
                const SizedBox(width: 16),
                Flexible(child: Text(items[i].name, style: _itemText)),
              ],
            ),
          ),
        ],
      ],
    );
  }
}

/// Port of RN `components/SessionRatingTrigger` (`size="sm"`): five 20pt
/// stars, 4 apart with 2 padding each, filled up to [value] (or to the star
/// being pressed).
class SessionRatingTrigger extends StatefulWidget {
  const SessionRatingTrigger({super.key, required this.value, this.onSelect, this.size = 20});

  final int value;
  final ValueChanged<int>? onSelect;
  final double size;

  @override
  State<SessionRatingTrigger> createState() => _SessionRatingTriggerState();
}

class _SessionRatingTriggerState extends State<SessionRatingTrigger> {
  int _pressed = 0;

  @override
  Widget build(BuildContext context) {
    final display = _pressed != 0 ? _pressed : widget.value;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (var star = 1; star <= 5; star++) ...[
          if (star > 1) const SizedBox(width: 4),
          Semantics(
            button: true,
            selected: star == widget.value,
            label: '$star of 5 stars',
            child: GestureDetector(
              key: ValueKey('session-rating-star-$star'),
              behavior: HitTestBehavior.opaque,
              onTapDown: (_) => setState(() => _pressed = star),
              onTapCancel: () => setState(() => _pressed = 0),
              onTapUp: (_) => setState(() => _pressed = 0),
              onTap: () => widget.onSelect?.call(star),
              child: Padding(
                padding: const EdgeInsets.all(2),
                child: _Star(size: widget.size, filled: star <= display),
              ),
            ),
          ),
        ],
      ],
    );
  }
}

class _Star extends StatelessWidget {
  const _Star({required this.size, required this.filled});

  final double size;
  final bool filled;

  @override
  Widget build(BuildContext context) {
    return SvgPicture.asset(
      'assets/icons/star.svg',
      width: size,
      height: size,
      colorFilter: ColorFilter.mode(filled ? AppColors.starYellow : AppColors.lightGray4, BlendMode.srcIn),
    );
  }
}

/// Port of RN `components/StarRating` (30pt stars, 4 either side, 8 above
/// and below), as used inside [FeedbackPopup].
class StarRatingRow extends StatelessWidget {
  const StarRatingRow({super.key, required this.rating, required this.onChanged});

  final int rating;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          for (var i = 0; i < 5; i++)
            GestureDetector(
              key: ValueKey('feedback-popup-star-${i + 1}'),
              behavior: HitTestBehavior.opaque,
              onTap: () => onChanged(i + 1),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 4),
                child: _Star(size: 30, filled: i < rating),
              ),
            ),
        ],
      ),
    );
  }
}

/// Port of RN `SummaryTab` → `SimulationSummary` for a short session (the
/// only case that still reaches it): a "Session Feedback" card with the
/// scenario cover, "ID: …", title, date • duration, and the "Session ended
/// too soon" hourglass.
class ShortSessionSummary extends ConsumerWidget {
  const ShortSessionSummary({super.key, required this.summary, required this.retryLimitReached});

  final SimulationSummary? summary;
  final bool retryLimitReached;

  static const _meta = TextStyle(
    fontFamily: AppFonts.ibmPlexSerifRegular,
    fontSize: 12,
    height: 18 / 12,
    color: AppColors.mediumEmphasis,
  );

  static String _duration(String? startedAt, String? endedAt) {
    final start = startedAt == null ? null : DateTime.tryParse(startedAt);
    final end = endedAt == null ? null : DateTime.tryParse(endedAt);
    if (start == null || end == null) return '-';
    final d = end.difference(start);
    final m = d.inMinutes.toString().padLeft(2, '0');
    final s = (d.inSeconds % 60).toString().padLeft(2, '0');
    return '$m:$s Min';
  }

  static const _fullMonths = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  /// RN `formatDateTime`: `{Month} {d}, {yyyy} {h}:{mm} {AM|PM}`, local
  /// time, month names from `months.full` when translated.
  @visibleForTesting
  static String formatDateTime(String iso, [List<dynamic>? months]) {
    final date = DateTime.tryParse(iso)?.toLocal();
    if (date == null) return '';
    final names = (months != null && months.length == 12) ? months.cast<String>() : _fullMonths;
    final hour12 = date.hour % 12 == 0 ? 12 : date.hour % 12;
    final ampm = date.hour >= 12 ? 'PM' : 'AM';
    return '${names[date.month - 1]} ${date.day}, ${date.year} '
        '$hour12:${date.minute.toString().padLeft(2, '0')} $ampm';
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final data = summary;
    if (data == null && !retryLimitReached) {
      return const Center(child: CircularProgressIndicator(color: AppColors.primary));
    }
    final sessionName = data?.sessionName ?? data?.id ?? '';
    final cover = data?.scenario?.coverImageUrl;
    final title = data?.scenario?.title;

    return SingleChildScrollView(
      padding: const EdgeInsets.only(bottom: 40),
      child: FeedbackSummaryCard(
        title: ref.t('postSim.feedback.sessionFeedback'),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (cover != null && cover.isNotEmpty) ...[
              ClipRRect(
                borderRadius: BorderRadius.circular(4),
                child: SizedNetworkImage(cover, height: 152.9, fit: BoxFit.cover),
              ),
              const SizedBox(height: 16),
            ],
            if (sessionName.isNotEmpty)
              SizedBox(height: 24, child: Align(alignment: Alignment.centerLeft, child: Text('ID: $sessionName', style: _meta))),
            if (title != null && title.isNotEmpty) ...[
              const SizedBox(height: 8),
              // styles.titleRow: title, gap 4, the 14pt help icon that opens
              // RN's SimulationDetailsModal (read-only, fitContent).
              Row(
                children: [
                  Flexible(
                    child: Text(
                      title,
                      style: const TextStyle(
                        fontFamily: AppFonts.ibmPlexSerifRegular,
                        fontSize: 14,
                        height: 18.2 / 14,
                        color: AppColors.highEmphasis,
                      ),
                    ),
                  ),
                  const SizedBox(width: 4),
                  GestureDetector(
                    key: const Key('short-session-help'),
                    behavior: HitTestBehavior.opaque,
                    onTap: () => SimulationInfoModal.show(
                      context,
                      headerTitle: title,
                      title: ref.tr('simulationPage.simulationDetails'),
                      description: data?.scenario?.description,
                      coverImageUrl: cover,
                      coverVideoUrl: data?.scenario?.coverVideoUrl,
                    ),
                    child: SvgPicture.asset('assets/icons/help.svg', width: 14, height: 14),
                  ),
                ],
              ),
            ],
            if (data != null) ...[
              const SizedBox(height: 8),
              Row(
                children: [
                  Text(
                    formatDateTime(
                      data.startedAt,
                      ref.watch(localizationControllerProvider).value?.raw('months.full') as List<dynamic>?,
                    ),
                    style: _meta,
                  ),
                  const SizedBox(width: 8),
                  const Text(
                    '•',
                    style: TextStyle(
                      fontFamily: AppFonts.ibmPlexSerifRegular,
                      fontSize: 16,
                      height: 24 / 16,
                      letterSpacing: -0.5,
                      color: AppColors.strokeLightGray,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text(_duration(data.startedAt, data.endedAt), style: _meta),
                ],
              ),
            ],
            const SizedBox(height: 16),
            Padding(
              padding: const EdgeInsets.only(left: 24, right: 24, bottom: 30),
              child: Column(
                children: [
                  SvgPicture.asset('assets/icons/hourGlass.svg'),
                  const SizedBox(height: 20),
                  Text(
                    ref.t('postSim.shortSession.title'),
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontFamily: AppFonts.ibmPlexSerifMedium,
                      fontSize: 24,
                      height: 32 / 24,
                      color: AppColors.highEmphasis,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    ref.t('postSim.shortSession.description'),
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontFamily: AppFonts.ibmPlexSerifRegular,
                      fontSize: 16,
                      height: 24 / 16,
                      letterSpacing: 0.5,
                      color: AppColors.mediumEmphasis,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
