import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/course_models.dart';
import '../data/courses_repository.dart';

/// Scoped port of ally-mobile (React Native)'s `CourseItemPlayerScreen`
/// (7,700 lines in the original) — ARTICLE and VIDEO item types only.
/// QUIZ (multiple question types), ROLEPLAY, CASE, JOURNAL, and GAME item
/// players are real, separate work for a later phase; `CourseDetailScreen`
/// already routes those elsewhere rather than opening this screen for them.
class CourseItemPlayerScreen extends ConsumerStatefulWidget {
  const CourseItemPlayerScreen({super.key, required this.item});

  final TrackDetailItem item;

  @override
  ConsumerState<CourseItemPlayerScreen> createState() =>
      _CourseItemPlayerScreenState();
}

class _CourseItemPlayerScreenState
    extends ConsumerState<CourseItemPlayerScreen> {
  double _watchedPct = 0;
  Timer? _progressTimer;
  bool _completed = false;

  @override
  void initState() {
    super.initState();
    ref.read(coursesRepositoryProvider).startTrackItem(widget.item.id);
    if (widget.item.type == TrackItemType.video) {
      // Matches the RN screen's own ~10s video-progress reporting cadence
      // (see coursesRepository.dart's doc comment).
      _progressTimer = Timer.periodic(const Duration(seconds: 10), (_) {
        if (_completed) return;
        setState(() => _watchedPct = (_watchedPct + 0.2).clamp(0, 1));
        ref.read(coursesRepositoryProvider).reportVideoProgress(
              itemId: widget.item.id,
              watchedPct: _watchedPct,
            );
        if (_watchedPct >= 1) _markComplete();
      });
    }
  }

  @override
  void dispose() {
    _progressTimer?.cancel();
    super.dispose();
  }

  Future<void> _markComplete() async {
    if (widget.item.type == TrackItemType.article) {
      await ref.read(coursesRepositoryProvider).markArticleRead(widget.item.id);
    }
    if (mounted) setState(() => _completed = true);
  }

  @override
  Widget build(BuildContext context) {
    final item = widget.item;
    return Scaffold(
      appBar: AppBar(title: Text(item.title)),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (item.description != null)
              Text(item.description!, style: Theme.of(context).textTheme.bodyLarge),
            const SizedBox(height: 24),
            if (item.type == TrackItemType.video) ...[
              Container(
                height: 200,
                alignment: Alignment.center,
                color: Colors.black12,
                child: const Text(
                  'Video playback not ported yet — this simulates watch '
                  'progress to exercise the real video-progress endpoint.',
                  textAlign: TextAlign.center,
                ),
              ),
              const SizedBox(height: 16),
              LinearProgressIndicator(value: _watchedPct),
              Text('${(_watchedPct * 100).round()}% watched'),
            ],
            const Spacer(),
            if (_completed)
              const Row(
                children: [
                  Icon(Icons.check_circle, color: Colors.green),
                  SizedBox(width: 8),
                  Text('Completed'),
                ],
              )
            else if (item.type == TrackItemType.article)
              FilledButton(
                onPressed: _markComplete,
                child: const Text('Mark as read'),
              ),
          ],
        ),
      ),
    );
  }
}
