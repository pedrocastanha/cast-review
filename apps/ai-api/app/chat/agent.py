import asyncio
import json
import time
from collections.abc import AsyncIterator
from typing import Any

from app.chat.catalog import CatalogClient
from app.chat.models import (
    ChatEvent,
    ChatRunRequest,
    ChatToolCallRecord,
    ChatUsage,
    Citation,
)
from app.chat.prompt import SYSTEM_PROMPT, mention_block, scope_briefing
from app.chat.tools import GlobalToolExecutor, RepoWorkspace, ToolError, ToolExecutor
from app.chat.requirements import REQUIREMENTS_PROMPT, generate_proposal
from app.infrastructure.llm.client import LlmError, complete_with_tools
from app.infrastructure.llm.pricing import estimate_cost_usd
from app.infrastructure.logging.setup import get_logger

log = get_logger(__name__)

MAX_ITERATIONS = 8
MAX_HISTORY_MESSAGES = 20
MAX_REPEATED_CALLS = 2
MAX_CITATIONS = 12
STOP_BUDGET_RATIO = 0.85
MAX_TOOL_CONTEXT_CHARS = 48_000
_DONE = object()


def _signature(name: str, args: dict[str, Any]) -> str:
    return f"{name}:{json.dumps(args, sort_keys=True, ensure_ascii=False)}"


def _validate_citations(
    citations: list[Citation], executor: ToolExecutor | GlobalToolExecutor
) -> list[Citation]:
    known_paths = {
        (workspace.repo_id, symbol.path)
        for workspace in executor.workspaces
        for symbol in workspace.graph.nodes.values()
    }
    known_symbols = {
        (workspace.repo_id, symbol_id)
        for workspace in executor.workspaces
        for symbol_id in workspace.graph.nodes
    }

    seen: set[tuple] = set()
    by_repository: dict[str, list[Citation]] = {}
    for citation in citations:
        if (citation.repoId, citation.path) not in known_paths:
            continue
        if citation.symbolId and (citation.repoId, citation.symbolId) not in known_symbols:
            continue
        key = (citation.repoId, citation.path, citation.line, citation.symbolId)
        if key in seen:
            continue
        seen.add(key)
        by_repository.setdefault(citation.repoId, []).append(citation)

    valid: list[Citation] = []
    while len(valid) < MAX_CITATIONS:
        added = False
        for repository_citations in by_repository.values():
            if not repository_citations:
                continue
            valid.append(repository_citations.pop(0))
            added = True
            if len(valid) >= MAX_CITATIONS:
                break
        if not added:
            break
    return valid


def _initial_messages(request: ChatRunRequest) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = [
        {
            "role": "user",
            "content": scope_briefing(
                request.mode,
                [(repo.repoId, repo.sha) for repo in request.repositories],
                request.repositoryHint.repoId if request.repositoryHint else None,
            ),
        }
    ]
    for entry in request.history[-MAX_HISTORY_MESSAGES:]:
        messages.append({"role": entry.role, "content": entry.content})

    parts = [
        mention_block(mention.path, mention.repoId, mention.content)
        for mention in request.mentions
    ]
    parts.append(request.question)
    if request.omittedRepositories:
        parts.append("Repositórios sem cobertura: " + ", ".join(request.omittedRepositories))
    messages.append({"role": "user", "content": "\n\n".join(parts)})
    return messages


async def _load_workspaces(cache, request: ChatRunRequest) -> list[RepoWorkspace]:
    workspaces: list[RepoWorkspace] = []
    for repo in request.repositories:
        graph = await cache.lookup(repo.repoId, repo.sha)
        if graph is None:
            continue
        workspaces.append(RepoWorkspace(repo.repoId, repo.sha, graph))
    return workspaces


