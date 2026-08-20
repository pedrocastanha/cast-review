import json
import re
from pathlib import Path, PurePosixPath

from tree_sitter import Node, Query, QueryCursor
from tree_sitter_language_pack import get_language, get_parser

from app.code_graph.models import ParsedSymbols, RawCall, Symbol

QUERIES_DIR = Path(__file__).parent / "queries"

EXTENSION_LANGUAGE = {
    ".ts": "typescript",
    ".tsx": "tsx",
    ".js": "javascript",
    ".jsx": "javascript",
    ".py": "python",
}

QUERY_FILE_BY_LANGUAGE = {
    "typescript": "typescript.scm",
    "tsx": "typescript.scm",
    "javascript": "javascript.scm",
    "python": "python.scm",
}

DEFINITION_CAPTURE_KIND = {
    "def.function": "function",
    "def.class": "class",
    "def.method": "method",
}

DEFINITION_NODE_TYPES = (
    "function_declaration",
    "function_definition",
    "class_declaration",
    "class_definition",
    "method_definition",
)

CANDIDATE_EXTENSIONS = (".ts", ".tsx", ".js", ".jsx", ".py")
INDEX_FILENAMES = ("index.ts", "index.tsx", "index.js", "index.jsx", "__init__.py")

_QUERY_CACHE: dict[str, Query] = {}


class UnsupportedLanguageError(Exception):
    pass


def language_for_path(path: str) -> str:
    ext = Path(path).suffix
    language = EXTENSION_LANGUAGE.get(ext)
    if language is None:
        raise UnsupportedLanguageError(f"unsupported extension: {ext}")
    return language


def _get_query(language: str) -> Query:
    if language not in _QUERY_CACHE:
        query_path = QUERIES_DIR / QUERY_FILE_BY_LANGUAGE[language]
        _QUERY_CACHE[language] = Query(get_language(language), query_path.read_text())
    return _QUERY_CACHE[language]


def _signature(node: Node, source: bytes) -> str:
    body = node.child_by_field_name("body")
    end = body.start_byte if body is not None else node.end_byte
    return source[node.start_byte : end].decode("utf-8", errors="replace").strip()


def _symbol_id(path: str, name: str, start_byte: int) -> str:
    return f"{path}::{name}@{start_byte}"


CLASS_NODE_TYPES = ("class_declaration", "class_definition")


def _is_method_node(def_node: Node) -> bool:
    """True when a function_definition (Python has no separate method node type) sits directly inside a class body."""
    parent = def_node.parent
    return parent is not None and parent.parent is not None and parent.parent.type in CLASS_NODE_TYPES


def _collect_decorators(def_node: Node, source: bytes) -> list[str]:
    """Python: decorators live as sibling `decorator` nodes inside the `decorated_definition`
    wrapper around def_node. TS/JS: decorators are preceding siblings of def_node within the
    same parent (class body, or the `export_statement` wrapping a decorated class)."""
    decorators: list[str] = []
    wrapper = def_node.parent
    if wrapper is not None and wrapper.type == "decorated_definition":
        for child in wrapper.children:
            if child.type == "decorator":
                decorators.append(source[child.start_byte : child.end_byte].decode("utf-8", errors="replace"))
        return decorators

    if wrapper is None:
        return decorators
    siblings = wrapper.children
    def_index = next((i for i, c in enumerate(siblings) if c.id == def_node.id), None)
    if def_index is None:
        return decorators
    # Walk backward skipping unnamed tokens (e.g. the `export` keyword between a
    # decorator and the class it decorates in `export_statement`), but stop at the
    # first *named* sibling that isn't a decorator — that's the previous method/class
    # in a body with multiple members, and its decorators must not leak onto this one.
    collected: list[str] = []
    i = def_index - 1
    while i >= 0:
        sib = siblings[i]
        if sib.type == "decorator":
            collected.append(source[sib.start_byte : sib.end_byte].decode("utf-8", errors="replace"))
        elif sib.is_named:
            break
        i -= 1
    collected.reverse()
    return collected


def _find_definition_ancestor(node: Node) -> Node | None:
    current = node.parent
    while current is not None:
        if current.type in DEFINITION_NODE_TYPES:
            return current
        current = current.parent
    return None


def _strip_quotes(text: str) -> str:
    return text.strip().strip("'\"")


def parse_file(path: str, content: str) -> ParsedSymbols:
    language = language_for_path(path)
    parser = get_parser(language)
    source = content.encode("utf-8")
    tree = parser.parse(source)

    query = _get_query(language)
    cursor = QueryCursor(query)
    matches = cursor.matches(tree.root_node)

    symbols: list[Symbol] = []
    symbol_by_def_node_id: dict[int, Symbol] = {}
    call_matches: list[dict] = []
    imports: list[str] = []

    for _pattern_index, captures in matches:
        for capture_name, kind in DEFINITION_CAPTURE_KIND.items():
            for name_node in captures.get(capture_name, []):
                def_node = _find_definition_ancestor_or_self(name_node, kind)
                if def_node is None:
                    continue
                effective_kind = "method" if kind == "function" and _is_method_node(def_node) else kind
                symbol = Symbol(
                    id=_symbol_id(path, name_node.text.decode("utf-8", errors="replace"), def_node.start_byte),
                    kind=effective_kind,
                    path=path,
                    name=name_node.text.decode("utf-8", errors="replace"),
                    line=def_node.start_point.row + 1,
                    end_line=def_node.end_point.row + 1,
                    signature=_signature(def_node, source),
                    decorators=_collect_decorators(def_node, source),
                )
                symbols.append(symbol)
                symbol_by_def_node_id[def_node.id] = symbol

        if "call.node" in captures:
            call_node = captures["call.node"][0]
            name_nodes = captures.get("call.name", [])
            if name_nodes:
                call_matches.append({"node": call_node, "name": name_nodes[0].text.decode("utf-8", errors="replace")})

        if "import.node" in captures:
            source_nodes = captures.get("import.source")
            if source_nodes:
                imports.append(_strip_quotes(source_nodes[0].text.decode("utf-8", errors="replace")))
            else:
                imports.append(captures["import.node"][0].text.decode("utf-8", errors="replace").strip())

    def _enclosing_symbol_id(node: Node) -> str | None:
        current = node.parent
        while current is not None:
            symbol = symbol_by_def_node_id.get(current.id)
            if symbol is not None:
                return symbol.id
            current = current.parent
        return None

    calls = [
        RawCall(caller_symbol_id=_enclosing_symbol_id(call["node"]), callee_name=call["name"])
        for call in call_matches
    ]

    return ParsedSymbols(path=path, symbols=symbols, calls=calls, imports=imports)


