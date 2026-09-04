from app.architecture.impact import build_impact
from app.architecture.models import ArchitectureRepositoryRef, ChangedFileRef, ComponentRef
from app.code_graph.graph import build_graph
from app.code_graph.indexer import parse_file


def _graph(files):
    return build_graph([parse_file(path, content) for path, content in files])


def _component(component_id, prefix, repo_id="acme/api"):
    return ComponentRef(componentId=component_id, repoId=repo_id, pathPrefix=prefix)


FILES = [
    ("src/auth/login.ts", "import { charge } from '../billing/charge';\nexport function login() { return charge(); }\n"),
    ("src/billing/charge.ts", "export function charge() { return 1; }\n"),
]


def test_changed_file_maps_to_its_component_with_symbol_evidence():
    response = build_impact(
        [ArchitectureRepositoryRef(repoId="acme/api", sha="sha1")],
        [_component("auth", "src/auth"), _component("billing", "src/billing")],
        [ChangedFileRef(repoId="acme/api", path="src/auth/login.ts")],
        {"acme/api": _graph(FILES)},
    )

    assert [item.componentId for item in response.touched] == ["auth"]
    assert response.touched[0].changedFiles == ["src/auth/login.ts"]
    assert any(symbol.symbolName == "login" for symbol in response.touched[0].changedSymbols)


def test_components_reached_through_dependencies_are_separated_from_touched():
    response = build_impact(
        [ArchitectureRepositoryRef(repoId="acme/api", sha="sha1")],
        [_component("auth", "src/auth"), _component("billing", "src/billing")],
        [ChangedFileRef(repoId="acme/api", path="src/auth/login.ts")],
        {"acme/api": _graph(FILES)},
    )

    assert [item.componentId for item in response.reached] == ["billing"]
    assert response.reached[0].direction == "provides"
    assert response.reached[0].viaComponentId == "auth"


def test_unmapped_changed_file_lowers_coverage_without_failing():
    response = build_impact(
        [ArchitectureRepositoryRef(repoId="acme/api", sha="sha1")],
        [_component("auth", "src/auth")],
        [
            ChangedFileRef(repoId="acme/api", path="src/auth/login.ts"),
            ChangedFileRef(repoId="acme/api", path="src/billing/charge.ts"),
        ],
        {"acme/api": _graph(FILES)},
    )

    assert response.stats.changedFiles == 2
    assert response.stats.mappedFiles == 1
    assert response.stats.coverage == 0.5
    assert [item.path for item in response.unmapped] == ["src/billing/charge.ts"]


def test_repository_without_index_is_reported_as_stale_and_yields_no_impact():
    response = build_impact(
        [ArchitectureRepositoryRef(repoId="acme/api", sha=None)],
        [_component("auth", "src/auth")],
        [ChangedFileRef(repoId="acme/api", path="src/auth/login.ts")],
        {"acme/api": None},
    )

    assert response.stats.staleRepositories == ["acme/api"]
    assert response.touched[0].changedSymbols == []
    assert response.reached == []


def test_impact_without_changed_files_reports_zero_coverage():
    response = build_impact(
        [ArchitectureRepositoryRef(repoId="acme/api", sha="sha1")],
        [_component("auth", "src/auth")],
        [],
        {"acme/api": _graph(FILES)},
    )

    assert response.stats.coverage == 0.0
    assert response.touched == []
