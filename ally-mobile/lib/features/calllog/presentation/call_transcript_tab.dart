import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../scribe/presentation/call_transcript_item.dart';
import '../../simulations/presentation/widgets/feedback/feedback_widgets.dart';
import '../data/call_log_repository.dart';

/// RN `utils/date.formatTimeToMMSS`.
String formatTranscriptTime(int milliseconds) {
  final totalSeconds = (milliseconds / 1000).floor();
  final minutes = totalSeconds ~/ 60;
  final seconds = totalSeconds % 60;
  return '${minutes.toString().padLeft(2, '0')}:${seconds.toString().padLeft(2, '0')}';
}

/// RN `useCallTranscriptDetails`' per-message time: WEBRTC calls measure
/// from the chat's `createdAt`, everything else uses `startSeconds`.
String transcriptTimeFor(ChatMessage message, CallSummaryDetails? summary) {
  if (summary?.callProvider == 'WEBRTC') {
    final started = DateTime.tryParse(summary?.createdAt ?? '');
    final sent = DateTime.tryParse(message.createdAt);
    if (started == null || sent == null) return formatTranscriptTime(0);
    return formatTranscriptTime(sent.difference(started).inMilliseconds);
  }
  return formatTranscriptTime(((message.startSeconds ?? 0) * 1000).round());
}

/// Port of RN `CallSummaryScreen/components/CallTranscript`: the
/// transcript inside a "Transcript" SummaryCard — one bordered
/// `CallTranscriptItem` per turn with its mm:ss time and You/Client label,
/// or, for a DICTATION note, every turn merged into one white block. An
/// empty transcript shows RN's `EmptyTranscript`.
class CallTranscriptTab extends ConsumerWidget {
  const CallTranscriptTab({super.key, required this.messagesAsync, required this.summary});

  final AsyncValue<List<ChatMessage>> messagesAsync;
  final CallSummaryDetails? summary;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final counselorId = summary?.counselorId;
    final Widget body = messagesAsync.when(
      loading: () => const Center(child: CircularProgressIndicator.adaptive()),
      error: (error, _) => const _EmptyTranscript(),
      data: (messages) {
        if (summary?.callMode == 'DICTATION') {
          return SingleChildScrollView(child: _DictationBlock(message: messages.map((m) => m.content).join(' ')));
        }
        if (messages.isEmpty) return const _EmptyTranscript();
        return ListView.builder(
          padding: const EdgeInsets.only(bottom: 48),
          itemCount: messages.length,
          itemBuilder: (context, index) {
            final message = messages[index];
            final isCounselor = message.senderId == counselorId;
            return CallTranscriptItem(
              time: transcriptTimeFor(message, summary),
              message: message.content,
              counselor: isCounselor,
              speakerLabel: ref.t(isCounselor ? 'transcription.youLabel' : 'transcription.clientLabel'),
            );
          },
        );
      },
    );
    return FeedbackSummaryCard(expand: true, title: ref.t('callSummary.header.transcript'), child: body);
  }
}

/// RN `CallTranscriptItem` with `isDictation`: white, grey[300] border, an
/// empty time/speaker row above the merged text.
class _DictationBlock extends StatelessWidget {
  const _DictationBlock({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const Key('dictation-transcript'),
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: AppColors.grey300, width: 0.5),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(' ', style: TextStyle(fontFamily: AppFonts.ibmPlexSerifRegular, fontSize: 13, letterSpacing: 0.1)),
          const SizedBox(height: 4),
          Text(
            message,
            style: const TextStyle(
              fontFamily: AppFonts.ibmPlexSerifRegular,
              fontSize: 13,
              color: AppColors.highEmphasis,
              letterSpacing: 0.25,
              height: 20 / 13,
            ),
          ),
        ],
      ),
    );
  }
}

/// RN `components/EmptyTranscript`.
class _EmptyTranscript extends ConsumerWidget {
  const _EmptyTranscript();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return LayoutBuilder(
      builder: (context, constraints) => SingleChildScrollView(
        child: Padding(
          padding: EdgeInsets.only(top: constraints.maxWidth * 0.4),
          child: Column(
            children: [
              SvgPicture.asset('assets/icons/emptyTranscript.svg'),
              const SizedBox(height: 30),
              Padding(
                padding: EdgeInsets.symmetric(horizontal: constraints.maxWidth * 0.3),
                child: Text(
                  ref.t('transcription.empty'),
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontFamily: AppFonts.ibmPlexSerifMedium,
                    fontSize: 16,
                    height: 24 / 16,
                    color: AppColors.darkGray2,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
