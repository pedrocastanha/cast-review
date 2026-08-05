import { Injectable, Logger } from '@nestjs/common';
import { GithubService } from '../github/github.service';
import type { ChangedFileContext, RelatedFile } from '../../shared/types';

const DEFAULT_RELATED_LIMIT = 5;
const RELATIVE_IMPORT_RE =
  /(?:import\s+(?:[\s\S]*?\s+from\s+)?|require\s*\(\s*)['"](\.\.?\/[^'"]+)['"]/g;

@Injectable()
export class ContextBuilderService {
  private readonly logger = new Logger(ContextBuilderService.name);

  constructor(private readonly github: GithubService) {}

  async buildForPullRequest(params: {
    token: string;
    owner: string;
    repo: string;
    pullNumber: number;
    relatedLimit?: number;
  }): Promise<{
    diff: string;
    conventions: string;
    changedFiles: ChangedFileContext[];
  }> {
    const {
      token,
      owner,
      repo,
      pullNumber,
      relatedLimit = DEFAULT_RELATED_LIMIT,
    } = params;

    const [pr, files, diff] = await Promise.all([
      this.github.getPullRequest(token, owner, repo, pullNumber),
      this.github.getPullRequestFiles(token, owner, repo, pullNumber),
      this.github.getPullRequestDiff(token, owner, repo, pullNumber),
    ]);

    const ref = pr.headSha;
    const conventions = await this.github.getConventions(
      token,
      owner,
      repo,
      ref,
    );

    const changedFiles: ChangedFileContext[] = [];

    for (const file of files) {
      if (file.status === 'removed') {
        changedFiles.push({
          path: file.filename,
          diff: file.patch || '',
          fullContent: '/* file removed in this PR */',
          relatedFiles: [],
        });
        continue;
      }

      const fullContent = await this.github.getFileContent(
        token,
        owner,
        repo,
        file.filename,
        ref,
      );

      const relatedFiles = await this.resolveRelatedFiles({
        token,
        owner,
        repo,
        ref,
        fromPath: file.filename,
        source: fullContent,
        limit: relatedLimit,
      });

      changedFiles.push({
        path: file.filename,
        diff: file.patch || '',
        fullContent,
        relatedFiles,
      });
    }

    this.logger.log(
      `Context built for ${owner}/${repo}#${pullNumber}: ${changedFiles.length} files`,
    );

    return { diff, conventions, changedFiles };
  }

  private async resolveRelatedFiles(params: {
    token: string;
    owner: string;
    repo: string;
    ref: string;
    fromPath: string;
    source: string;
    limit: number;
  }): Promise<RelatedFile[]> {
    const { token, owner, repo, ref, fromPath, source, limit } = params;
    const importPaths = this.extractRelativeImports(source);
    const related: RelatedFile[] = [];
    const seen = new Set<string>();

    for (const relImport of importPaths) {
      if (related.length >= limit) break;

      const candidates = this.expandPathCandidates(fromPath, relImport);
      for (const candidate of candidates) {
        if (seen.has(candidate)) continue;
        seen.add(candidate);

        const content = await this.github.getFileContent(
          token,
          owner,
          repo,
          candidate,
          ref,
        );
        if (content.startsWith('/* file not found')) {
          continue;
        }
        related.push({ path: candidate, content });
        break; // achou uma extensão válida; próxima importação
      }
    }

    return related;
  }

  extractRelativeImports(source: string): string[] {
    if (!source) return [];
    const found: string[] = [];
    const seen = new Set<string>();
    // Reset lastIndex — regex global é stateful.
    RELATIVE_IMPORT_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = RELATIVE_IMPORT_RE.exec(source)) !== null) {
      const spec = match[1];
      if (!seen.has(spec)) {
        seen.add(spec);
        found.push(spec);
      }
    }
    return found;
  }

  expandPathCandidates(fromPath: string, relativeImport: string): string[] {
    const fromDir = fromPath.includes('/')
      ? fromPath.slice(0, fromPath.lastIndexOf('/'))
      : '';

    const joined = this.posixJoin(fromDir, relativeImport);
    const normalized = this.posixNormalize(joined);

    if (/\.(ts|tsx|js|jsx|mjs|cjs|json)$/.test(normalized)) {
      return [normalized];
    }

    const exts = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'];
    const candidates = [
      ...exts.map((e) => normalized + e),
      ...exts.map((e) => `${normalized}/index${e}`),
    ];
    return candidates;
  }

  private posixJoin(a: string, b: string): string {
    if (!a) return b;
    if (!b) return a;
    return `${a.replace(/\/$/, '')}/${b.replace(/^\//, '')}`;
  }

  private posixNormalize(p: string): string {
    const parts = p.split('/');
    const stack: string[] = [];
    for (const part of parts) {
      if (!part || part === '.') continue;
      if (part === '..') {
        stack.pop();
        continue;
      }
      stack.push(part);
    }
    return stack.join('/');
  }
}
