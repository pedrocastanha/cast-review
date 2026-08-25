import hashlib
import re
from urllib.parse import urlsplit

from app.code_graph.models import Graph, HttpEndpoint

HTTP_METHODS = "get|post|put|patch|delete"
TEMPLATE_EXPRESSION = re.compile(r"\$\{[^}]+\}")
PATH_PARAMETER = re.compile(r"(?<=/):[^/]+|\{[^/{}]+\}")


def normalize_route(route: str) -> str:
    value = route.strip().strip("'\"`")
    if not value:
        return "/"

    if value.startswith(("http://", "https://")):
        value = urlsplit(value).path

    value = TEMPLATE_EXPRESSION.sub("{param}", value)
    value = value.split("?", 1)[0].split("#", 1)[0]

    first_slash = value.find("/")
    if first_slash > 0 and value[:first_slash].startswith("{param}"):
        value = value[first_slash:]

    if not value.startswith("/"):
        value = f"/{value}"

    value = re.sub(r"/{2,}", "/", value)
    value = PATH_PARAMETER.sub("{param}", value)
    if len(value) > 1:
        value = value.rstrip("/")
    return value


def _join_routes(prefix: str, route: str) -> str:
    return normalize_route(f"/{prefix.strip('/')}/{route.strip('/')}")


def _line_number(content: str, offset: int) -> int:
    return content.count("\n", 0, offset) + 1


def _endpoint_id(
    role: str,
    method: str,
    normalized_route: str,
    path: str,
    line: int,
) -> str:
    identity = f"{role}|{method}|{normalized_route}|{path}|{line}"
    return hashlib.sha256(identity.encode("utf-8")).hexdigest()[:24]


def _make_endpoint(
    *,
    role: str,
    method: str,
    route: str,
    path: str,
    line: int,
    framework: str,
    symbol_name: str | None = None,
) -> HttpEndpoint:
    normalized = normalize_route(route)
    return HttpEndpoint(
        id=_endpoint_id(role, method, normalized, path, line),
        role=role,
        method=method.upper(),
        route=route,
        normalized_route=normalized,
        path=path,
        line=line,
        framework=framework,
        symbol_name=symbol_name,
    )


def _quoted_argument(expression: str) -> str | None:
    stripped = expression.strip()
    if not stripped or stripped[0] not in "'\"`":
        return None
    quote = stripped[0]
    escaped = False
    for index in range(1, len(stripped)):
        char = stripped[index]
        if escaped:
            escaped = False
            continue
        if char == "\\":
            escaped = True
            continue
        if char == quote:
            return stripped[1:index]
    return None


def _call_body(content: str, opening_parenthesis: int) -> tuple[str, int]:
    depth = 0
    quote: str | None = None
    escaped = False
    for index in range(opening_parenthesis, len(content)):
        char = content[index]
        if quote:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
            continue
        if char in "'\"`":
            quote = char
        elif char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth == 0:
                return content[opening_parenthesis + 1 : index], index
    return content[opening_parenthesis + 1 :], len(content)


def _first_argument(call_body: str) -> str:
    depth = 0
    quote: str | None = None
    escaped = False
    for index, char in enumerate(call_body):
        if quote:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
            continue
        if char in "'\"`":
            quote = char
        elif char in "([{":
            depth += 1
        elif char in ")]}" and depth:
            depth -= 1
        elif char == "," and depth == 0:
            return call_body[:index]
    return call_body


def _has_static_path(route: str) -> bool:
    without_templates = TEMPLATE_EXPRESSION.sub("", route)
    return bool(re.search(r"/[A-Za-z0-9_.~-]", without_templates))


def _extract_nest(path: str, content: str) -> list[HttpEndpoint]:
    controller_pattern = re.compile(r"@Controller\s*\(\s*(?:['\"]([^'\"]*)['\"])?\s*\)")
    controllers = list(controller_pattern.finditer(content))
    if not controllers:
        return []
    decorator = re.compile(
        rf"@(?P<method>{HTTP_METHODS})\s*\(\s*(?:['\"](?P<route>[^'\"]*)['\"])?\s*\)",
        re.IGNORECASE,
    )
    endpoints: list[HttpEndpoint] = []
    for index, controller in enumerate(controllers):
        prefix = controller.group(1) or ""
        controller_end = controllers[index + 1].start() if index + 1 < len(controllers) else len(content)
        for match in decorator.finditer(content, controller.end(), controller_end):
            tail = content[match.end() : min(match.end() + 500, controller_end)]
            symbol_match = re.search(
                r"(?:public\s+|private\s+|protected\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(",
                tail,
            )
            route = _join_routes(prefix, match.group("route") or "")
            endpoints.append(
                _make_endpoint(
                    role="provider",
                    method=match.group("method"),
                    route=route,
                    path=path,
                    line=_line_number(content, match.start()),
                    framework="nestjs",
                    symbol_name=symbol_match.group(1) if symbol_match else None,
                )
            )
    return endpoints


