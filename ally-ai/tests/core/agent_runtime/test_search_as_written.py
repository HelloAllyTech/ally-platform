"""Q4 C14: the English query and the message as written, searched together."""

from app.core.agent_runtime.tools.search_knowledge import as_written, merge_hits


def hit(chunk, sim):
    return {"chunk_id": chunk, "similarity": sim}


def test_each_chunk_once_at_its_best_score_best_first():
    merged = merge_hits(
        [[hit("a", 0.6), hit("b", 0.5)], [hit("b", 0.7), hit("c", 0.4)]], top_k=None
    )
    assert [(h["chunk_id"], h["similarity"]) for h in merged] == [
        ("b", 0.7),
        ("a", 0.6),
        ("c", 0.4),
    ]
    assert len(merge_hits([[hit("a", 0.6), hit("b", 0.5), hit("c", 0.1)]], 2)) == 2


def test_the_message_is_searched_as_written_only_when_it_differs():
    assert as_written("डिलीवरी में कितने दिन लगते हैं?", "How long does delivery take?")
    assert as_written(
        "Delivery mein kitne din lagte hain?", "Delivery time?", "hi-latn"
    )
    assert as_written("Quel est le prix ?", "What is the price?", "fr")
    # English is searched once: the query already is the message's meaning.
    assert as_written("and after that, how do I sign in?", "How do I sign in?") == ""
    assert as_written("Delivery kab hogi?", "delivery kab hogi?", "hi-latn") == ""
    assert as_written("yes", "book the slot") == ""
    assert as_written("", "q") == ""
