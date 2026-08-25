from typing import Any, Literal

from pydantic import BaseModel, Field

AgentEventType = Literal[
    "change_analysis_done",
    "prd_generated",
    "spec_generated",
    "test_reviewer_done",
    "architecture_reviewer_done",
    "report_ready",
    "awaiting_approval",
    "thought",
    "error",
]


class RelatedFile(BaseModel):
    path: str
    content: str


class ChangedFileContext(BaseModel):
    path: str
    diff: str = ""
    fullContent: str = ""
    baseContent: str = ""
    relatedFiles: list[RelatedFile] = Field(default_factory=list)


class ReviewModels(BaseModel):
    testReviewer: str
    architectureReviewer: str


class ApiKeys(BaseModel):
    openai: str


class Policies(BaseModel):
    prd: Literal["manual", "auto"] = "manual"
    spec: Literal["manual", "auto"] = "manual"


class FrozenImpactRepository(BaseModel):
    repoId: str
    indexedSha: str | None = None
    indexStatus: str
    included: bool
    omissionReason: str | None = None


class FrozenImpactScope(BaseModel):
    requestedMode: Literal["repository", "project"]
    effectiveMode: Literal["repository", "project"]
    status: Literal["exact", "degraded", "fallback"]
    projectId: str | None = None
    projectName: str | None = None
    fallbackReason: str | None = None
    repositories: list[FrozenImpactRepository] = Field(default_factory=list)


class AgentRunRequest(BaseModel):
    analysisId: str
    diff: str
    changedFiles: list[ChangedFileContext]
    conventions: str = ""
    models: ReviewModels
    apiKeys: ApiKeys
    policies: Policies = Field(default_factory=Policies)
    repoId: str | None = None
    sha: str | None = None
    baseSha: str | None = None
    pullNumber: int | None = None
    impactScope: FrozenImpactScope | None = None
    frozenContext: dict[str, Any] | None = None


class Annotation(BaseModel):
    excerpt: str
    note: str


class ApprovalDecision(BaseModel):
    stage: Literal["prd", "spec"]
    action: Literal["approve", "reject"]
    annotations: list[Annotation] | None = None


class AgentResumeRequest(BaseModel):
    analysisId: str
    models: ReviewModels
    apiKeys: ApiKeys
    policies: Policies
    decision: ApprovalDecision | None = None


class AgentEvent(BaseModel):
    type: AgentEventType
    payload: dict[str, Any]
