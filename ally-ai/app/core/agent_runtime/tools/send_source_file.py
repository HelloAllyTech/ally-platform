"""`send_source_file` (chunk WA-A §2): send one of the assistant's own documents.

When someone asks for a document the organisation uploaded ("send me the form"),
the agent names it by its title; ally-be checks it is one of this assistant's
own uploaded sources and sends the file on WhatsApp after the reply. An
assistant opts in (`abilities.send_source_file = do_it`), so the tool is only
offered when ally-be's request names it.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.core.agent_runtime.tools.gateway import gateway_tool

#: Model-facing (listed for approval in docs/agents-v2/TEXTS-WA-A.md).
TITLE_DESCRIPTION = (
    "The title of the document to send, exactly as it appears in your sources."
)


class SendSourceFileInput(BaseModel):
    # A default: step schemas build each tool's input empty. ally-be refuses "".
    title: str = Field("", description=TITLE_DESCRIPTION, max_length=300)


#: Model-facing (listed for approval in docs/agents-v2/TEXTS-WA-A.md).
DESCRIPTION = (
    "Send the person one of the organisation's own documents from your sources, "
    "as a file, when they ask for it (a form, a brochure, a price list). Only a "
    "document in your sources, never anything else. In your reply, say in one "
    "short line that the file is on its way; it is sent just after your reply. If "
    "it says there is no such file, tell them which documents you can send."
)

TOOL = gateway_tool(
    "send_source_file",
    DESCRIPTION,
    SendSourceFileInput,
    risk="low",
)
