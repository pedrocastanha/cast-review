from app.architecture.dependencies import build_dependencies
from app.architecture.models import ArchitectureRepositoryRef, ComponentRef
from app.code_graph.graph import build_graph
from app.code_graph.http_endpoints import extract_http_endpoints
from app.code_graph.indexer import parse_file


def _graph(files):
    parsed = [parse_file(path, content) for path, content in files]
    graph = build_graph(parsed)
    graph.endpoints = extract_http_endpoints(
        [{"path": path, "content": content} for path, content in files],
        graph,
    )
    return graph


def _component(component_id, repo_id, prefix):
    return ComponentRef(componentId=component_id, repoId=repo_id, pathPrefix=prefix)


def test_symbol_edges_between_components_become_one_dependency_with_evidence():
    graph = _graph(
        [
            ("src/auth/login.ts", "import { charge } from '../billing/charge';\nexport function login() { return charge(); }\n"),
            ("src/billing/charge.ts", "export function charge() { return 1; }\n"),
        ]
    )
    response = build_dependencies(
        [ArchitectureRepositoryRef(repoId="acme/api", sha="sha1")],
        [_component("auth", "acme/api", "src/auth"), _component("billing", "acme/api", "src/billing")],
        {"acme/api": graph},
    )

    assert response.dependencies
    dependency = response.dependencies[0]
    assert dependency.fromComponentId == "auth"
    assert dependency.toComponentId == "billing"
    assert dependency.confidence == "confirmed"
    assert dependency.evidence[0].fromPath == "src/auth/login.ts"
    assert dependency.evidence[0].toPath == "src/billing/charge.ts"


def test_edges_inside_the_same_component_are_not_dependencies():
    graph = _graph(
        [
            ("src/auth/login.ts", "import { session } from './session';\nexport function login() { return session(); }\n"),
            ("src/auth/session.ts", "export function session() { return 1; }\n"),
        ]
    )
    response = build_dependencies(
        [ArchitectureRepositoryRef(repoId="acme/api", sha="sha1")],
        [_component("auth", "acme/api", "src/auth")],
        {"acme/api": graph},
    )

    assert response.dependencies == []


def test_unmapped_paths_never_produce_a_dependency():
    graph = _graph(
        [
            ("src/auth/login.ts", "import { charge } from '../billing/charge';\nexport function login() { return charge(); }\n"),
            ("src/billing/charge.ts", "export function charge() { return 1; }\n"),
        ]
    )
    response = build_dependencies(
        [ArchitectureRepositoryRef(repoId="acme/api", sha="sha1")],
        [_component("auth", "acme/api", "src/auth")],
        {"acme/api": graph},
    )

    assert response.dependencies == []


def test_cross_repository_http_calls_become_a_dependency_between_components():
    consumer = _graph(
        [
            (
                "src/checkout/client.ts",
                "export async function pay() { return fetch('/payments/charge', { method: 'POST' }); }\n",
            )
        ]
    )
    provider = _graph(
        [
            (
                "src/payments/controller.ts",
                "import { Controller, Post } from '@nestjs/common';\n"
                "@Controller('payments')\n"
                "export class PaymentsController {\n"
                "  @Post('charge')\n"
                "  charge() { return 1; }\n"
                "}\n",
            )
        ]
    )

    response = build_dependencies(
        [
            ArchitectureRepositoryRef(repoId="acme/web", sha="sha-web"),
            ArchitectureRepositoryRef(repoId="acme/api", sha="sha-api"),
        ],
        [
            _component("checkout", "acme/web", "src/checkout"),
            _component("payments", "acme/api", "src/payments"),
        ],
        {"acme/web": consumer, "acme/api": provider},
    )

    http = [dependency for dependency in response.dependencies if dependency.kind == "http"]
    assert len(http) == 1
    assert http[0].fromComponentId == "checkout"
    assert http[0].toComponentId == "payments"
    assert http[0].evidence[0].method == "POST"


def test_repository_without_index_is_reported_as_omitted():
    response = build_dependencies(
        [ArchitectureRepositoryRef(repoId="acme/api", sha=None)],
        [_component("auth", "acme/api", "src/auth")],
        {"acme/api": None},
    )

    assert response.dependencies == []
    assert response.stats.omittedRepositories == ["acme/api"]
