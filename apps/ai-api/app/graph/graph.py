from langgraph.graph import END, START, StateGraph

from app.graph.agents.architecture_reviewer import node as architecture_reviewer_node
from app.graph.agents.implementation_spec import node as implementation_spec_node
from app.graph.agents.prd import node as prd_node
from app.graph.agents.test_reviewer import node as test_reviewer_node
from app.graph.nodes.change_analyzer import node as change_analyzer_node
from app.graph.nodes.report_builder import node as report_builder_node
from app.graph.state import GraphState

def build_graph():
    graph = StateGraph(GraphState)
    graph.add_node("change_analyzer", change_analyzer_node)
    graph.add_node("prd", prd_node)
    graph.add_node("implementation_spec", implementation_spec_node)
    graph.add_node("test_reviewer", test_reviewer_node)
    graph.add_node("architecture_reviewer", architecture_reviewer_node)
    graph.add_node("report_builder", report_builder_node)

    graph.add_edge(START, "change_analyzer")
    graph.add_edge("change_analyzer", "prd")
    graph.add_edge("prd", "implementation_spec")
    graph.add_edge("implementation_spec", "test_reviewer")
    graph.add_edge("implementation_spec", "architecture_reviewer")
    graph.add_edge("test_reviewer", "report_builder")
    graph.add_edge("architecture_reviewer", "report_builder")
    graph.add_edge("report_builder", END)
    return graph.compile()
