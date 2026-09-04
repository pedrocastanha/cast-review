from app.architecture.candidates import build_candidates, select_prefixes
from app.architecture.models import ArchitectureRepositoryRef
from app.code_graph.graph import build_graph
from app.code_graph.indexer import parse_file


def _graph(files):
    return build_graph([parse_file(path, content) for path, content in files])


def _repo(repo_id="acme/api", sha="sha1"):
    return ArchitectureRepositoryRef(repoId=repo_id, sha=sha)


def test_select_prefixes_keeps_top_level_directories_when_repo_is_small():
    graph = _graph(
        [
            ("src/auth/login.ts", "export function login() { return 1; }\n"),
            ("docs/readme.ts", "export function readme() { return 1; }\n"),
        ]
    )
    assert select_prefixes(graph) == ["docs", "src"]


def test_select_prefixes_splits_the_largest_directory_first():
    files = [(f"src/auth/f{i}.ts", f"export function f{i}() {{ return {i}; }}\n") for i in range(6)]
    files += [(f"src/billing/g{i}.ts", f"export function g{i}() {{ return {i}; }}\n") for i in range(6)]
    files += [("tools/one.ts", "export function one() { return 1; }\n")]

    prefixes = select_prefixes(_graph(files))

    assert "src/auth" in prefixes
    assert "src/billing" in prefixes
    assert "src" not in prefixes
    assert "tools" in prefixes


def test_build_candidates_assigns_each_symbol_to_the_longest_prefix():
    files = [(f"src/auth/f{i}.ts", f"export function f{i}() {{ return {i}; }}\n") for i in range(6)]
    files += [(f"src/billing/g{i}.ts", f"export function g{i}() {{ return {i}; }}\n") for i in range(6)]
    files += [("src/root.ts", "export function root() { return 1; }\n")]

    response = build_candidates([_repo()], {"acme/api": _graph(files)})
    by_prefix = {candidate.pathPrefix: candidate for candidate in response.candidates}

    assert by_prefix["src"].fileCount == 1
    assert by_prefix["src/auth"].fileCount == 6
    assert by_prefix["src/billing"].fileCount == 6
    assert response.stats.candidates == len(response.candidates)


def test_build_candidates_counts_cross_component_edges_as_inbound_and_outbound():
    files = [
        ("src/auth/login.ts", "import { charge } from '../billing/charge';\nexport function login() { return charge(); }\n"),
        ("src/billing/charge.ts", "export function charge() { return 1; }\n"),
    ]
    for i in range(6):
        files.append((f"src/auth/extra{i}.ts", f"export function extra{i}() {{ return {i}; }}\n"))
        files.append((f"src/billing/other{i}.ts", f"export function other{i}() {{ return {i}; }}\n"))

    response = build_candidates([_repo()], {"acme/api": _graph(files)})
    by_prefix = {candidate.pathPrefix: candidate for candidate in response.candidates}

    assert by_prefix["src/auth"].outboundEdges > 0
    assert by_prefix["src/billing"].inboundEdges > 0


def test_build_candidates_reports_repository_without_index_as_omitted():
    response = build_candidates([_repo(), _repo("acme/web", None)], {"acme/api": _graph([("a.ts", "export function a() { return 1; }\n")]), "acme/web": None})

    assert response.stats.repositories == 2
    assert response.stats.indexedRepositories == 1
    assert response.stats.omittedRepositories == ["acme/web"]


def test_build_candidates_treats_root_level_files_as_a_repository_component():
    response = build_candidates([_repo()], {"acme/api": _graph([("a.ts", "export function a() { return 1; }\n")])})

    assert [candidate.kind for candidate in response.candidates] == ["repository"]
    assert response.candidates[0].label == "api"


def test_build_candidates_exposes_navigable_evidence_for_every_candidate():
    response = build_candidates([_repo()], {"acme/api": _graph([("src/a.ts", "export function a() { return 1; }\n")])})

    evidence = response.candidates[0].evidence
    assert evidence
    assert all(item.path and item.repoId == "acme/api" and item.sha == "sha1" for item in evidence)