def _find_definition_ancestor_or_self(name_node: Node, kind: str) -> Node | None:
    parent = name_node.parent
    if parent is not None and parent.type in DEFINITION_NODE_TYPES:
        return parent
    return _find_definition_ancestor(name_node)


def parse_python_import(raw: str) -> tuple[str, list[str], bool]:
    """Returns (module_path, imported_names, is_relative). `imported_names` is only
    populated for `from X import a, b` — needed because each name may itself be a
    submodule file (`from pkg.sub import mod` → `pkg/sub/mod.py`), which is the common
    case for internal package imports, as opposed to a symbol defined inside X."""
    stripped = raw.strip()
    if stripped.startswith("from "):
        rest = stripped[len("from ") :]
        module_part, _, import_part = rest.partition(" import")
        module = module_part.strip()
        names = [n.strip().split(" as")[0].strip() for n in import_part.strip().split(",") if n.strip()]
        is_relative = module.startswith(".") or module == ""
        return module, names, is_relative
    module = stripped[len("import ") :].split(" as")[0].split(",")[0].strip()
    return module, [], module.startswith(".")


def resolve_import(
    raw_import: str,
    from_path: str,
    known_paths: set[str],
    tsconfig_paths: dict[str, list[str]] | None = None,
) -> str | None:
    """Resolves relative and tsconfig/pyproject-alias imports against a known set of repo file paths.
    Returns None if unresolvable — caller (graph builder) may fall back to unique-symbol-name matching."""
    language = language_for_path(from_path)
    from_dir = PurePosixPath(from_path).parent

    if language == "python":
        module, names, is_relative = parse_python_import(raw_import)
        if is_relative:
            dots = len(module) - len(module.lstrip("."))
            remainder = module.lstrip(".")
            base = from_dir
            for _ in range(dots - 1):
                base = base.parent
            base = base / remainder.replace(".", "/") if remainder else base
        else:
            base = PurePosixPath(module.replace(".", "/")) if module else PurePosixPath("")

        for name in names:
            match = _match_candidate(base / name, known_paths)
            if match:
                return match
        return _match_candidate(base, known_paths)

    if raw_import.startswith("."):
        candidate = (from_dir / raw_import).as_posix()
        candidate = _normalize_dots(candidate)
        return _match_candidate(PurePosixPath(candidate), known_paths)

    if tsconfig_paths:
        for alias_pattern, targets in tsconfig_paths.items():
            prefix = alias_pattern.rstrip("*")
            if raw_import.startswith(prefix):
                suffix = raw_import[len(prefix) :]
                for target_pattern in targets:
                    target_prefix = target_pattern.rstrip("*")
                    candidate = PurePosixPath(target_prefix + suffix)
                    match = _match_candidate(candidate, known_paths)
                    if match:
                        return match

    return None


def _normalize_dots(path: str) -> str:
    parts: list[str] = []
    for part in path.split("/"):
        if part == "..":
            if parts:
                parts.pop()
        elif part == ".":
            continue
        else:
            parts.append(part)
    return "/".join(parts)


def _match_candidate(candidate: PurePosixPath, known_paths: set[str]) -> str | None:
    candidate_str = candidate.as_posix()
    if candidate_str in known_paths:
        return candidate_str
    for ext in CANDIDATE_EXTENSIONS:
        with_ext = candidate_str + ext
        if with_ext in known_paths:
            return with_ext
    for index_name in INDEX_FILENAMES:
        with_index = f"{candidate_str}/{index_name}"
        if with_index in known_paths:
            return with_index
    return None


def index_files(files: list[dict]) -> tuple[list[ParsedSymbols], int]:
    """Parses every file, skipping (not aborting on) any single-file failure —
    unsupported extension, tree-sitter parse error, anything. The broad `except`
    is intentional: this is the fallback boundary itself (CGC-03/CGC-04), so a
    parse crash on one file must never take down indexing of the rest."""
    parsed: list[ParsedSymbols] = []
    skipped = 0
    for file in files:
        try:
            parsed.append(parse_file(file["path"], file["content"]))
        except Exception:
            skipped += 1
    return parsed, skipped


def load_tsconfig_paths(tsconfig_content: str) -> dict[str, list[str]]:
    """Parses `compilerOptions.paths` from a tsconfig.json string. Tolerates trailing commas/comments minimally — returns {} on any parse failure rather than raising."""
    try:
        cleaned = re.sub(r"//.*", "", tsconfig_content)
        cleaned = re.sub(r",(\s*[}\]])", r"\1", cleaned)
        data = json.loads(cleaned)
        return data.get("compilerOptions", {}).get("paths", {}) or {}
    except (json.JSONDecodeError, AttributeError):
        return {}
