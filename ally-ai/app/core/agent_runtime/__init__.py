"""Agents v2 runtime: one LangGraph agent loop for every bot, served at `/agent/run`.

The conversational agent decides when to search, and its reply is checked before it
is sent. Every run is checkpointed under the conversation id so it can be read back
later ("Why?", approvals).
"""
