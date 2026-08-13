from typing import Any, Literal

from pydantic import BaseModel, Field

AgentEventType = Literal[
    "change_analysis_done",
    "prd_generated",
    "spec_generated",
    "test_reviewer_done",
    "architecture_reviewer_done",
    "report_ready",
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
    relatedFiles: list[RelatedFile] = Field(default_factory=list)


class ReviewModels(BaseModel):
    testReviewer: str
    architectureReviewer: str


class ApiKeys(BaseModel):
    openai: str


class AgentRunRequest(BaseModel):
    diff: str
    changedFiles: list[ChangedFileContext]
    conventions: str = ""
    models: ReviewModels
    apiKeys: ApiKeys


class AgentEvent(BaseModel):
    type: AgentEventType
    payload: dict[str, Any]
