import pytest

from app.code_graph.indexer import (
    UnsupportedLanguageError,
    language_for_path,
    load_tsconfig_paths,
    parse_file,
    resolve_import,
)


def test_language_for_path_supported():
    assert language_for_path("a/b.ts") == "typescript"
    assert language_for_path("a/b.tsx") == "tsx"
    assert language_for_path("a/b.js") == "javascript"
    assert language_for_path("a/b.py") == "python"


def test_language_for_path_unsupported():
    with pytest.raises(UnsupportedLanguageError):
        language_for_path("a/b.rs")


def test_parse_file_ts_extracts_function_and_call():
    content = """
function foo(a) {
  return bar(a);
}
function bar(x) {
  return x + 1;
}
"""
    parsed = parse_file("src/foo.ts", content)
    names = {s.name for s in parsed.symbols}
    assert names == {"foo", "bar"}

    foo = next(s for s in parsed.symbols if s.name == "foo")
    bar = next(s for s in parsed.symbols if s.name == "bar")
    assert foo.kind == "function"
    assert "function foo(a)" in foo.signature
    assert "{" not in foo.signature

    call = next(c for c in parsed.calls if c.callee_name == "bar")
    assert call.caller_symbol_id == foo.id
    assert call.caller_symbol_id != bar.id


def test_parse_file_ts_extracts_class_and_method():
    content = """
class Baz {
  method1(x) {
    return x;
  }
}
"""
    parsed = parse_file("src/baz.ts", content)
    kinds = {s.name: s.kind for s in parsed.symbols}
    assert kinds == {"Baz": "class", "method1": "method"}


def test_parse_file_ts_extracts_import_source():
    content = "import { qux } from './qux';\n"
    parsed = parse_file("src/foo.ts", content)
    assert parsed.imports == ["./qux"]


def test_parse_file_js_extracts_class_without_type_identifier():
    content = "class Baz {\n  method1(x) { return x; }\n}\n"
    parsed = parse_file("src/baz.js", content)
    names = {s.name for s in parsed.symbols}
    assert "Baz" in names


def test_parse_file_python_extracts_function_and_method_and_call():
    content = """
class Baz:
    def method1(self, x):
        return foo(x)

def foo(x):
    return x + 1
"""
    parsed = parse_file("src/baz.py", content)
    kinds = {s.name: s.kind for s in parsed.symbols}
    assert kinds["method1"] == "method"
    assert kinds["foo"] == "function"

    method1 = next(s for s in parsed.symbols if s.name == "method1")
    call = next(c for c in parsed.calls if c.callee_name == "foo")
    assert call.caller_symbol_id == method1.id


def test_parse_file_python_extracts_imports():
    content = "import os\nfrom foo.bar import baz\nfrom . import qux\n"
    parsed = parse_file("src/mod.py", content)
    assert len(parsed.imports) == 3


def test_parse_file_unparseable_language_raises():
    with pytest.raises(UnsupportedLanguageError):
        parse_file("src/foo.rs", "fn main() {}")


def test_resolve_import_relative_ts_with_extension_guess():
    known = {"src/foo.ts", "src/qux.ts"}
    resolved = resolve_import("./qux", "src/foo.ts", known)
    assert resolved == "src/qux.ts"


def test_resolve_import_relative_ts_index_file():
    known = {"src/foo.ts", "src/qux/index.ts"}
    resolved = resolve_import("./qux", "src/foo.ts", known)
    assert resolved == "src/qux/index.ts"


def test_resolve_import_relative_parent_dir():
    known = {"src/nested/foo.ts", "src/qux.ts"}
    resolved = resolve_import("../qux", "src/nested/foo.ts", known)
    assert resolved == "src/qux.ts"


def test_resolve_import_tsconfig_alias():
    known = {"src/app/bar.ts", "src/index.ts"}
    tsconfig_paths = {"@app/*": ["src/app/*"]}
    resolved = resolve_import("@app/bar", "src/index.ts", known, tsconfig_paths)
    assert resolved == "src/app/bar.ts"


def test_resolve_import_bare_specifier_unresolvable_returns_none():
    known = {"src/foo.ts"}
    resolved = resolve_import("react", "src/foo.ts", known)
    assert resolved is None


def test_resolve_import_python_relative_same_package():
    known = {"pkg/foo.py", "pkg/qux.py"}
    resolved = resolve_import("from . import qux", "pkg/foo.py", known)
    assert resolved == "pkg/qux.py"


def test_resolve_import_python_dotted_module():
    known = {"pkg/sub/mod.py", "pkg/entry.py"}
    resolved = resolve_import("from pkg.sub import mod", "pkg/entry.py", known)
    assert resolved == "pkg/sub/mod.py"


def test_load_tsconfig_paths_valid():
    content = '{"compilerOptions": {"paths": {"@app/*": ["src/app/*"]}}}'
    assert load_tsconfig_paths(content) == {"@app/*": ["src/app/*"]}


def test_load_tsconfig_paths_tolerates_trailing_comma_and_comments():
    content = """{
      // comment
      "compilerOptions": {
        "paths": {
          "@app/*": ["src/app/*"],
        },
      },
    }"""
    assert load_tsconfig_paths(content) == {"@app/*": ["src/app/*"]}


def test_load_tsconfig_paths_invalid_returns_empty():
    assert load_tsconfig_paths("not json at all {{{") == {}


def test_parse_file_ts_captures_class_and_method_decorators():
    content = """
@Controller('users')
export class UsersController {
  @Get()
  list() {}
}
"""
    parsed = parse_file("src/users.controller.ts", content)
    controller = next(s for s in parsed.symbols if s.name == "UsersController")
    list_method = next(s for s in parsed.symbols if s.name == "list")
    assert any("Controller" in d for d in controller.decorators)
    assert any("Get" in d for d in list_method.decorators)


def test_parse_file_python_captures_decorator():
    content = """
@app.route('/users')
def list_users():
    pass

def helper():
    pass
"""
    parsed = parse_file("src/routes.py", content)
    route = next(s for s in parsed.symbols if s.name == "list_users")
    helper = next(s for s in parsed.symbols if s.name == "helper")
    assert any("route" in d for d in route.decorators)
    assert helper.decorators == []


def test_parse_file_ts_decorator_does_not_leak_to_undecorated_sibling():
    content = """
export class UsersController {
  @Get()
  list() {}
  other() {}
}
"""
    parsed = parse_file("src/users.controller.ts", content)
    list_method = next(s for s in parsed.symbols if s.name == "list")
    other_method = next(s for s in parsed.symbols if s.name == "other")
    assert any("Get" in d for d in list_method.decorators)
    assert other_method.decorators == []
