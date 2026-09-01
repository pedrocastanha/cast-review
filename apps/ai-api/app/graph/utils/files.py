from app.config.settings import MAX_DIFF_CHARS, MAX_PROMPT_FILE_CHARS, MAX_PROMPT_TOTAL_CHARS

SKIP_DIR = ("node_modules/", "dist/", ".venv/", "__pycache__/", "coverage/", ".git/")
SKIP_NAME = (
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    ".pyc",
    ".map",
    ".min.js",
    ".min.css",
)

def files_block(files: list[dict], related_context: dict | None = None) -> str:
    budget = MAX_PROMPT_TOTAL_CHARS
    chunks: list[str] = []

    for file in _prefer_source_files(files):
        if budget <= 0:
            chunks.append("… (demais arquivos omitidos para caber no contexto)")
            break
        if _should_skip(str(file.get("path") or "")):
            continue

        piece = _one_file(file, min(MAX_PROMPT_FILE_CHARS, budget))
        chunks.append(piece)
        budget -= len(piece)

    related_piece = _related_context_block(related_context, budget)
    if related_piece:
        chunks.append(related_piece)

    return "\n\n".join(chunks)


def _related_context_block(related_context: dict | None, budget: int) -> str:
    """`MAX_PROMPT_TOTAL_CHARS` is the managed budget end to end — this block competes
    for the same char budget as file content, it isn't extra on top (CGC-11: "orçamento
    gerenciado", not "corte cego" — the actual token-level budgeting already happened
    in `budget.py`/`context.py`; this just renders what survived that selection,
    respecting whatever char budget is left after the changed-file blocks)."""
    if not related_context or budget <= 0:
        return ""

    sections: list[str] = []

    callers = related_context.get("callers") or []
    if callers:
        caller_text = "\n\n".join(f"### caller {c['path']}::{c['name']}\n{c.get('body') or c['signature']}" for c in callers)
        sections.append(f"## Callers (quem chama o código alterado)\n{caller_text}")

    callees = related_context.get("callees") or []
    if callees:
        callee_text = "\n\n".join(f"### callee {c['path']}::{c['name']}\n{c.get('body') or c['signature']}" for c in callees)
        sections.append(f"## Callees (o que o código alterado chama)\n{callee_text}")

    tests = related_context.get("tests") or []
    if tests:
        test_text = "\n\n".join(f"### test {t['path']}::{t['name']}\n{t.get('body') or t['signature']}" for t in tests)
        sections.append(f"## Tests (testes que cobrem o código alterado)\n{test_text}")

    dead = related_context.get("deadCodeCandidates") or []
    if dead:
        dead_text = "\n".join(f"- {d['path']}::{d['name']} — sem caller conhecido após esta PR" for d in dead)
        sections.append(f"## Possível código morto\n{dead_text}")

    only_tested = related_context.get("onlyTestedCandidates") or []
    if only_tested:
        only_tested_text = "\n".join(
            f"- {o['path']}::{o['name']} — só é chamado por teste, nenhum caller de produção"
            for o in only_tested
        )
        sections.append(f"## Coberto apenas por teste\n{only_tested_text}")

    repo_map = related_context.get("repoMap") or ""
    if repo_map:
        sections.append(f"## Repo map (assinaturas de vizinhos, sem corpo)\n{repo_map}")

    if not sections:
        return ""

    return "\n\n".join(sections)[:budget]

def clip_diff(diff: str) -> str:
    if len(diff) <= MAX_DIFF_CHARS:
        return diff
    return diff[:MAX_DIFF_CHARS] + "\n… (diff cortado)"

def prd_block(prd: dict | None) -> str:
    if not prd:
        return ""
    markdown = prd.get("markdown") or ""
    return f"PRD:\n{markdown}" if markdown else ""

def _one_file(file: dict, limit: int) -> str:
    related = file.get("relatedFiles") or []
    related_text = "\n".join(
        f"### related {item.get('path')}\n{str(item.get('content') or '')[: max(0, limit // 4)]}"
        for item in related[:2]
        if not _should_skip(str(item.get("path") or ""))
    )
    return (
        f"## {file.get('path')}\n"
        f"DIFF:\n{str(file.get('diff') or '')[:limit]}\n"
        f"FULL:\n{str(file.get('fullContent') or '')[:limit]}\n"
        f"{related_text}"
    )

def _should_skip(path: str) -> bool:
    lowered = path.replace("\\", "/").lower()
    if any(part in lowered for part in SKIP_DIR):
        return True
    return any(lowered.endswith(suffix) or suffix in lowered.split("/")[-1] for suffix in SKIP_NAME)

def _prefer_source_files(files: list[dict]) -> list[dict]:
    def rank(file: dict) -> tuple[int, str]:
        path = str(file.get("path") or "").lower()
        if any(mark in path for mark in (".spec.", ".test.", "/test/", "/tests/")):
            return (0, path)
        if path.endswith((".ts", ".tsx", ".py", ".js", ".jsx")):
            return (1, path)
        return (2, path)

    return sorted(files, key=rank)
