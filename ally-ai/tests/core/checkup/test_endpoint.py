"""POST /checkup/grade reads the cited passages for the judge."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.dependencies import get_knowledge_agent_service
from app.main import app


@pytest.fixture
def client():
    service = MagicMock()
    service.chunk_service.get = AsyncMock(
        side_effect=lambda chunk_id: {
            "chunk_id": chunk_id,
            "document_title": "Fees",
            "text": "First consultation: Rs. 1,800.",
        }
    )
    app.dependency_overrides[get_knowledge_agent_service] = lambda: service
    yield TestClient(app), service
    app.dependency_overrides.pop(get_knowledge_agent_service, None)


def test_grade_reads_each_cited_passage_once(client):
    test_client, service = client
    body = {
        "case": {"id": "B1", "question": "How much?", "expect": "answer"},
        "observed": {
            "reply": "Rs. 1,800.",
            "handled_by": "rag",
            "citations": [
                {"chunk_id": "c1", "document_id": "d1"},
                {"chunk_id": "c1", "document_id": "d1"},
                {"chunk_id": "c2", "document_id": "d1"},
            ],
            "passage_chunk_ids": ["c3", "c2"],
            "decline_text": "Please call +91 20 0000 4400.",
            "about": "You cover services, fees and booking.",
        },
    }
    graded = AsyncMock(
        return_value={
            "verdict": "pass",
            "outcome": "answered",
            "grader_version": "test",
        }
    )
    with patch("app.api.v1.endpoints.checkup.grade_case", graded):
        response = test_client.post(
            "/api/v1/checkup/grade",
            json=body,
            headers={"x-api-key": settings.API.X_API_KEY},
        )
    assert response.status_code == 200, response.text
    assert [c.args[0] for c in service.chunk_service.get.call_args_list] == [
        "c1",
        "c2",
        "c3",
    ]
    assert graded.call_args.kwargs["sources"] == [
        *["[Fees] First consultation: Rs. 1,800."] * 3,
        "[When it doesn't know] Please call +91 20 0000 4400.",
        "[The assistant's own setup] You cover services, fees and booking.",
    ]
