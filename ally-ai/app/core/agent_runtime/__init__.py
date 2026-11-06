"""Agents v2 runtime: one LangGraph graph for every bot, served at `/agent/run`.

With `features.agent` off the graph runs the same KnowledgeAgentService steps as
`/knowledge-agent/answer`, one node per step (parity mode). With it on, the
conversational agent decides when to search, and its reply is checked before it is
sent. Every run is checkpointed under the conversation id so it can be read back
later ("Why?", approvals).
"""
