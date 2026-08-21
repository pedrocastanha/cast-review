import type {
  AgentRunRequest,
  ChangedFileContext,
  RelatedFile,
} from 'src/shared/types';
import type { CurrentUserData } from '../../auth/utils/current-user-decorator';
import type { RepositoriesService } from '../../repositories/repositories.service';
import type { RunAnalysisDto } from '../dtos/run-analysis.dto';
import { candidatePathsFor, extractRelativeImportPaths } from './import-resolver.helper';

const MAX_RELATED_FILES_PER_CHANGE = 3;
const MAX_RELATED_FILE_CHARS = 4000;

export async function buildAgentRunRequest(
  repositoriesService: RepositoriesService,
  repo: string,
  pullNumber: number,
  currentUser: CurrentUserData,
  dto: RunAnalysisDto,
  analysisId: string,
  owner?: string,
): Promise<AgentRunRequest> {
  const pull = await repositoriesService.getPullByNumber(repo, pullNumber, currentUser, owner);

  const [diff, files, conventions, resolvedOwner] = await Promise.all([
    repositoriesService.getPullDiff(repo, pullNumber, currentUser, owner),
    repositoriesService.listPullFiles(repo, pullNumber, currentUser, owner),
    repositoriesService.getConventions(repo, pull.headRef, currentUser, owner),
    owner?.trim() || repositoriesService.loginFor(currentUser),
  ]);

  const changedFiles = await Promise.all(
    files.map((file) =>
      buildChangedFile(repositoriesService, repo, file, pull.headRef, currentUser, owner),
    ),
  );

  return {
    analysisId,
    diff,
    changedFiles,
    conventions,
    models: dto.models,
    apiKeys: dto.apiKeys,
    policies: {
      prd: dto.policies?.prd ?? 'manual',
      spec: dto.policies?.spec ?? 'manual',
    },
    repoId: `${resolvedOwner}/${repo}`,
    sha: pull.headSha,
  };
}

async function buildChangedFile(
  repositoriesService: RepositoriesService,
  repo: string,
  file: { filename: string; patch?: string },
  ref: string,
  currentUser: CurrentUserData,
  owner?: string,
): Promise<ChangedFileContext> {
  const fullContent =
    (await repositoriesService.getFileContent(repo, file.filename, ref, currentUser, owner)) ?? '';

  const relatedFiles = await resolveRelatedFiles(
    repositoriesService,
    repo,
    file.filename,
    fullContent,
    ref,
    currentUser,
    owner,
  );

  return {
    path: file.filename,
    diff: file.patch ?? '',
    fullContent,
    relatedFiles,
  };
}

async function resolveRelatedFiles(
  repositoriesService: RepositoriesService,
  repo: string,
  changedFilePath: string,
  content: string,
  ref: string,
  currentUser: CurrentUserData,
  owner?: string,
): Promise<RelatedFile[]> {
  const candidatePaths = extractRelativeImportPaths(changedFilePath, content).slice(
    0,
    MAX_RELATED_FILES_PER_CHANGE,
  );

  const resolved = await Promise.all(
    candidatePaths.map((path) =>
      fetchWithExtensionFallback(repositoriesService, repo, path, ref, currentUser, owner),
    ),
  );

  return resolved.filter((file): file is RelatedFile => file !== null);
}

async function fetchWithExtensionFallback(
  repositoriesService: RepositoriesService,
  repo: string,
  path: string,
  ref: string,
  currentUser: CurrentUserData,
  owner?: string,
): Promise<RelatedFile | null> {
  for (const candidate of candidatePathsFor(path)) {
    const content = await repositoriesService.getFileContent(repo, candidate, ref, currentUser, owner);

    if (content) {
      return { path: candidate, content: content.slice(0, MAX_RELATED_FILE_CHARS) };
    }
  }

  return null;
}
