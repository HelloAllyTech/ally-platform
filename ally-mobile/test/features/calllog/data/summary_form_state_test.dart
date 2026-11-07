import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/calllog/data/summary_form_state.dart';

void main() {
  test('dirty = differs from the saved baseline', () {
    final form = SummaryFormState()..seed({'flow': 'a'}, chatId: 1);
    expect(form.hasChanges, isFalse);
    form.set('flow', 'b');
    expect(form.changedKeys, ['flow']);
    form.set('flow', 'a');
    expect(form.hasChanges, isFalse);
  });

  test('an edit typed while a save is in flight stays unsaved', () {
    final form = SummaryFormState()..seed({'flow': 'a', 'tags': null}, chatId: 1);
    form.set('flow', 'b');
    final sent = form.pendingPatch();
    expect(sent, {'flow': 'b'});
    form.set('flow', 'bc'); // typed during the request
    form.set('tags', 'x');
    form.markSaved(sent); // request resolves
    expect(form.changedKeys.toSet(), {'flow', 'tags'});
    expect(form.pendingPatch(), {'flow': 'bc', 'tags': 'x'});
  });

  test('a reseed of the same chat refreshes the baseline but keeps unsaved edits', () {
    final form = SummaryFormState()..seed({'flow': null, 'assessment': null}, chatId: 1);
    form.set('assessment', 'typed');
    // The AI summary lands while the counsellor is typing.
    form.seed({'flow': 'ai flow', 'assessment': 'ai assessment'}, chatId: 1);
    expect(form['flow'], 'ai flow');
    expect(form['assessment'], 'typed');
    expect(form.changedKeys, ['assessment']);
  });

  test('a different chat starts clean', () {
    final form = SummaryFormState()..seed({'flow': 'a'}, chatId: 1);
    form.set('flow', 'typed');
    form.seed({'flow': 'other'}, chatId: 2);
    expect(form['flow'], 'other');
    expect(form.hasChanges, isFalse);
  });

  test('reset puts fields back to the last-saved values', () {
    final form = SummaryFormState()..seed({'flow': 'a', 'age': '0-5'}, chatId: 1);
    form
      ..set('flow', 'b')
      ..set('age', '6-12')
      ..reset(['flow']);
    expect(form['flow'], 'a');
    expect(form.changedKeys, ['age']);
  });
}
