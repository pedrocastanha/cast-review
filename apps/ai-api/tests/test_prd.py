import pytest

from app.graph.agents.prd import generate_prd
from tests.llm_fakes import llm

@pytest.mark.asyncio
async def test_prd_normalizes_fields_and_builds_markdown(monkeypatch):
    async def fake_complete_json(*, system: str, user: str, model: str, api_key: str, **_kwargs):
        assert "Product Requirements" in system or "PRD" in system
        assert "DIFF:" in user
        return llm(
            {
                "title": "Exporta x",
                "problem": "callers não tinham x",
                "whatChanged": "adiciona o export de x",
                "goals": ["expor x"],
                "nonGoals": ["não muda a API HTTP"],
                "userImpact": "importar x deixa de falhar",
                "constraints": ["sem breaking change"],
            }
        )

    monkeypatch.setattr(
        "app.graph.agents.prd.agent.complete_json",
        fake_complete_json,
    )

    prd = await generate_prd(
        diff="+export const x = 1",
        changed_files=[{"path": "src/a.ts", "diff": "+export const x = 1", "fullContent": "export const x = 1"}],
        change_analysis={"hasTests": False},
        model="gpt-4o",
        api_key="sk-test",
    )

    assert prd["title"] == "Exporta x"
    assert prd["goals"] == ["expor x"]
    assert prd["nonGoals"] == ["não muda a API HTTP"]
    assert "# Exporta x" in prd["markdown"]
    assert "adiciona o export de x" in prd["markdown"]
    assert prd["usage"]["step"] == "prd"
    assert prd["usage"]["skipped"] is False

@pytest.mark.asyncio
async def test_prd_fills_empty_lists_when_model_omits_them(monkeypatch):
    async def fake_complete_json(**kwargs):
        return llm({"title": "ok", "problem": "p", "whatChanged": "w"})

    monkeypatch.setattr(
        "app.graph.agents.prd.agent.complete_json",
        fake_complete_json,
    )

    prd = await generate_prd(
        diff="d",
        changed_files=[],
        change_analysis={},
        model="gpt-4o",
        api_key="sk-test",
    )

    assert prd["goals"] == []
    assert prd["nonGoals"] == []
    assert prd["constraints"] == []
    assert prd["markdown"].startswith("# ok")

@pytest.mark.asyncio
async def test_prd_builds_revision_prompt_with_prior_content_and_notes(monkeypatch):
    captured = {}

    async def fake_complete_json(*, system: str, user: str, model: str, api_key: str, **_kwargs):
        captured["user"] = user
        return llm(
            {
                "title": "Exporta x (revisado)",
                "problem": "callers não tinham x",
                "whatChanged": "adiciona o export de x, agora com validação",
                "goals": ["expor x"],
                "nonGoals": ["não muda a API HTTP"],
                "userImpact": "importar x deixa de falhar",
                "constraints": ["sem breaking change"],
            }
        )

    monkeypatch.setattr(
        "app.graph.agents.prd.agent.complete_json",
        fake_complete_json,
    )

    prd = await generate_prd(
        diff="+export const x = 1",
        changed_files=[{"path": "src/a.ts", "diff": "+export const x = 1", "fullContent": "export const x = 1"}],
        change_analysis={"hasTests": False},
        model="gpt-4o",
        api_key="sk-test",
        prior_prd={"markdown": "# Exporta x\n\n## Problema\ncallers não tinham x\n"},
        revision_notes=[
            {"excerpt": "callers não tinham x", "note": "detalhar quais callers"},
            {"excerpt": "adiciona o export de x", "note": "mencionar validação adicionada"},
        ],
    )

    assert prd["title"] == "Exporta x (revisado)"
    user = captured["user"]
    assert "# Exporta x" in user
    assert "callers não tinham x" in user
    assert "detalhar quais callers" in user
    assert "adiciona o export de x" in user
    assert "mencionar validação adicionada" in user
    assert "DIFF:" in user
