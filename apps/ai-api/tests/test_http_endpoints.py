from app.code_graph.http_endpoints import extract_http_endpoints, normalize_route


def test_normalize_route_unifies_framework_and_template_parameters():
    assert normalize_route("users/:id/") == "/users/{param}"
    assert normalize_route("/users/{user_id}?expand=true") == "/users/{param}"
    assert normalize_route("/users/${encodeURIComponent(userId)}/analyses") == "/users/{param}/analyses"


def test_extracts_nest_provider_with_controller_prefix_and_symbol_name():
    endpoints = extract_http_endpoints(
        [
            {
                "path": "src/repositories.controller.ts",
                "content": """
@Controller('repositories')
export class RepositoriesController {
  @Get(':repo/graph')
  async getGraph() { return {}; }

  @Post(':repo/index')
  async indexRepository() { return {}; }
}
""",
            }
        ]
    )

    assert [(endpoint.method, endpoint.normalized_route, endpoint.symbol_name) for endpoint in endpoints] == [
        ("GET", "/repositories/{param}/graph", "getGraph"),
        ("POST", "/repositories/{param}/index", "indexRepository"),
    ]
    assert all(endpoint.role == "provider" for endpoint in endpoints)
    assert all(endpoint.framework == "nestjs" for endpoint in endpoints)


def test_extracts_fastapi_providers():
    endpoints = extract_http_endpoints(
        [
            {
                "path": "app/api/routes/index.py",
                "content": """
@router.post('/index/build')
async def build_index():
    pass

@app.get('/health')
async def health():
    pass
""",
            }
        ]
    )

    assert [(endpoint.method, endpoint.normalized_route, endpoint.symbol_name) for endpoint in endpoints] == [
        ("POST", "/index/build", "build_index"),
        ("GET", "/health", "health"),
    ]
    assert all(endpoint.role == "provider" for endpoint in endpoints)
    assert all(endpoint.framework == "fastapi" for endpoint in endpoints)


def test_scopes_nest_routes_to_each_controller_in_the_same_file():
    endpoints = extract_http_endpoints(
        [
            {
                "path": "src/controllers.ts",
                "content": """
@Controller('users')
class UsersController {
  @Get(':id')
  findUser() {}
}

@Controller('teams')
class TeamsController {
  @Post(':id/members')
  addMember() {}
}
""",
            }
        ]
    )

    assert [(endpoint.method, endpoint.normalized_route) for endpoint in endpoints] == [
        ("GET", "/users/{param}"),
        ("POST", "/teams/{param}/members"),
    ]


def test_applies_fastapi_router_prefix_to_provider_routes():
    endpoints = extract_http_endpoints(
        [
            {
                "path": "app/api/users.py",
                "content": """
users_router = APIRouter(prefix='/v1/users')

@users_router.get('/{user_id}')
async def get_user(user_id: str):
    pass
""",
            }
        ]
    )

    assert [(endpoint.method, endpoint.normalized_route) for endpoint in endpoints] == [
        ("GET", "/v1/users/{param}"),
    ]


def test_extracts_request_consumers_with_default_and_explicit_methods():
    endpoints = extract_http_endpoints(
        [
            {
                "path": "src/api/repositories.api.ts",
                "content": """
export const api = {
  graph: (repo: string) => request<VizGraph>(
    `/repositories/${encodeURIComponent(repo)}/graph?owner=cast`,
  ),
  index: (repo: string) => request(
    `/repositories/${repo}/index`,
    { method: 'POST' },
  ),
};
""",
            }
        ]
    )

    assert [(endpoint.method, endpoint.normalized_route) for endpoint in endpoints] == [
        ("GET", "/repositories/{param}/graph"),
        ("POST", "/repositories/{param}/index"),
    ]
    assert all(endpoint.role == "consumer" for endpoint in endpoints)


def test_extracts_fetch_and_axios_consumers_but_skips_fully_dynamic_wrapper():
    endpoints = extract_http_endpoints(
        [
            {
                "path": "src/client.ts",
                "content": """
fetch(`${resolveAiApiUrl()}/index/build`, { method: 'POST' });
fetch(`${BASE_URL}${path}`, { method });
axios.get('/health');
client.patch(`/users/${userId}`);
""",
            }
        ]
    )

    assert [(endpoint.method, endpoint.normalized_route) for endpoint in endpoints] == [
        ("POST", "/index/build"),
        ("GET", "/health"),
        ("PATCH", "/users/{param}"),
    ]


def test_deduplicates_same_evidence_without_merging_different_files():
    files = [
        {"path": "src/a.ts", "content": "request('/health');\nrequest('/health');"},
        {"path": "src/b.ts", "content": "request('/health');"},
    ]

    endpoints = extract_http_endpoints(files)

    assert len(endpoints) == 3
    assert {endpoint.path for endpoint in endpoints} == {"src/a.ts", "src/b.ts"}
