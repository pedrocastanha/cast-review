from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

AGENTS_DIR = Path(__file__).resolve().parent.parent / "agents"
FRONTMATTER = re.compile(r"^---\s*\n(.*?)\n---\s*\n(.*)$", re.DOTALL)

SkillType = Literal["path", "product", "contract", "coverage", "convention", "format"]
How = Literal["prompt", "code"]

@dataclass(frozen=True)
class Skill:
    id: str
    type: SkillType
    when: str
    how: How
    body: str
    path: str

def agent_dir(name: str) -> Path:
    return AGENTS_DIR / name

def load_prompt(name: str) -> str:
    return (agent_dir(name) / "prompt.md").read_text(encoding="utf-8").strip()

def list_skills(name: str) -> list[Skill]:
    folder = agent_dir(name) / "skills"
    if not folder.is_dir():
        return []
    skills = [_parse_skill_file(path) for path in sorted(folder.glob("*.md"))]
    return [skill for skill in skills if skill is not None]

def summon(name: str, skill_ids: list[str]) -> str:
    catalog = {skill.id: skill for skill in list_skills(name)}
    chunks: list[str] = []
    for skill_id in skill_ids:
        skill = catalog.get(skill_id)
        if skill is None or skill.how != "prompt":
            continue
        chunks.append(
            f"## Skill: {skill.id} (type: {skill.type})\n\n{skill.body}".strip()
        )
    return "\n\n".join(chunks)

def build_system_prompt(name: str, skill_ids: list[str]) -> str:
    base = load_prompt(name)
    extra = summon(name, skill_ids)
    if not extra:
        return base
    return f"{base}\n\n# Summoned skills\n\n{extra}"

def _parse_skill_file(path: Path) -> Skill | None:
    text = path.read_text(encoding="utf-8").strip()
    match = FRONTMATTER.match(text)
    if match:
        raw_meta, body = match.group(1), match.group(2).strip()
    else:
        raw_meta, body = "", text

    fields: dict[str, str] = {}
    for line in raw_meta.splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        fields[key.strip().lower()] = value.strip().strip('"').strip("'")

    how = fields.get("how", "prompt")
    if how not in {"prompt", "code"}:
        how = "prompt"

    skill_type = fields.get("type", "contract")
    allowed: set[str] = {"path", "product", "contract", "coverage", "convention", "format"}
    if skill_type not in allowed:
        skill_type = "contract"

    return Skill(
        id=fields.get("id") or path.stem,
        type=skill_type,
        when=fields.get("when", ""),
        how=how,
        body=body,
        path=str(path),
    )
