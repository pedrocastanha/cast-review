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

def files_block(files: list[dict]) -> str:
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

    return "\n\n".join(chunks)

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
