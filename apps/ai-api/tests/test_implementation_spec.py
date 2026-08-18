import pytest

from app.graph.agents.implementation_spec import generate_implementation_spec
from tests.llm_fakes import llm

@pytest.mark.asyncio
async def test_implementation_spec_fresh_generation_prompt_unchanged(monkeypatch):
    async def fake_complete_json(*, system: str, user: str, model: str, api_key: str, **_kwargs):
        assert "REVISION REQUEST" not in user
        assert "PREVIOUS SPEC" not in user
        assert user == "DIFF:\n+export const x = 1\n\nFILES:\n"
        return llm(
            {
                "summary": "adds x export",
                "newContracts": ["export const x: number"],
                "businessRules": ["x must be positive"],
            }
        )

    monkeypatch.setattr(
        "app.graph.agents.implementation_spec.agent.complete_json",
        fake_complete_json,
    )

    spec = await generate_implementation_spec(
        diff="+export const x = 1",
        changed_files=[],
        model="gpt-4o",
        api_key="sk-test",
    )

    assert spec["summary"] == "adds x export"
    assert spec["newContracts"] == ["export const x: number"]
    assert spec["businessRules"] == ["x must be positive"]
    assert spec["usage"]["step"] == "implementation_spec"
    assert spec["usage"]["skipped"] is False

@pytest.mark.asyncio
async def test_implementation_spec_revision_includes_previous_spec_and_notes(monkeypatch):
    async def fake_complete_json(*, system: str, user: str, model: str, api_key: str, **_kwargs):
        assert "REVISION REQUEST" in user
        assert "PREVIOUS SPEC:" in user
        assert "Summary: adds x export" in user
        assert "export const x: number" in user
        assert "REVIEWER NOTES:" in user
        assert 'On "export const x: number": missing null-check' in user
        return llm(
            {
                "summary": "adds x export with null-check",
                "newContracts": ["export const x: number | null"],
                "businessRules": ["x must be positive when not null"],
            }
        )

    monkeypatch.setattr(
        "app.graph.agents.implementation_spec.agent.complete_json",
        fake_complete_json,
    )

    spec = await generate_implementation_spec(
        diff="+export const x = 1",
        changed_files=[],
        model="gpt-4o",
        api_key="sk-test",
        revision_notes=[{"excerpt": "export const x: number", "note": "missing null-check"}],
        previous_spec={
            "summary": "adds x export",
            "newContracts": ["export const x: number"],
            "businessRules": ["x must be positive"],
        },
    )

    assert spec["summary"] == "adds x export with null-check"
    assert spec["newContracts"] == ["export const x: number | null"]
