"""Which corpus a knowledge request is about, and which collection holds it.

One pipeline (extract → chunk → index → retrieve → cite), several consumers. The corpus
is the only thing they differ by, so it is the one thing they declare — and it resolves
to a COLLECTION rather than to a filter value.

That resolution is the whole point. A leak BETWEEN corpora would rarely expose anyone's
data; it would do something subtler and harder to notice, which is answer a health
worker's clinical question out of material written for another reader — a learner's
course guide, or (before it was retired) the character interview's corpus. That reads as
good clinical prose. (Leaks WITHIN a corpus are the other boundary: the
Ally guide's library holds organisations' own protocols beside the global material, so
its searches always carry an audience — see `ChunkAudience`.) The
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
    # The Ally guide's library: material on becoming and being a helper, global or
    # one organisation's own. The one corpus here that is NOT Ally-global
    # throughout — see migration 008 for what that changes.
    ALLY_GUIDE_LIBRARY = "ally_guide_library"
    # The Debrief agent's guidance: practice guidelines, the debrief style guide,
    # level guides and organisations' protocols. Platform-wide or targeted at named
    # organisations; clinical passages are served only once signed off (ally-be).
    DEBRIEF_KNOWLEDGE = "debrief_knowledge"


CORPUS_COLLECTIONS: dict[KbCorpus, str] = {
    KbCorpus.WHATSAPP_QA: VectorDBCollectionNames.KNOWLEDGE_CHUNKS,
    KbCorpus.ALLY_GUIDE_LIBRARY: VectorDBCollectionNames.GUIDE_LIBRARY_CHUNKS,
    KbCorpus.DEBRIEF_KNOWLEDGE: VectorDBCollectionNames.DEBRIEF_KNOWLEDGE_CHUNKS,
}


#: Collections of corpora retired into ally-be's Context Library. Nothing reads or
#: writes them. Each is dropped once, by ally-be's confirmed platform-admin retirement
#: (DELETE /knowledge-chunks/retired-collection) after its documents have been distilled
#: — never by a migration, because a migration runs on deploy, before anyone confirmed
#: the import finished. The only names that route accepts.
RETIRED_CORPUS_COLLECTIONS: frozenset[str] = frozenset(
    {VectorDBCollectionNames.CHARACTER_CHUNKS}
)


def collection_for(corpus: KbCorpus) -> str:
    """The collection holding one corpus's chunks.

    A KeyError here is a programming error, not a request error: every KbCorpus member
    must have a collection and a migration creating it.
    """
    return CORPUS_COLLECTIONS[corpus]
