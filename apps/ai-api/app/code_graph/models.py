from typing import Literal

from pydantic import BaseModel, Field

SymbolKind = Literal["file", "function", "class", "method"]
EdgeKind = Literal["defines", "references", "imports", "tests"]


class Symbol(BaseModel):
    id: str
    kind: SymbolKind
    path: str
    name: str
    line: int
    end_line: int
    signature: str
    decorators: list[str] = Field(default_factory=list)


class Edge(BaseModel):
    from_id: str
    to_id: str
    kind: EdgeKind
    weight: float = 1.0


class Graph(BaseModel):
    nodes: dict[str, Symbol] = Field(default_factory=dict)
    edges: list[Edge] = Field(default_factory=list)


class RawCall(BaseModel):
    caller_symbol_id: str | None
    callee_name: str


class ParsedSymbols(BaseModel):
    path: str
    symbols: list[Symbol] = Field(default_factory=list)
    calls: list[RawCall] = Field(default_factory=list)
    imports: list[str] = Field(default_factory=list)


class SymbolRef(BaseModel):
    path: str
    name: str
    signature: str
    body: str | None = None


class IndexStats(BaseModel):
    """Crosses the HTTP boundary as part of `RelatedContext`/`IndexResult` — field names
    are camelCase to match this project's convention for anything JSON-facing
    (see `apps/ai-api/app/application/dto/schemas.py`), unlike the snake_case internal-only
    models above (`Symbol`/`Edge`/`Graph`/`ParsedSymbols`), which are never serialized
    directly to the Nest backend or frontend — only persisted to Redis and read back by
    Python."""

    indexed: bool
    stale: bool = False
    indexedFiles: int = 0
    skippedFiles: int = 0
    reusedFiles: int = 0
    budgetUsed: int = 0
    truncated: bool = False


class RelatedContext(BaseModel):
    callers: list[SymbolRef] = Field(default_factory=list)
    callees: list[SymbolRef] = Field(default_factory=list)
    tests: list[SymbolRef] = Field(default_factory=list)
    deadCodeCandidates: list[SymbolRef] = Field(default_factory=list)
    repoMap: str = ""
    stats: IndexStats


class DeadCodeResult(BaseModel):
    """Internal only (input to `assemble_related_context`, T14) — never serialized
    directly to HTTP, so snake_case like `Symbol`/`Edge`/`Graph`."""

    dead: list[Symbol] = Field(default_factory=list)
    only_tested: list[Symbol] = Field(default_factory=list)


class IndexResult(BaseModel):
    indexId: str
    indexedFiles: int
    skippedFiles: int
    durationMs: int
