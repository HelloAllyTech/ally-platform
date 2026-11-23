"""`case_memory`: the Case recipe's part as a data agent. The case's memory so
far goes to the Analyst (who writes the memory's update) and the Writer (who
must not contradict it), as the Case recipe did. In the floor with the
Analyst: the Analyst runs before the planner, so its input cannot wait for
the planner's choice; applied in code for every Case session with memory."""

from app.core.debrief_graph.registry.manifest import AgentManifest, register


def apply(state, ctx):
    return {
        "data_agents": ["case_memory"],
        "workspace": {"caseMemory": ctx.inputs.get("case_memory")},
    }


MANIFEST = register(
    AgentManifest(
        id="case_memory",
        version=1,
        kind="data",
        description=(
            "Gives the Analyst and the Writer what the client carries from the "
            "learner's earlier sessions in the same case, so the debrief agrees "
            "with it and the case memory is updated."
        ),
        use_when="Always for a case session with case memory (in the floor).",
        skip_when="Never for a case session that has memory.",
        progress_label="Reading your session…",
        progress_label_key="debrief.progress.case_memory",
        available=lambda p: p["case_memory"],
        reads=("learner_history",),
        privacy_class="learner",
        writer_has_own_block=True,
        floor=True,
        apply=apply,
    )
)
