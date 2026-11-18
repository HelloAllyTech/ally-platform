import 'package:flutter/material.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_radius.dart';

/// Port of ally-mobile (React Native)'s `src/components/SimulationsSkeleton`
/// — the Learn tab's loading placeholder: [count] outlined cards with a
/// cover block and two title bars, each swept by a translucent white block
/// sliding -200 → 200 → -200 over 2s.
class SimulationsSkeleton extends StatefulWidget {
  const SimulationsSkeleton({super.key, this.count = 3});

  final int count;

  @override
  State<SimulationsSkeleton> createState() => _SimulationsSkeletonState();
}

class _SimulationsSkeletonState extends State<SimulationsSkeleton>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1000),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Widget _bone({double? height, double? widthFactor, double radius = 4, EdgeInsets? margin}) {
    final bone = Container(
      height: height,
      margin: margin,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: AppColors.grey100,
        borderRadius: BorderRadius.circular(radius),
      ),
      child: AnimatedBuilder(
        animation: _controller,
        builder: (context, _) => Transform.translate(
          offset: Offset(-200 + 400 * _controller.value, 0),
          // colors.ds.whiteAlpha[500]
          child: const ColoredBox(color: Color(0x52FFFFFF), child: SizedBox.expand()),
        ),
      ),
    );
    if (widthFactor == null) return bone;
    return FractionallySizedBox(
      alignment: Alignment.centerLeft,
      widthFactor: widthFactor,
      child: bone,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 10, bottom: 90),
      child: Column(
        children: [
          for (var i = 0; i < widget.count; i++) ...[
            if (i > 0) const SizedBox(height: 12),
            Container(
              margin: const EdgeInsets.symmetric(horizontal: 2),
              padding: const EdgeInsets.only(top: 8, bottom: 16),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(AppRadius.xl3),
                border: Border.all(color: AppColors.strokePrimary, width: 0.5),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _bone(
                    height: 180,
                    radius: 16,
                    margin: const EdgeInsets.only(left: 8, right: 8, bottom: 8),
                  ),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 18),
                    child: Column(
                      children: [
                        Padding(
                          padding: const EdgeInsets.only(bottom: 4),
                          child: _bone(height: 20, widthFactor: 0.8),
                        ),
                        Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: _bone(height: 20, widthFactor: 0.6),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}
