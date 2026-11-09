"""/agent/run reports every passage document and the search count (chunk 20a-2),
which the checkup uses to tell a wrong decline from an honest one."""

from app.core.agent_runtime.runner import build_response


def test_passage_documents_cover_every_search_and_searches_are_counted():
    state = {
        "result": {
            "intent": "decline",
            "answer": "",
            "language": "en",
            "citations": [],
            "retrieval": {
                "top_k": 8,
                "min_similarity": 0.35,
                "decline_similarity": 0.42,
                "hit_count": 1,
                "top_similarity": 0.7,
                "passages_used": 1,
            },
        },
        "hits": [{"chunk_id": "c1"}],
        "passages": [
            {"chunk_id": "c1", "document_id": "home"},
            {"chunk_id": "c2", "document_id": "classes"},
            {"chunk_id": "c3", "document_id": "home"},
        ],
        "tool_calls": [
            {"tool": "search_knowledge", "query": "a"},
            {"tool": "search_knowledge", "query": "b"},
        ],
        "trace": [],
    }
    retrieval = build_response(state, "run-1").retrieval
    assert retrieval.passage_document_ids == ["home", "classes"]
    assert retrieval.searches == 2
    assert retrieval.hit_chunk_ids == ["c1"]
