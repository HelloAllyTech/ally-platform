import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/courses/data/quiz_models.dart';
import 'package:ally_mobile_flutter/features/courses/presentation/question_media.dart';

import '../../../support/pump_app.dart';

void main() {
  test('questionMediaEmbedUrl mirrors RN embedUrlFor', () {
    QuestionMedia video(String url) => QuestionMedia(kind: 'video', source: 'youtube', url: url);
    expect(questionMediaEmbedUrl(video('https://youtu.be/abcdef123')), 'https://www.youtube.com/embed/abcdef123');
    expect(questionMediaEmbedUrl(video('https://vimeo.com/12345')), 'https://player.vimeo.com/video/12345');
    expect(questionMediaEmbedUrl(video('https://www.loom.com/share/abc123')), 'https://www.loom.com/embed/abc123');
    expect(questionMediaEmbedUrl(video('https://example.com/x')), isNull);
    expect(QuestionMedia.maybeFromJson({'kind': 'image', 'url': ''}), isNull);
  });

  testWidgets('an image that fails to load says so in words, with its alt text', (tester) async {
    await pumpApp(
      tester,
      Scaffold(
        body: QuestionMediaView(
          media: QuestionMedia(kind: 'image', source: 's3', url: 'https://example.invalid/x.png', alt: 'A chart'),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('question-media-failed')), findsOneWidget);
    expect(find.text('A chart'), findsOneWidget);
  });
}