async def run_chat(cache, request: ChatRunRequest) -> AsyncIterator[ChatEvent]:
    queue: asyncio.Queue[ChatEvent | object] = asyncio.Queue()
    bound = log.bind(thread_id=request.threadId, mode=request.mode)

    async def produce() -> None:
        started = time.monotonic()
        try:
            if request.mode == "global":
                if request.catalog is None:
                    raise ToolError("catálogo de repositórios não configurado")
                executor = GlobalToolExecutor(cache, CatalogClient(request.catalog))
            else:
                workspaces = await _load_workspaces(cache, request)
                executor = ToolExecutor(workspaces, mode=request.mode)
            await _converse(queue, executor, request, bound)
        except ToolError as exc:
            await queue.put(ChatEvent(type="error", payload={"message": str(exc)}))
        except LlmError as exc:
            bound.error("chat.run.error", error=exc.message)
            await queue.put(ChatEvent(type="error", payload={"message": exc.message}))
        except Exception as exc:
            bound.error("chat.run.error", error=str(exc))
            await queue.put(
                ChatEvent(type="error", payload={"message": f"falha ao responder: {exc}"})
            )
        finally:
            bound.info(
                "chat.run.end", duration_ms=round((time.monotonic() - started) * 1000, 1)
            )
            await queue.put(_DONE)

    task = asyncio.create_task(produce())
    try:
        while True:
            item = await queue.get()
            if item is _DONE:
                break
            yield item
    finally:
        task.cancel()


async def _converse(
    queue: asyncio.Queue,
    executor: ToolExecutor | GlobalToolExecutor,
    request: ChatRunRequest,
    bound,
) -> None:
    messages = _initial_messages(request)
    definitions = executor.definitions()
    citations: list[Citation] = []
    records: list[ChatToolCallRecord] = []
    usage = ChatUsage()
    call_counts: dict[str, int] = {}
    tool_context_chars = 0
    truncated = False

    async def emit_token(delta: str) -> None:
        await queue.put(ChatEvent(type="token", payload={"delta": delta}))

    for iteration in range(1, MAX_ITERATIONS + 1):
        result = await complete_with_tools(
            system=SYSTEM_PROMPT + (REQUIREMENTS_PROMPT if request.assistanceMode == "requirements" else ""),
            messages=messages,
            tools=definitions,
            model=request.model,
            api_key=request.apiKeys.openai,
            on_delta=emit_token,
        )
        usage = ChatUsage(
            promptTokens=usage.promptTokens + result.usage.prompt_tokens,
            completionTokens=usage.completionTokens + result.usage.completion_tokens,
            cachedTokens=usage.cachedTokens + result.usage.cached_tokens,
            costUsd=round(
                usage.costUsd
                + estimate_cost_usd(
                    request.model,
                    result.usage.prompt_tokens,
                    result.usage.completion_tokens,
                    result.usage.cached_tokens,
                ),
                6,
            ),
        )

        if not result.tool_calls:
            await _finish(
                queue, result.content, citations, records, usage, executor, truncated, request
            )
            return

        messages.append(
            {
                "role": "assistant",
                "content": result.content or None,
                "tool_calls": [
                    {
                        "id": call.id,
                        "type": "function",
                        "function": {
                            "name": call.name,
                            "arguments": json.dumps(call.arguments, ensure_ascii=False),
                        },
                    }
                    for call in result.tool_calls
                ],
            }
        )

        stop_after = False
        for call in result.tool_calls:
            await queue.put(
                ChatEvent(
                    type="tool_call",
                    payload={"iteration": iteration, "name": call.name, "args": call.arguments},
                )
            )
            signature = _signature(call.name, call.arguments)
            call_counts[signature] = call_counts.get(signature, 0) + 1
            repeated = call_counts[signature] > 1

            started = time.monotonic()
            if stop_after:
                payload = {
                    "note": "orçamento de contexto das ferramentas atingido",
                    "items": [],
                }
                item_count, was_truncated, note = 0, True, payload["note"]
            elif repeated:
                payload = {
                    "note": "chamada idêntica já executada nesta mensagem; use o resultado anterior",
                    "items": [],
                }
                item_count, was_truncated, note = 0, False, payload["note"]
                if call_counts[signature] > MAX_REPEATED_CALLS:
                    stop_after = True
            else:
                try:
                    tool_result = await executor.execute_async(call.name, call.arguments)
                    candidate_payload = tool_result.model_dump(exclude_none=True)
                    candidate_size = len(
                        json.dumps(candidate_payload, ensure_ascii=False)
                    )
                    if tool_context_chars + candidate_size > MAX_TOOL_CONTEXT_CHARS:
                        payload = {
                            "note": "resultado omitido: orçamento de contexto das ferramentas atingido",
                            "items": [],
                        }
                        item_count, was_truncated, note = (
                            0,
                            True,
                            payload["note"],
                        )
                        stop_after = (
                            tool_context_chars >= MAX_TOOL_CONTEXT_CHARS * STOP_BUDGET_RATIO
                        )
                    else:
                        payload = candidate_payload
                        tool_context_chars += candidate_size
                        citations.extend(tool_result.citations)
                        item_count = len(tool_result.items)
                        was_truncated = tool_result.truncated
                        note = tool_result.note
                except ToolError as exc:
                    payload = {"error": str(exc), "items": []}
                    item_count, was_truncated, note = 0, False, str(exc)
                except Exception as exc:
                    bound.error("chat.tool.error", tool=call.name, error=str(exc))
                    payload = {"error": f"falha na ferramenta: {exc}", "items": []}
                    item_count, was_truncated, note = 0, False, str(exc)

            duration_ms = int((time.monotonic() - started) * 1000)
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": call.id,
                    "content": json.dumps(payload, ensure_ascii=False),
                }
            )
            records.append(
                ChatToolCallRecord(
                    iteration=iteration,
                    name=call.name,
                    args=call.arguments,
                    itemCount=item_count,
                    truncated=was_truncated,
                    durationMs=duration_ms,
                    note=note,
                )
            )
            await queue.put(
                ChatEvent(
                    type="tool_result",
                    payload={
                        "iteration": iteration,
                        "name": call.name,
                        "itemCount": item_count,
                        "truncated": was_truncated,
                        "durationMs": duration_ms,
                        "note": note,
                    },
                )
            )

        if stop_after:
            truncated = True
            break

    truncated = True
    final = await complete_with_tools(
        system=SYSTEM_PROMPT + (REQUIREMENTS_PROMPT if request.assistanceMode == "requirements" else ""),
        messages=[
            *messages,
            {
                "role": "user",
                "content": (
                    "O orçamento de ferramentas desta mensagem acabou. "
                    "Responda agora com o que já reuniu. Se algo essencial ficou sem "
                    "confirmar, diga isso em uma única frase no final, sem lista de ressalvas."
                ),
            },
        ],
        tools=[],
        model=request.model,
        api_key=request.apiKeys.openai,
        on_delta=emit_token,
    )
    usage = ChatUsage(
        promptTokens=usage.promptTokens + final.usage.prompt_tokens,
        completionTokens=usage.completionTokens + final.usage.completion_tokens,
        cachedTokens=usage.cachedTokens + final.usage.cached_tokens,
        costUsd=round(
            usage.costUsd
            + estimate_cost_usd(
                request.model,
                final.usage.prompt_tokens,
                final.usage.completion_tokens,
                final.usage.cached_tokens,
            ),
            6,
        ),
    )
    await _finish(queue, final.content, citations, records, usage, executor, truncated, request)


