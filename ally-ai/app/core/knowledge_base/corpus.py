"""Which corpus a knowledge request is about, and which collection holds it.

One pipeline (extract → chunk → index → retrieve → cite), several consumers. The corpus
is the only thing they differ by, so it is the one thing they declare — and it resolves
to a COLLECTION rather than to a filter value.

That resolution is the whole point. A leak BETWEEN corpora would rarely expose anyone's
data; it would do something subtler and harder to notice, which is answer a health
worker's clinical question out of material written for another reader — a learner's
course guide, or (before it was retired) the character interview's corpus. That reads as
good clinical prose. (Leaks WITHIN a corpus are the other boundary: a document may be
targeted at some organisations only, so every search carries an audience — see
`ChunkAudience`.) The
reasons for a collection per corpus rather than one collection plus a scope
argument are recorded in
migration 005 and in KnowledgeChunkProperties: a similarity threshold only means
something against one distribution and chunk size is per corpus; filtered ANN search is
weaker than unfiltered; and re-chunking one corpus must not touch the index another is
being served from.
"""

from enum import Enum

from app.core.vector_db.constants import VectorDBCollectionNames


class KbCorpus(str, Enum):
    """Mirrors ally-be's KbCorpus. The wire values are the ones stored in
    kb_documents.corpus, so the two must not drift."""

    WHATSAPP_QA = "whatsapp_qa"
    # The character corpus, the Ally guide's library ("ally_guide_library") and
    # Debrief's guidance ("debrief_knowledge") moved to ally-be's Context Library,
    # which retrieves through its own Ctx<Collection>_v{N} indexes.


CORPUS_COLLECTIONS: dict[KbCorpus, str] = {
    KbCorpus.WHATSAPP_QA: VectorDBCollectionNames.KNOWLEDGE_CHUNKS,
}


#: Collections of corpora retired into ally-be's Context Library. Nothing reads or
#: writes them. Each is dropped once, by ally-be's confirmed platform-admin retirement
#: (DELETE /knowledge-chunks/retired-collection) after its documents have been distilled
#: — never by a migration, because a migration runs on deploy, before anyone confirmed
#: the import finished. The only names that route accepts.
RETIRED_CORPUS_COLLECTIONS: frozenset[str] = frozenset(
    {
        VectorDBCollectionNames.CHARACTER_CHUNKS,
        VectorDBCollectionNames.GUIDE_LIBRARY_CHUNKS,
        VectorDBCollectionNames.DEBRIEF_KNOWLEDGE_CHUNKS,
    }
)


def collection_for(corpus: KbCorpus) -> str:
    """The collection holding one corpus's chunks.

    A KeyError here is a programming error, not a request error: every KbCorpus member
    must have a collection and a migration creating it.
    """
    return CORPUS_COLLECTIONS[corpus]
