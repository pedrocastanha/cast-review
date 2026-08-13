import pytest

from app.graph.utils.loader import build_system_prompt, list_skills, load_prompt, summon

def test_load_prompt_reads_agent_markdown():
    prompt = load_prompt("implementation_spec")
    assert "Implementation Spec" in prompt
    assert "JSON" in prompt

def test_list_skills_reads_skills_folder_with_types():
    skills = {skill.id: skill for skill in list_skills("test_reviewer")}
    assert "map-rule-to-test" in skills
    assert skills["map-rule-to-test"].how == "prompt"
    assert skills["map-rule-to-test"].type == "coverage"
    assert skills["fail-uncovered-rules"].how == "code"
    assert skills["fail-uncovered-rules"].type == "coverage"

def test_prd_skills_are_typed_product_and_format():
    types = {skill.id: skill.type for skill in list_skills("prd")}
    assert types["describe-shipped-change"] == "product"
    assert types["format-prd-markdown"] == "format"

def test_summon_appends_only_prompt_skills():
    text = summon("test_reviewer", ["map-rule-to-test", "fail-uncovered-rules"])
    assert "map-rule-to-test" in text
    assert "One finding per businessRule" in text or "businessRule" in text

    assert "fail-uncovered-rules" not in text

def test_build_system_prompt_keeps_base_and_summoned():
    system = build_system_prompt("architecture_reviewer", ["cite-convention"])
    assert load_prompt("architecture_reviewer") in system
    assert "Summoned skills" in system
    assert "conventionRef" in system

def test_unknown_skill_is_ignored():
    assert summon("test_reviewer", ["does-not-exist"]) == ""

@pytest.mark.asyncio
async def test_implementation_spec_sends_prompt_and_summoned_skill(monkeypatch):
    captured: dict = {}

    async def fake_complete_json(*, system: str, user: str, model: str, api_key: str, **_kwargs):
        captured["system"] = system
        captured["user"] = user
        return {"summary": "x", "newContracts": [], "businessRules": []}

    monkeypatch.setattr(
        "app.graph.agents.implementation_spec.agent.complete_json",
        fake_complete_json,
    )

    from app.graph.agents.implementation_spec import generate_implementation_spec

    await generate_implementation_spec(
        diff="diff",
        changed_files=[],
        model="gpt-4o",
        api_key="sk-test",
        prd={"markdown": "# PRD de teste\n"},
    )

    assert "PRD de teste" in captured["user"]

    assert "Implementation Spec" in captured["system"]
    assert "Summoned skills" in captured["system"]
    assert "extract-observable-rules" in captured["system"]
