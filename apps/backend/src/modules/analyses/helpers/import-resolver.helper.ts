const EXTENSION_FALLBACKS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '/index.ts',
  '/index.js',
];
const KNOWN_FILE_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.json',
];
const RELATIVE_IMPORT_PATTERN =
  /(?:import[^'"]*from|require\()\s*['"](\.\.?\/[^'"]+)['"]/g;

export function extractRelativeImportPaths(
  changedFilePath: string,
  content: string,
): string[] {
  const baseDir = changedFilePath.split('/').slice(0, -1).join('/');
  const matches = [...content.matchAll(RELATIVE_IMPORT_PATTERN)].map(
    (match) => match[1],
  );
  const resolved = matches.map((importPath) =>
    resolvePath(baseDir, importPath),
  );

  return Array.from(new Set(resolved));
}

export function candidatePathsFor(path: string): string[] {
  if (hasKnownFileExtension(path)) {
    return [path];
  }
  return EXTENSION_FALLBACKS.map((ext) => `${path}${ext}`);
}

function hasKnownFileExtension(path: string): boolean {
  return KNOWN_FILE_EXTENSIONS.some((ext) => path.endsWith(ext));
}

function resolvePath(baseDir: string, importPath: string): string {
  const segments = [...baseDir.split('/'), ...importPath.split('/')];
  const resolved: string[] = [];

  for (const segment of segments) {
    if (segment === '.' || segment === '') continue;
    if (segment === '..') resolved.pop();
    else resolved.push(segment);
  }

  return resolved.join('/');
}
