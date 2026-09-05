import pytest
from pydantic import ValidationError

from app.chat.requirements import FeatureProposal, ground_proposal
from app.chat.models import Citation


def proposal(**changes):
    return {
        "title": "Notificações", "problem": "Usuário perde conclusões",
        "objective": "Consultar conclusões", "scope": ["Inbox"],
        "outOfScope": ["Email"], "businessRules": ["Só o dono pode ler"],
        "acceptanceCriteria": ["Ao concluir, aparece na inbox"],
        "edgeCases": ["Reexecução"], "openQuestions": [],
        "tasks": [{"key": "api", "title": "Persistir notificações", "area": "Backend",
                   "description": "Salvar ao concluir", "rationale": "Preservar histórico",
                   "acceptanceCriteria": ["Evento duplicado não duplica registro"],
                   "dependsOn": [], "evidenceIndices": [0, 5]}],
        **changes,
    }


def test_proposal_only_uses_retrieved_evidence():
    evidence = Citation(repoId="acme/api", sha="abc", path="src/a.ts", line=4)
    result = ground_proposal(FeatureProposal.model_validate(proposal()), [evidence])
    assert result["tasks"][0]["evidence"] == [evidence.model_dump()]
    assert result["tasks"][0]["confidence"] == "grounded"


def test_no_evidence_means_hypothesis():
    result = ground_proposal(FeatureProposal.model_validate(proposal()), [])
    assert result["tasks"][0]["confidence"] == "hypothesis"


@pytest.mark.parametrize("dependency", ["unknown", "api"])
def test_invalid_dependency_rejected(dependency):
    data = proposal()
    data["tasks"][0]["dependsOn"] = [dependency]
    with pytest.raises(ValidationError):
        FeatureProposal.model_validate(data)


def test_cycles_and_duplicate_keys_rejected():
    data = proposal()
    data["tasks"].append({**data["tasks"][0], "key": "ui", "dependsOn": ["api"]})
    data["tasks"][0]["dependsOn"] = ["ui"]
    with pytest.raises(ValidationError):
        FeatureProposal.model_validate(data)
    data["tasks"][0]["dependsOn"] = []
    data["tasks"][1]["key"] = "api"
    with pytest.raises(ValidationError):
        FeatureProposal.model_validate(data)


def test_unbounded_or_empty_proposals_rejected():
    for changes in ({"title": ""}, {"tasks": []}, {"tasks": proposal()["tasks"] * 13}):
        with pytest.raises(ValidationError):
            FeatureProposal.model_validate(proposal(**changes))


@pytest.mark.asyncio
async def test_requirements_agent_emits_proposal_with_cost_and_project_tools(monkeypatch):
    from app.chat.agent import run_chat
    from app.chat.models import ChatRunRequest
    from app.code_graph.models import Graph
    from app.infrastructure.llm.client import LlmResult, LlmToolResult
    from app.infrastructure.llm.tokens import TokenUsage

    usage = TokenUsage(prompt_tokens=10, completion_tokens=5, cached_tokens=0, total_tokens=15, source="openai")
    calls = []

    async def answer(**kwargs):
        calls.append(kwargs)
        return LlmToolResult(content="Planejar notificações. Qual canal?", tool_calls=[], usage=usage)

    async def structure(**kwargs):
        return LlmResult(data=proposal(openQuestions=["Qual canal?"]), usage=usage)

    class Cache:
        async def lookup(self, repo_id, sha):
            return Graph()

    monkeypatch.setattr("app.chat.agent.complete_with_tools", answer)
    monkeypatch.setattr("app.chat.requirements.complete_json", structure)
    request = ChatRunRequest(threadId="t", mode="project", assistanceMode="requirements", repositories=[{"repoId": "acme/api", "sha": "abc"}], question="Quero notificações", model="gpt-4o", apiKeys={"openai": "test"})
    events = [event async for event in run_chat(Cache(), request)]
    done = events[-1].payload
    assert done["proposal"]["openQuestions"] == ["Qual canal?"]
    assert done["proposal"]["tasks"][0]["confidence"] == "hypothesis"
    assert done["usage"]["promptTokens"] == 20
    assert "cross_repo_links" in [tool["function"]["name"] for tool in calls[0]["tools"]]
    assert "perfil Requisitos" in calls[0]["system"]


@pytest.mark.asyncio
async def test_invalid_structure_preserves_generation_usage(monkeypatch):
    from app.chat.models import ChatRunRequest
    from app.chat.requirements import generate_proposal
    from app.infrastructure.llm.client import LlmResult
    from app.infrastructure.llm.tokens import TokenUsage

    usage = TokenUsage(prompt_tokens=10, completion_tokens=5, cached_tokens=0, total_tokens=15, source="openai")

    async def invalid(**kwargs):
        return LlmResult(data={"title": "incomplete"}, usage=usage)

    monkeypatch.setattr("app.chat.requirements.complete_json", invalid)
    request = ChatRunRequest(threadId="t", mode="project", repositories=[], question="Feature", model="gpt-4o", apiKeys={"openai": "test"})
    data, measured = await generate_proposal(request, "Investigação", [])
    assert data is None
    assert measured == usage
