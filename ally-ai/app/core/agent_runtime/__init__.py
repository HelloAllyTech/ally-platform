"""Agents v2 runtime: the knowledge pipeline as a LangGraph graph.

Chunk 1 is parity only. The graph runs the same KnowledgeAgentService steps as
`/knowledge-agent/answer`, one node per step, and checkpoints every run under the
conversation id so the run can be read back later ("Why?", approvals). Nothing new
is decided here yet; flags switch new nodes on in later chunks.
"""
