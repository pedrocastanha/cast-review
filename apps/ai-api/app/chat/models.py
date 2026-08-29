from typing import Any, Literal

from pydantic import BaseModel, Field

from app.application.dto.schemas import ApiKeys

ChatEventType = Literal["tool_call", "tool_result", "token", "message_done", "error"]


class Citation(BaseModel):
    repoId: str
    path: str
    line: int | None = None
    symbolId: str | None = None
    symbolName: str | None = None


class ToolResult(BaseModel):
    items: list[dict[str, Any]] = Field(default_factory=list)
    citations: list[Citation] = Field(default_factory=list)
    truncated: bool = False
    note: str | None = None


class ChatScopeRepository(BaseModel):
    repoId: str
    sha: str


class ChatCatalogAccess(BaseModel):
    url: str
    grant: str


class ChatMention(BaseModel):
    repoId: str
    path: str
    content: str


class ChatHistoryMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRunRequest(BaseModel):
    threadId: str
    mode: Literal["global", "repository"]
    repositories: list[ChatScopeRepository]
    history: list[ChatHistoryMessage] = Field(default_factory=list)
    question: str
    mentions: list[ChatMention] = Field(default_factory=list)
    model: str
    repositoryHint: ChatScopeRepository | None = None
    catalog: ChatCatalogAccess | None = None
    apiKeys: ApiKeys


class ChatToolCallRecord(BaseModel):
    iteration: int
    name: str
    args: dict[str, Any]
    itemCount: int
    truncated: bool
    durationMs: int
    note: str | None = None


class ChatUsage(BaseModel):
    promptTokens: int = 0
    completionTokens: int = 0
    cachedTokens: int = 0
    costUsd: float = 0.0


class ChatEvent(BaseModel):
    type: ChatEventType
    payload: dict[str, Any] = Field(default_factory=dict)
