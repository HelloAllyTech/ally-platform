package com.helloally.app.commentabletext

/**
 * Represents a single thread range (from the backend).
 */
data class ThreadRange(
    val id: String,
    val start: Int,
    val end: Int
)

/**
 * Represents a segment of the message text that may be covered by zero or more thread IDs.
 * After segmentation, every character in the original text belongs to exactly one segment.
 */
data class TextSegment(
    val start: Int,
    val end: Int,
    val threadIds: List<String>
)

/**
 * Utility for splitting message text into non-overlapping segments,
 * each annotated with the set of thread IDs that cover it.
 *
 * Uses a boundary-based approach so that overlapping ranges are handled
 * correctly: every unique boundary (start or end of any range, plus 0 and
 * content.length) becomes a split point, then each resulting interval is
 * tagged with every range that fully contains it.
 */
object SegmentUtils {

    /**
     * @param contentLength  length of the message content string
     * @param ranges         thread ranges (indices refer to content only)
     * @return               list of [TextSegment] covering [0, contentLength)
     */
    fun buildSegments(contentLength: Int, ranges: List<ThreadRange>): List<TextSegment> {
        if (contentLength <= 0) return emptyList()

        // 1) Normalize & clamp
        val cleaned = ranges.mapNotNull { r ->
            val s = r.start.coerceIn(0, contentLength)
            val e = r.end.coerceIn(0, contentLength)
            if (e > s) ThreadRange(r.id, s, e) else null
        }

        if (cleaned.isEmpty()) {
            return listOf(TextSegment(0, contentLength, emptyList()))
        }

        // 2) Collect boundary points
        val boundaries = sortedSetOf(0, contentLength)
        for (r in cleaned) {
            boundaries.add(r.start)
            boundaries.add(r.end)
        }
        val points = boundaries.toList()

        // 3) Build segments
        val segments = mutableListOf<TextSegment>()
        for (i in 0 until points.size - 1) {
            val segStart = points[i]
            val segEnd = points[i + 1]
            if (segStart == segEnd) continue

            val ids = mutableListOf<String>()
            for (r in cleaned) {
                if (r.start <= segStart && r.end >= segEnd) {
                    ids.add(r.id)
                }
            }

            // Merge with previous segment if same thread IDs (reduces span count)
            val prev = segments.lastOrNull()
            if (prev != null && prev.threadIds == ids) {
                segments[segments.lastIndex] = prev.copy(end = segEnd)
            } else {
                segments.add(TextSegment(segStart, segEnd, ids))
            }
        }

        return segments
    }

    /**
     * Given a character offset inside the content, returns the list of thread IDs
     * whose ranges cover that offset.  Used for tap detection.
     */
    fun threadIdsAtOffset(offset: Int, segments: List<TextSegment>): List<String> {
        for (seg in segments) {
            if (offset >= seg.start && offset < seg.end && seg.threadIds.isNotEmpty()) {
                return seg.threadIds
            }
        }
        return emptyList()
    }

    /**
     * Given a character offset, returns the matching segment (for start/end reporting).
     */
    fun segmentAtOffset(offset: Int, segments: List<TextSegment>): TextSegment? {
        for (seg in segments) {
            if (offset >= seg.start && offset < seg.end) return seg
        }
        return null
    }
}

