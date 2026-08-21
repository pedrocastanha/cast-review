import type { Octokit } from '@octokit/rest';

export interface RepoFile {
  path: string;
  content: string;
}

export interface RepoTreeResult {
  files: RepoFile[];
  truncated: boolean;
}

const SUPPORTED_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.py'];

const ALIAS_CONFIG_FILENAMES = ['tsconfig.json', 'pyproject.toml', 'setup.cfg'];

const BLOB_FETCH_CONCURRENCY = 10;

function isWanted(path: string): boolean {
  const basename = path.split('/').pop() ?? path;
  return (
    SUPPORTED_EXTENSIONS.some((ext) => path.endsWith(ext)) ||
    ALIAS_CONFIG_FILENAMES.includes(basename)
  );
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++;
      results[currentIndex] = await fn(items[currentIndex]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );

  return results;
}

export async function fetchRepoTree(
  octokit: Octokit,
  owner: string,
  repo: string,
  sha: string,
): Promise<RepoTreeResult> {
  const { data: tree } = await octokit.git.getTree({
    owner,
    repo,
    tree_sha: sha,
    recursive: 'true',
  });

  const blobEntries = tree.tree.filter(
    (entry): entry is typeof entry & { path: string; sha: string } =>
      entry.type === 'blob' &&
      typeof entry.path === 'string' &&
      typeof entry.sha === 'string' &&
      isWanted(entry.path),
  );

  const files = await mapWithConcurrency(
    blobEntries,
    BLOB_FETCH_CONCURRENCY,
    async (entry): Promise<RepoFile> => {
      const { data: blob } = await octokit.git.getBlob({
        owner,
        repo,
        file_sha: entry.sha,
      });

      return {
        path: entry.path,
        content: Buffer.from(
          blob.content,
          blob.encoding as BufferEncoding,
        ).toString('utf-8'),
      };
    },
  );

  return { files, truncated: tree.truncated };
}
