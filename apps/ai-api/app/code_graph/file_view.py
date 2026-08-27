from app.code_graph.models import Graph, Symbol

GAP_MARKER = "# ... ({count} linhas omitidas: sem símbolo indexado)"


def file_symbols(graph: Graph, path: str) -> list[Symbol]:
    symbols = [
        symbol
        for symbol in graph.nodes.values()
        if symbol.path == path and symbol.kind != "file" and symbol.body
    ]
    return sorted(symbols, key=lambda symbol: (symbol.line, symbol.end_line))


def distinct_paths(graph: Graph, query: str | None = None, limit: int = 100) -> list[str]:
    needle = (query or "").lower()
    paths = sorted({symbol.path for symbol in graph.nodes.values()})
    if needle:
        paths = [path for path in paths if needle in path.lower()]
    return paths[:limit]


def render_file(graph: Graph, path: str) -> str | None:
    symbols = file_symbols(graph, path)
    if not symbols:
        return None

    chunks: list[str] = []
    cursor = 1
    for symbol in symbols:
        if symbol.line > cursor:
            gap = symbol.line - cursor
            chunks.append(GAP_MARKER.format(count=gap))
        elif symbol.end_line < cursor:
            continue
        chunks.append(symbol.body.rstrip("\n"))
        cursor = max(cursor, symbol.end_line + 1)

    return "\n".join(chunks)