async def _finish(
    queue: asyncio.Queue,
    content: str,
    citations: list[Citation],
    records: list[ChatToolCallRecord],
    usage: ChatUsage,
    executor: ToolExecutor | GlobalToolExecutor,
    truncated: bool,
    request: ChatRunRequest | None = None,
) -> None:
    valid = _validate_citations(citations, executor)
    shas = {workspace.repo_id: workspace.sha for workspace in executor.workspaces}
    valid = [citation.model_copy(update={"sha": shas.get(citation.repoId)}) for citation in valid]
    proposal = None
    if request and request.assistanceMode == "requirements":
        try:
            proposal, extra = await generate_proposal(request, content, valid)
            usage.promptTokens += extra.prompt_tokens
            usage.completionTokens += extra.completion_tokens
            usage.cachedTokens += extra.cached_tokens
            usage.costUsd = round(usage.costUsd + estimate_cost_usd(
                request.model, extra.prompt_tokens, extra.completion_tokens, extra.cached_tokens
            ), 6)
            if proposal is None:
                content += "\n\nNão foi possível estruturar os cards. Peça para gerar a proposta novamente."
        except Exception:
            content += "\n\nNão foi possível estruturar os cards. Peça para gerar a proposta novamente."
        if proposal and request.omittedRepositories:
            proposal["openQuestions"] = list(dict.fromkeys([
                *proposal["openQuestions"][:29],
                "Validar impacto nos repositórios sem cobertura: " + ", ".join(request.omittedRepositories),
            ]))
        if proposal and truncated:
            proposal["openQuestions"] = [*proposal["openQuestions"][:29], "Revisar impacto: a investigação atingiu o limite de contexto."]
    await queue.put(
        ChatEvent(
            type="message_done",
            payload={
                "content": content,
                "citations": [
                    citation.model_dump()
                    for citation in valid
                ],
                "toolCalls": [record.model_dump() for record in records],
                "usage": usage.model_dump(),
                "truncated": truncated,
                "proposal": proposal,
            },
        )
    )
