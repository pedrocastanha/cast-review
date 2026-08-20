from app.code_graph.indexer import index_files


def test_index_files_skips_unsupported_extension_without_aborting():
    files = [
        {"path": "src/a.ts", "content": "function a() {}\n"},
        {"path": "src/weird.rs", "content": "fn main() {}\n"},
        {"path": "src/b.py", "content": "def b(): pass\n"},
    ]
    parsed, skipped = index_files(files)
    assert skipped == 1
    assert {p.path for p in parsed} == {"src/a.ts", "src/b.py"}


def test_index_files_all_valid_zero_skipped():
    files = [{"path": "src/a.ts", "content": "function a() {}\n"}]
    parsed, skipped = index_files(files)
    assert skipped == 0
    assert len(parsed) == 1


def test_index_files_malformed_content_does_not_crash_orchestration():
    files = [
        {"path": "src/a.ts", "content": "function a() {}\n"},
        {"path": "src/broken.ts", "content": None},
    ]
    parsed, skipped = index_files(files)
    assert skipped == 1
    assert len(parsed) == 1
