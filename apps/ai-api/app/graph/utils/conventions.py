from pathlib import Path

DEFAULT_CONVENTIONS_PATH = (
    Path(__file__).resolve().parent.parent / "conventions" / "default.md"
)


def resolve_conventions(raw: str | None) -> tuple[str, str]:
    text = (raw or "").strip()
    if text:
        return text, "repo"
    fallback = DEFAULT_CONVENTIONS_PATH.read_text(encoding="utf-8").strip()
    return fallback, "default"