def _extract_fastapi(path: str, content: str) -> list[HttpEndpoint]:
    router_prefixes = {"app": "", "router": ""}
    router_definition = re.compile(r"\b(?P<name>[A-Za-z_]\w*)\s*=\s*APIRouter\s*\(")
    for definition in router_definition.finditer(content):
        body, _ = _call_body(content, definition.end() - 1)
        prefix_match = re.search(r"\bprefix\s*=\s*['\"](?P<prefix>[^'\"]*)['\"]", body)
        router_prefixes[definition.group("name")] = prefix_match.group("prefix") if prefix_match else ""

    decorator = re.compile(
        rf"@(?P<router>[A-Za-z_]\w*)\.(?P<method>{HTTP_METHODS})\s*\(\s*['\"](?P<route>[^'\"]+)['\"]",
        re.IGNORECASE,
    )
    endpoints: list[HttpEndpoint] = []
    for match in decorator.finditer(content):
        router_name = match.group("router")
        if router_name not in router_prefixes:
            continue
        tail = content[match.end() : match.end() + 400]
        symbol_match = re.search(r"(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(", tail)
        endpoints.append(
            _make_endpoint(
                role="provider",
                method=match.group("method"),
                route=_join_routes(router_prefixes[router_name], match.group("route")),
                path=path,
                line=_line_number(content, match.start()),
                framework="fastapi",
                symbol_name=symbol_match.group(1) if symbol_match else None,
            )
        )
    return endpoints


def _extract_call_consumers(path: str, content: str) -> list[HttpEndpoint]:
    call_pattern = re.compile(r"\b(?P<client>request(?:<[^>]+>)?|fetch)\s*\(")
    endpoints: list[HttpEndpoint] = []
    for match in call_pattern.finditer(content):
        body, _ = _call_body(content, match.end() - 1)
        route = _quoted_argument(_first_argument(body))
        if not route or not _has_static_path(route):
            continue
        method_match = re.search(r"\bmethod\s*:\s*['\"]([A-Za-z]+)['\"]", body)
        method = method_match.group(1) if method_match else "GET"
        endpoints.append(
            _make_endpoint(
                role="consumer",
                method=method,
                route=route,
                path=path,
                line=_line_number(content, match.start()),
                framework="request" if match.group("client").startswith("request") else "fetch",
            )
        )
    return endpoints


def _extract_axios_consumers(path: str, content: str) -> list[HttpEndpoint]:
    call_pattern = re.compile(
        rf"\b(?P<client>axios|client)\.(?P<method>{HTTP_METHODS})\s*\(",
        re.IGNORECASE,
    )
    endpoints: list[HttpEndpoint] = []
    for match in call_pattern.finditer(content):
        body, _ = _call_body(content, match.end() - 1)
        route = _quoted_argument(_first_argument(body))
        if not route or not _has_static_path(route):
            continue
        endpoints.append(
            _make_endpoint(
                role="consumer",
                method=match.group("method"),
                route=route,
                path=path,
                line=_line_number(content, match.start()),
                framework="axios",
            )
        )
    return endpoints


def _attach_symbols(endpoints: list[HttpEndpoint], graph: Graph | None) -> None:
    if graph is None:
        return
    by_path: dict[str, list] = {}
    for symbol in graph.nodes.values():
        if symbol.kind != "file":
            by_path.setdefault(symbol.path, []).append(symbol)

    for endpoint in endpoints:
        candidates = by_path.get(endpoint.path, [])
        containing = [symbol for symbol in candidates if symbol.line <= endpoint.line <= symbol.end_line]
        if containing:
            symbol = min(containing, key=lambda item: item.end_line - item.line)
        elif endpoint.role == "provider":
            following = [symbol for symbol in candidates if endpoint.line <= symbol.line <= endpoint.line + 8]
            symbol = min(following, key=lambda item: item.line) if following else None
        else:
            symbol = None
        if symbol is not None:
            endpoint.symbol_id = symbol.id
            endpoint.symbol_name = endpoint.symbol_name or symbol.name


def extract_http_endpoints(files: list[dict], graph: Graph | None = None) -> list[HttpEndpoint]:
    endpoints: list[HttpEndpoint] = []
    for file in files:
        path = file["path"]
        content = file["content"]
        if path.endswith((".ts", ".tsx", ".js", ".jsx")):
            endpoints.extend(_extract_nest(path, content))
            endpoints.extend(_extract_call_consumers(path, content))
            endpoints.extend(_extract_axios_consumers(path, content))
        elif path.endswith(".py"):
            endpoints.extend(_extract_fastapi(path, content))
            endpoints.extend(_extract_call_consumers(path, content))

    _attach_symbols(endpoints, graph)
    return endpoints
