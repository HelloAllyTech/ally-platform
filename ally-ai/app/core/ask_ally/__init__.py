"""Ask Ally: the Debrief agent answering a learner's reply (v9 FR-43, spec §A10).

A LangChain `create_agent` loop on the LangGraph runtime, with three tools
called through ally-be's Debrief gateway. ally-be keeps the learner endpoint,
the crisis and distress screens, the reply checks, persistence and the SSE
relay (docs/debrief-harness/CONTRACT.md §5).
"""
