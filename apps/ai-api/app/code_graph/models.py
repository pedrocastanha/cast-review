from typing import Any, Literal

from pydantic import BaseModel, Field

SymbolKind = Literal["file", "function", "class", "method"]
EdgeKind = Literal["defines", "references", "imports", "tests"]
HttpEndpointRole = Literal["provider", "consumer"]


class Symbol(BaseModel):
    id: str
    kind: SymbolKind
    path: str
    name: str
    line: int
    end_line: int
    signature: str
    body: str = ""
    decorators: list[str] = Field(default_factory=list)
    parent_id: str | None = None
    content_hash: str = ""


class Edge(BaseModel):
    from_id: str
    to_id: str
    kind: EdgeKind
    weight: float = 1.0


class Graph(BaseModel):
    nodes: dict[str, Symbol] = Field(default_factory=dict)
    edges: list[Edge] = Field(default_factory=list)
    endpoints: list["HttpEndpoint"] = Field(default_factory=list)


class HttpEndpoint(BaseModel):
    id: str
    role: HttpEndpointRole
    method: str
    route: str
    normalized_route: str
    path: str
    line: int
    framework: str
    evidence_type: str = "method_route"
    symbol_id: str | None = None
    symbol_name: str | None = None


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


class ScoredNode(BaseModel):
    symbol_id: str
    score: float


class DeadCodeResult(BaseModel):
    """Internal only (input to `assemble_related_context`, T14) — never serialized
    directly to HTTP, so snake_case like `Symbol`/`Edge`/`Graph`."""

    dead: list[Symbol] = Field(default_factory=list)
    only_tested: list[Symbol] = Field(default_factory=list)


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
    onlyTestedCandidates: list[SymbolRef] = Field(default_factory=list)
    repoMap: str = ""
    stats: IndexStats


class IndexResult(BaseModel):
    indexId: str
    indexedFiles: int
    skippedFiles: int
    reusedFiles: int = 0
    truncated: bool = False
    durationMs: int


class VizNode(BaseModel):
    id: str
    label: str
    kind: str
    path: str
    count: int = 1
    parentId: str | None = None


class VizEdge(BaseModel):
    source: str
    target: str
    kind: str


class VizGraph(BaseModel):
    nodes: list[VizNode] = Field(default_factory=list)
    edges: list[VizEdge] = Field(default_factory=list)
    stats: IndexStats


class ProjectRepositoryRef(BaseModel):
    repoId: str
    sha: str | None = None


class ProjectGraphNode(BaseModel):
    id: str
    repoId: str
    label: str
    kind: Literal["repository"] = "repository"
    indexed: bool
    sha: str | None = None


class ProjectEndpointEvidence(BaseModel):
    repoId: str
    path: str
    line: int
    sha: str
    symbolId: str | None = None
    symbolName: str | None = None
    framework: str


class ProjectEndpointMatch(BaseModel):
    method: str
    route: str
    confidence: Literal["confirmed"] = "confirmed"
    evidenceType: Literal["method_route"] = "method_route"
    consumer: ProjectEndpointEvidence
    provider: ProjectEndpointEvidence


class ProjectGraphEdge(BaseModel):
    id: str
    source: str
    target: str
    kind: Literal["consumes"] = "consumes"
    count: int
    confidence: Literal["confirmed"] = "confirmed"
    matches: list[ProjectEndpointMatch] = Field(default_factory=list)


class ProjectGraphStats(BaseModel):
    repositories: int
    indexedRepositories: int
    links: int
    endpoints: int


class ProjectGraph(BaseModel):
    nodes: list[ProjectGraphNode] = Field(default_factory=list)
    edges: list[ProjectGraphEdge] = Field(default_factory=list)
    stats: ProjectGraphStats


GraphRelation = Literal["changed", "caller", "callee", "test", "dead_code", "only_tested"]
GraphConfidence = Literal["confirmed", "inferred", "unresolved", "stale"]


class GraphSnapshotNode(BaseModel):
    id: str
    kind: str
    path: str
    name: str
    signature: str
    body: str | None = None
    line: int
    endLine: int
    contentHash: str | None = None
    relation: GraphRelation
    distance: int | None = None
    score: float | None = None
    confidence: GraphConfidence
    reason: str


class GraphSnapshotEdge(BaseModel):
    fromId: str
    toId: str
    kind: EdgeKind
    weight: float = 1.0
    confidence: Literal["confirmed", "inferred", "stale"] = "confirmed"


class SnapshotRepository(BaseModel):
    repoId: str
    owner: str
    repo: str
    pullNumber: int | None = None
    baseSha: str | None = None
    requestedSha: str | None = None


class SnapshotGraphMetadata(BaseModel):
    indexedSha: str | None = None
    stale: bool = False
    indexerVersion: str = "code-graph-v1"
    graphSchemaVersion: str = "1"
    queryVersion: str = "related-context-v2"


class SnapshotInput(BaseModel):
    diffHash: str
    diff: str
    changedFiles: list[dict[str, Any]] = Field(default_factory=list)
    conventions: str = ""


class SnapshotSelection(BaseModel):
    nodes: list[GraphSnapshotNode] = Field(default_factory=list)
    changedSymbols: list[GraphSnapshotNode] = Field(default_factory=list)
    callers: list[GraphSnapshotNode] = Field(default_factory=list)
    callees: list[GraphSnapshotNode] = Field(default_factory=list)
    tests: list[GraphSnapshotNode] = Field(default_factory=list)
    deadCodeCandidates: list[GraphSnapshotNode] = Field(default_factory=list)
    onlyTestedCandidates: list[GraphSnapshotNode] = Field(default_factory=list)
    repoMap: str = ""


class SnapshotBudget(BaseModel):
    tokenBudget: int
    budgetUsed: int
    truncated: bool
    omittedNodes: int
    omittedEdges: int


class SnapshotRendered(BaseModel):
    graphContextBlock: str
    relatedContext: dict[str, Any]


class AnalysisContextSnapshot(BaseModel):
    schemaVersion: Literal["1"] = "1"
    snapshotHash: str
    createdAt: str
    analysisId: str | None = None
    repository: SnapshotRepository
    graph: SnapshotGraphMetadata
    input: SnapshotInput
    selected: SnapshotSelection
    edges: list[GraphSnapshotEdge] = Field(default_factory=list)
    budget: SnapshotBudget
    rendered: SnapshotRendered
