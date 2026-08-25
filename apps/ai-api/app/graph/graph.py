import functools
import time

from langgraph.graph import END, START, StateGraph

from app.graph.agents.architecture_reviewer import node as architecture_reviewer_node
from app.graph.agents.implementation_spec import node as implementation_spec_node
from app.graph.agents.prd import node as prd_node
from app.graph.agents.test_reviewer import node as test_reviewer_node
from app.graph.nodes.change_analyzer import node as change_analyzer_node
from app.graph.nodes.human_approval import make_approval_node
from app.graph.nodes.report_builder import node as report_builder_node
from app.graph.state import GraphState
from app.infrastructure.logging.setup import get_logger

log = get_logger(__name__)


def _with_node_logging(name: str, fn):
    @functools.wraps(fn)
    async def wrapper(state: GraphState, *args, **kwargs):
        bound = log.bind(node=name, run_id=state.get("run_id"))
        bound.info("node.start")
        start = time.monotonic()
        try:
            result = await fn(state, *args, **kwargs)
        except Exception:
            bound.error("node.error", duration_ms=round((time.monotonic() - start) * 1000, 1))
            raise
        bound.info("node.end", duration_ms=round((time.monotonic() - start) * 1000, 1))
        return result

    return wrapper


def _route_spec_approval(state: GraphState) -> str | list[str]:
    if state["_spec_decision"] == "approve":
        return ["test_reviewer", "architecture_reviewer"]
    return "implementation_spec"

def build_graph(checkpointer=None):
    graph = StateGraph(GraphState)
    graph.add_node("change_analyzer", _with_node_logging("change_analyzer", change_analyzer_node))
    graph.add_node("prd", _with_node_logging("prd", prd_node))
    graph.add_node("prd_approval", _with_node_logging("prd_approval", make_approval_node("prd")))
    graph.add_node(
        "implementation_spec",
        _with_node_logging("implementation_spec", implementation_spec_node),
    )
    graph.add_node(
        "spec_approval", _with_node_logging("spec_approval", make_approval_node("spec"))
    )
    graph.add_node("test_reviewer", _with_node_logging("test_reviewer", test_reviewer_node))
    graph.add_node(
        "architecture_reviewer",
        _with_node_logging("architecture_reviewer", architecture_reviewer_node),
    )
    graph.add_node("report_builder", _with_node_logging("report_builder", report_builder_node))

    graph.add_edge(START, "change_analyzer")
    graph.add_edge("change_analyzer", "prd")
    graph.add_edge("prd", "prd_approval")
    graph.add_conditional_edges(
        "prd_approval",
        lambda state: state["_prd_decision"],
        {"approve": "implementation_spec", "reject": "prd"},
    )
    graph.add_edge("implementation_spec", "spec_approval")
    graph.add_conditional_edges("spec_approval", _route_spec_approval)
    graph.add_edge("test_reviewer", "report_builder")
    graph.add_edge("architecture_reviewer", "report_builder")
    graph.add_edge("report_builder", END)
    return graph.compile(checkpointer=checkpointer)
