from typing import Literal

from pydantic import BaseModel, Field

ComponentKind = Literal["repository", "directory"]
DependencyKind = Literal["references", "imports", "tests", "http"]
EvidenceKind = Literal["symbol", "edge", "endpoint"]


class ArchitectureRepositoryRef(BaseModel):
    repoId: str
    sha: str | None = None


class ComponentEvidence(BaseModel):
    kind: EvidenceKind
    repoId: str
    sha: str | None = None
    path: str
    line: int | None = None
    symbolId: str | None = None
    symbolName: str | None = None


class ComponentCandidate(BaseModel):
    candidateKey: str
    repoId: str
    pathPrefix: str
    label: str
    kind: ComponentKind
    sha: str | None = None
    indexed: bool
    fileCount: int
    symbolCount: int
    internalEdges: int
    inboundEdges: int
    outboundEdges: int
    providedEndpoints: int
    consumedEndpoints: int
    evidence: list[ComponentEvidence] = Field(default_factory=list)


class ArchitectureStats(BaseModel):
    repositories: int
    indexedRepositories: int
    symbols: int
    candidates: int
    omittedRepositories: list[str] = Field(default_factory=list)


class CandidatesResponse(BaseModel):
    candidates: list[ComponentCandidate] = Field(default_factory=list)
    stats: ArchitectureStats


class ComponentRef(BaseModel):
    componentId: str
    repoId: str
    pathPrefix: str


class DependencyEvidence(BaseModel):
    kind: DependencyKind
    fromRepoId: str
    fromPath: str
    fromLine: int | None = None
    fromSymbolId: str | None = None
    fromSymbolName: str | None = None
    toRepoId: str
    toPath: str
    toLine: int | None = None
    toSymbolId: str | None = None
    toSymbolName: str | None = None
    fromSha: str | None = None
    toSha: str | None = None
    method: str | None = None
    route: str | None = None


class ComponentDependency(BaseModel):
    fromComponentId: str
    toComponentId: str
    kind: DependencyKind
    count: int
    confidence: Literal["confirmed"] = "confirmed"
    evidence: list[DependencyEvidence] = Field(default_factory=list)


class DependenciesResponse(BaseModel):
    dependencies: list[ComponentDependency] = Field(default_factory=list)
    stats: ArchitectureStats


class ChangedFileRef(BaseModel):
    repoId: str
    path: str


class TouchedComponent(BaseModel):
    componentId: str
    changedFiles: list[str] = Field(default_factory=list)
    changedSymbols: list[ComponentEvidence] = Field(default_factory=list)


class ReachedComponent(BaseModel):
    componentId: str
    viaComponentId: str
    direction: Literal["provides", "consumes"]
    kinds: list[DependencyKind] = Field(default_factory=list)
    count: int


class ImpactStats(BaseModel):
    changedFiles: int
    mappedFiles: int
    unmappedFiles: int
    coverage: float
    staleRepositories: list[str] = Field(default_factory=list)


class ImpactResponse(BaseModel):
    touched: list[TouchedComponent] = Field(default_factory=list)
    reached: list[ReachedComponent] = Field(default_factory=list)
    unmapped: list[ChangedFileRef] = Field(default_factory=list)
    stats: ImpactStats
