import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/courses/data/start_item_payload.dart';
import 'package:ally_mobile_flutter/features/courses/presentation/branching/branching_story_photo.dart';

BranchingNode _node(String id, [String? url]) => BranchingNode(
  id: id,
  text: 'Scene $id',
  image: url == null ? null : BranchingImage(url: url),
);

void main() {
  group('branchingStoryPhoto', () {
    test("the current node's own image wins", () {
      final nodes = [_node('a', 'https://img/a.jpg'), _node('b', 'https://img/b.jpg')];
      expect(branchingStoryPhoto(nodes: nodes, pathNodeIds: ['a', 'b'])?.url, 'https://img/b.jpg');
    });

    test('without one, the most recent image on the path carries over', () {
      final nodes = [
        _node('a', 'https://img/a.jpg'),
        _node('b', 'https://img/b.jpg'),
        _node('c'),
        _node('d'),
      ];
      expect(
        branchingStoryPhoto(nodes: nodes, pathNodeIds: ['a', 'b', 'c', 'd'])?.url,
        'https://img/b.jpg',
      );
    });

    test('with no image on the path, the first node in nodes order with one is used', () {
      final nodes = [_node('start'), _node('x'), _node('y', 'https://img/y.jpg'), _node('z', 'https://img/z.jpg')];
      expect(branchingStoryPhoto(nodes: nodes, pathNodeIds: ['start'])?.url, 'https://img/y.jpg');
    });

    test('nodes off the path do not count as "most recent"', () {
      final nodes = [_node('a'), _node('elsewhere', 'https://img/e.jpg'), _node('b', 'https://img/b.jpg'), _node('c')];
      // Path a -> c skips b; falls through to the first imaged node.
      expect(branchingStoryPhoto(nodes: nodes, pathNodeIds: ['a', 'c'])?.url, 'https://img/e.jpg');
    });

    test('an empty url counts as no image', () {
      final nodes = [_node('a', 'https://img/a.jpg'), _node('b', '  ')];
      expect(branchingStoryPhoto(nodes: nodes, pathNodeIds: ['a', 'b'])?.url, 'https://img/a.jpg');
    });

    test('a scenario with no images at all has no photo (classic layout)', () {
      final nodes = [_node('a'), _node('b')];
      expect(branchingStoryPhoto(nodes: nodes, pathNodeIds: ['a', 'b']), isNull);
    });

    test('an unknown id on the path is skipped', () {
      final nodes = [_node('a', 'https://img/a.jpg')];
      expect(branchingStoryPhoto(nodes: nodes, pathNodeIds: ['a', 'missing'])?.url, 'https://img/a.jpg');
    });
  });
}
