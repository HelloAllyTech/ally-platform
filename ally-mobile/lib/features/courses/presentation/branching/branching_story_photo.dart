import '../../data/start_item_payload.dart';

/// The photo a story-mode scene shows. [pathNodeIds] are the nodes the
/// learner has passed through on the current run, in order, ending with the
/// node on screen.
///
/// The node's own image wins; otherwise the most recent image on the path
/// (so a scene without a photo keeps the last one the learner saw); otherwise
/// the first node in [nodes] order that has one. `null` only when the
/// scenario has no images at all — the player then falls back to the
/// classic layout.
BranchingImage? branchingStoryPhoto({
  required List<BranchingNode> nodes,
  required List<String> pathNodeIds,
}) {
  final byId = {for (final n in nodes) n.id: n};
  for (final id in pathNodeIds.reversed) {
    final image = _usable(byId[id]?.image);
    if (image != null) return image;
  }
  for (final node in nodes) {
    final image = _usable(node.image);
    if (image != null) return image;
  }
  return null;
}

BranchingImage? _usable(BranchingImage? image) =>
    image != null && image.url.trim().isNotEmpty ? image : null;
