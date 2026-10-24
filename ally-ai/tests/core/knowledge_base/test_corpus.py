"""Corpus → collection resolution.

The invariant worth asserting is completeness: every corpus must resolve to a distinct
collection that a migration actually creates. A member added without one would not fail
at import — it would fail at the first write, against a collection Weaviate does not
have, for a corpus an admin had already been offered in the UI.
"""

import importlib.util
import re
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core.knowledge_base.corpus import (
    CORPUS_COLLECTIONS,
    KbCorpus,
    collection_for,
)
from app.core.vector_db.constants import VectorDBCollectionNames


def test_every_corpus_resolves_to_a_collection():
    for corpus in KbCorpus:
        assert collection_for(corpus)


def test_corpora_never_share_a_collection():
    """The separation itself. Two corpora in one collection is the design this
    replaced: one similarity threshold straddling two chunk-size distributions, a
    filtered ANN traversal over both, and a scope that can be forgotten."""
    collections = list(CORPUS_COLLECTIONS.values())
    assert len(set(collections)) == len(collections)


def test_the_whatsapp_corpus_keeps_the_collection_its_vectors_are_already_in():
    # Re-pointing it would strand every indexed chunk the live bot answers from.
    assert (
        collection_for(KbCorpus.WHATSAPP_QA) == VectorDBCollectionNames.KNOWLEDGE_CHUNKS
    )


def test_wire_values_match_ally_be():
    # These are the strings stored in ally-be's kb_documents.corpus. A drift here means
    # ally-be asks for a corpus this service does not recognise.
    assert {c.value for c in KbCorpus} == {
        "whatsapp_qa",
        "character_library",
        "ally_guide_library",
    }


def test_every_collection_has_a_migration_that_creates_it():
    migrations = Path(__file__).parents[3] / "app" / "migrations"
    created = set()
    for path in migrations.glob("*.py"):
        body = path.read_text()
        for match in re.finditer(r"VectorDBCollectionNames\.([A-Z_]+)", body):
            created.add(match.group(1))

    for corpus, collection in CORPUS_COLLECTIONS.items():
        attribute = next(
            name
            for name, value in vars(VectorDBCollectionNames).items()
            if value == collection and not name.startswith("_")
        )
        assert (
            attribute in created
        ), f"{corpus.value} resolves to {collection}, which no migration creates"


def test_unknown_corpus_is_a_programming_error_not_a_silent_default():
    """Returning a default collection for an unknown corpus would read the wrong
    corpus and look like a working query."""
    with pytest.raises(KeyError):
        collection_for("not_a_corpus")  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_the_guide_library_collection_carries_the_audience_properties():
    """The guide library holds organisations' own documents beside global ones, so
    the audience pair is what keeps one organisation's protocols away from another's
    learners. A collection created without it would fail every audience-filtered
    search — and the fix that tempts, searching unrestricted, is the leak."""
    path = (
        Path(__file__).parents[3]
        / "app"
        / "migrations"
        / "008-create-guide-library-chunk-collection.py"
    )
    spec = importlib.util.spec_from_file_location("migration_008", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    client = MagicMock()
    client.collections.list_all = AsyncMock(return_value=[])
    client.collections.create = AsyncMock()

    await migration.up(client)

    kwargs = client.collections.create.call_args.kwargs
    assert kwargs["name"] == collection_for(KbCorpus.ALLY_GUIDE_LIBRARY)
    names = {prop.name for prop in kwargs["properties"]}
    assert {"is_global", "tenant_ids", "document_id"} <= names
