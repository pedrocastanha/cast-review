import pytest
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command

from app.graph.nodes.human_approval import make_approval_node
from app.graph.state import GraphState

def _build_single_node_graph(stage: str):
    graph = StateGraph(GraphState)
    graph.add_node("approval", make_approval_node(stage))
    graph.add_edge(START, "approval")
    graph.add_edge("approval", END)
    return graph.compile(checkpointer=InMemorySaver())

@pytest.mark.asyncio
async def test_auto_policy_approves_without_calling_interrupt(monkeypatch):
    def _boom(_value):
        raise AssertionError("interrupt() must not be called on the auto policy path")

    monkeypatch.setattr("app.graph.nodes.human_approval.interrupt", _boom)

    node = make_approval_node("prd")
    config = {"configurable": {"policies": {"prd": "auto"}}}

    result = await node({}, config)

    assert result == {"revision_notes": None, "_prd_decision": "approve"}

@pytest.mark.asyncio
async def test_manual_policy_calls_interrupt_with_stage_and_iteration():
    compiled = _build_single_node_graph("prd")
    config = {"configurable": {"thread_id": "t-manual", "policies": {"prd": "manual"}}}

    result = await compiled.ainvoke({"prd_iteration": 3}, config)

    assert "__interrupt__" in result
    (interrupt_,) = result["__interrupt__"]
    assert interrupt_.value == {"stage": "prd", "iteration": 3}

@pytest.mark.asyncio
async def test_manual_policy_reject_sets_revision_notes():
    compiled = _build_single_node_graph("prd")
    config = {"configurable": {"thread_id": "t-reject", "policies": {"prd": "manual"}}}
    await compiled.ainvoke({}, config)

    annotations = [{"excerpt": "some text", "note": "please fix"}]
    result = await compiled.ainvoke(
        Command(resume={"action": "reject", "annotations": annotations}), config
    )

    assert result["revision_notes"] == annotations
    assert result["_prd_decision"] == "reject"

@pytest.mark.asyncio
async def test_manual_policy_approve_clears_revision_notes():
    compiled = _build_single_node_graph("spec")
    config = {"configurable": {"thread_id": "t-approve", "policies": {"spec": "manual"}}}
    await compiled.ainvoke({}, config)

    result = await compiled.ainvoke(Command(resume={"action": "approve"}), config)

    assert result["revision_notes"] is None
    assert result["_spec_decision"] == "approve"
