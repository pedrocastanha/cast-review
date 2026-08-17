from collections.abc import Awaitable, Callable
from typing import Literal

from langchain_core.runnables import RunnableConfig
from langgraph.types import interrupt

from app.graph.state import GraphState

def make_approval_node(
    stage: Literal["prd", "spec"],
) -> Callable[[GraphState, RunnableConfig], Awaitable[dict]]:
    decision_key = f"_{stage}_decision"
    iteration_key = f"{stage}_iteration"

    async def node(state: GraphState, config: RunnableConfig) -> dict:
        policy = config["configurable"]["policies"][stage]
        if policy == "auto":
            return {"revision_notes": None, decision_key: "approve"}

        decision = interrupt({"stage": stage, "iteration": state.get(iteration_key, 1)})

        if decision["action"] == "reject":
            return {"revision_notes": decision["annotations"], decision_key: "reject"}
        return {"revision_notes": None, decision_key: "approve"}

    return node
