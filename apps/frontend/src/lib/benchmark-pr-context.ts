export interface BenchmarkChangedFile {
  path: string;
  diff: string;
}

export function cleanPullRequestBody(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<picture\b[\s\S]*?<\/picture>/gi, '')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function normalizeBenchmarkChangedFiles(
  value: Array<Record<string, unknown>>,
): BenchmarkChangedFile[] {
  return value.flatMap((item) => {
    if (typeof item.path !== 'string' || !item.path.trim()) return [];
    return [{
      path: item.path,
      diff: typeof item.diff === 'string' ? item.diff : '',
    }];
  });
}
