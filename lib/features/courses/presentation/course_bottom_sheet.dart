import 'package:flutter/material.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/rn_scale.dart';

/// RN `components/BottomSheet` as the course screens use it: white, 16pt top
/// corners, an 80x4 stroke-coloured handle (marginTop 8@mvs), 50% black
/// backdrop, opened at `initialSnapPoint` percent of the screen
/// ([heightFraction]) with `enableDynamicSizing={false}`. RN pads the
/// content by the bottom safe-area inset.
Future<T?> showCourseBottomSheet<T>(
  BuildContext context, {
  required double heightFraction,
  required WidgetBuilder builder,
}) {
  return showModalBottomSheet<T>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.white,
    barrierColor: Colors.black.withValues(alpha: 0.5),
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(16))),
    clipBehavior: Clip.antiAlias,
    builder: (sheetContext) {
      final media = MediaQuery.of(sheetContext);
      return Padding(
        padding: EdgeInsets.only(bottom: media.viewInsets.bottom),
        child: SizedBox(
          height: media.size.height * heightFraction,
          child: Column(
            children: [
              Padding(
                padding: EdgeInsets.only(top: RnSize.of(sheetContext).mvs(8), bottom: 8),
                child: Container(
                  key: const Key('course-sheet-handle'),
                  width: 80,
                  height: 4,
                  decoration: BoxDecoration(color: AppColors.strokePrimary, borderRadius: BorderRadius.circular(2)),
                ),
              ),
              Expanded(
                child: Padding(
                  padding: EdgeInsets.only(bottom: media.padding.bottom),
                  child: builder(sheetContext),
                ),
              ),
            ],
          ),
        ),
      );
    },
  );
}
