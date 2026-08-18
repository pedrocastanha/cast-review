from langgraph.checkpoint.memory import InMemorySaver

from app.graph.state import GraphState
from app.graph.utils.usage import skipped_step

def _payload_state():
    return {
        "run_id": "test-run",
        "diff": "diff --git a/src/a.ts b/src/a.ts",
        "changed_files": [
            {
                "path": "src/a.ts",
                "diff": "+export const x = 1",
                "fullContent": "export const x = 1",
                "relatedFiles": [],
            }
        ],
        "conventions": "",
        "models": {"testReviewer": "gpt-4o", "architectureReviewer": "gpt-4o"},
    }

async def _fake_prd_node(state: GraphState) -> dict:
    return {"prd": {"title": "Exporta x", "markdown": "# Exporta x", "usage": skipped_step("prd")}}

async def _fake_spec_node(state: GraphState) -> dict:
    return {
        "spec": {
            "summary": "adiciona x",
            "newContracts": ["x"],
            "businessRules": ["exporta x"],
            "usage": skipped_step("implementation_spec"),
        }
    }

async def _fake_test_reviewer_node(state: GraphState) -> dict:
    return {
        "test_review": {
            "score": 100,
            "findings": [],
            "usage": skipped_step("test_reviewer"),
        }
    }

async def _fake_architecture_reviewer_node(state: GraphState) -> dict:
    return {
        "architecture_review": {
            "score": 100,
            "findings": [],
            "conventionsSource": "default",
            "usage": skipped_step("architecture_reviewer"),
        }
    }

def _build_graph_with_fake_agents(monkeypatch, checkpointer):
    """Builds the real graph.py wiring but with LLM-backed agent nodes swapped
    for deterministic fakes, so the test exercises graph *routing* (T11) without
    depending on the unrelated pre-existing `api_keys` schema bug tracked under T12.
    """
    monkeypatch.setattr("app.graph.graph.prd_node", _fake_prd_node)
    monkeypatch.setattr("app.graph.graph.implementation_spec_node", _fake_spec_node)
    monkeypatch.setattr("app.graph.graph.test_reviewer_node", _fake_test_reviewer_node)
    monkeypatch.setattr(
        "app.graph.graph.architecture_reviewer_node", _fake_architecture_reviewer_node
    )

    from app.graph.graph import build_graph

    return build_graph(checkpointer)

def test_graph_compiles_with_in_memory_saver():
    from app.graph.graph import build_graph

    compiled = build_graph(InMemorySaver())
    assert compiled is not None

def test_prd_and_spec_approval_nodes_are_registered():
    from app.graph.graph import build_graph

    compiled = build_graph(InMemorySaver())
    node_names = set(compiled.get_graph().nodes.keys())
    assert "prd_approval" in node_names
    assert "spec_approval" in node_names

async def test_auto_policies_reach_report_without_interrupt(monkeypatch):
    def _boom(_value):
        raise AssertionError("interrupt() must not be called when both policies are 'auto'")

    monkeypatch.setattr("app.graph.nodes.human_approval.interrupt", _boom)

    compiled = _build_graph_with_fake_agents(monkeypatch, InMemorySaver())
    config = {
        "configurable": {
            "thread_id": "t-auto-smoke",
            "policies": {"prd": "auto", "spec": "auto"},
        }
    }

    result = await compiled.ainvoke(_payload_state(), config)

    assert "__interrupt__" not in result
    assert result["_prd_decision"] == "approve"
    assert result["_spec_decision"] == "approve"
    assert result["report"]["verdict"] in {"approve", "comment", "request_changes"}
    assert "Relatório Cast Review" in result["report"]["markdown"]
