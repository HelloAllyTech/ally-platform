"""Q3-fast Part 2: for each answers case, where its fact is in the index, and where it
ranks for the person's own words (the diagnosis behind `Q3A-DIAGNOSIS.md`).

For every case turn with a `must` pattern (the fact a good answer contains), against
the assistant's own documents:
  1. is the fact in the index at all? (how many chunks contain it)
  2. its vector rank and similarity for the question as asked (top 20), against the
     agent's limits: top_k 8, the decline gate (DECLINE_SIMILARITY), the passages it
     keeps (MAX_PASSAGES);
  3. its keyword (BM25) rank for the same words, to see what hybrid search would add.
Nothing is written. Runs inside the ally-ai container (it needs Weaviate and the
embedding key):

    docker cp scripts/answers_diagnosis.py ally-ai-app-1:/tmp/diag.py
    docker cp <cases.json> ally-ai-app-1:/tmp/cases.json
    docker exec -w /app ally-ai-app-1 python /tmp/diag.py --cases /tmp/cases.json \\
        --prefix tss- --doc-ids <comma-separated document ids> [--out /tmp/diag.json]
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
from typing import Any, Dict, List, Optional

sys.path.insert(0, "/app")

from app.core.config import settings  # noqa: E402
from app.core.constants import EmbeddingConstants  # noqa: E402
from app.core.dependencies import (  # noqa: E402
    _get_embedding_service_cached,
    _get_vector_db_cached,
)
from app.core.embeddings.openai_embedding_client import (  # noqa: E402
    OpenAIEmbeddingClient,
)
from app.core.knowledge_base.knowledge_chunk_service import (  # noqa: E402
    ChunkAudience,
    KnowledgeChunkService,
)
from app.core.vector_db.constants import VectorDBCollectionNames  # noqa: E402
from app.core.vector_db.weaviate_client import WeaviateClient  # noqa: E402

LOOK = 20


def first_rank(hits: List[Dict[str, Any]], pattern: re.Pattern) -> Optional[int]:
    for rank, hit in enumerate(hits, 1):
        text = f"{hit.get('section_path') or ''} {hit.get('text') or ''}"
        if pattern.search(text):
            return rank
    return None


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cases", required=True)
    parser.add_argument("--prefix", required=True)
    parser.add_argument("--doc-ids", required=True)
    parser.add_argument("--out")
    args = parser.parse_args()
    doc_ids = [d for d in args.doc_ids.split(",") if d]
    limits = settings.KNOWLEDGE_AGENT
    OpenAIEmbeddingClient.create_client(EmbeddingConstants.MODEL)
    WeaviateClient.create_client()
    await WeaviateClient.connect(WeaviateClient.get_client())
    chunks = KnowledgeChunkService(
        _get_vector_db_cached(),
        _get_embedding_service_cached(),
        VectorDBCollectionNames.KNOWLEDGE_CHUNKS,
    )
    db = _get_vector_db_cached()
    rows: List[Dict[str, Any]] = []
    for case in json.load(open(args.cases)):
        if not case["id"].startswith(args.prefix):
            continue
        for turn in case["turns"]:
            must = (turn.get("expect") or {}).get("must") or []
            if not must:
                continue
            pattern = re.compile(must[0], re.IGNORECASE)
            query = turn["user"]
            vector = await chunks.search(
                query,
                ChunkAudience.unrestricted(),
                limit=LOOK,
                min_similarity=0.0,
                document_ids=doc_ids,
            )
            keyword = await db.bm25_search(
                VectorDBCollectionNames.KNOWLEDGE_CHUNKS,
                query,
                limit=LOOK,
                filters={"document_id": doc_ids},
                return_properties=["text", "section_path", "document_id"],
            )
            # How many chunks hold the fact at all (a wide keyword net on the fact).
            holding = await db.bm25_search(
                VectorDBCollectionNames.KNOWLEDGE_CHUNKS,
                re.sub(r"[^\w ]", " ", must[0]),
                limit=50,
                filters={"document_id": doc_ids},
                return_properties=["text", "section_path"],
            )
            v_rank = first_rank(vector, pattern)
            row = {
                "case": case["id"],
                "query": query,
                "fact": must[0],
                "chunks_with_fact": sum(
                    1
                    for h in holding
                    if pattern.search(f"{h.get('section_path')} {h.get('text')}")
                ),
                "vector_rank": v_rank,
                "vector_similarity": (
                    vector[v_rank - 1]["similarity"] if v_rank else None
                ),
                "top_similarity": vector[0]["similarity"] if vector else None,
                "keyword_rank": first_rank(keyword, pattern),
                "within_top_k": bool(v_rank and v_rank <= limits.TOP_K),
                "within_passages": bool(v_rank and v_rank <= limits.MAX_PASSAGES),
                "clears_decline_gate": bool(
                    vector and vector[0]["similarity"] >= limits.DECLINE_SIMILARITY
                ),
                "top3": [
                    f"{h['similarity']:.2f} {h['section_path'][:60]}"
                    for h in vector[:3]
                ],
            }
            rows.append(row)
            print(
                f"{row['case']:10} in-index {row['chunks_with_fact']:>2}  "
                f"vector {str(row['vector_rank']):>4} "
                f"({row['vector_similarity']})  keyword {str(row['keyword_rank']):>4}  "
                f"top {row['top_similarity']}  | {query[:60]}"
            )
    if args.out:
        json.dump(rows, open(args.out, "w"), indent=2, ensure_ascii=False)
    await WeaviateClient.close(WeaviateClient.get_client())
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
