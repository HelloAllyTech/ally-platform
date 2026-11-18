"""The Debrief family's PM agent: one Deep Agent, enforced by ally-be (spec Part C).

ally-be packs the run's inputs and signs an agent token listing the tools it may
call; every tool goes back through ally-be's gateway, which refuses anything on the
never-list, over the learning budget or outside the autonomy mode. ally-ai never
writes ally-be's database. Contract: docs/debrief-harness/CONTRACT.md §2a and §7.
"""
