import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AiApiClient } from 'src/shared/clients/ai/ai-api.client';
import { DataSource } from 'typeorm';
import type { CurrentUserData } from '../auth/utils/current-user-decorator';
import type { RepositoriesService } from '../repositories/repositories.service';
import type { CreateProjectDto } from './dtos/create-project.dto';
import type { UpdateProjectDto } from './dtos/update-project.dto';
import { ProjectRepositoryMemberRepository } from './project-repository-member.repository';
import { ProjectRepository } from './project.repository';

type AuthorizedRepository = Awaited<ReturnType<RepositoriesService['listRepos']>>[number];

@Injectable()
export class ProjectsService {
  constructor(
    private readonly projectRepository: ProjectRepository,
    private readonly memberRepository: ProjectRepositoryMemberRepository,
    @Inject('REPOSITORIES_SERVICE')
    private readonly repositoriesService: RepositoriesService,
    private readonly aiApiClient: AiApiClient,
    @Inject('DATA_SOURCE')
    private readonly dataSource: DataSource,
  ) {}

  async list(currentUser: CurrentUserData) {
    const projects = await this.projectRepository.find({
      where: { ownerId: currentUser.id, active: true },
      order: { updatedAt: 'DESC' },
    });
    return Promise.all(projects.map((project) => this.withRepositories(project)));
  }

  async create(input: CreateProjectDto, currentUser: CurrentUserData) {
    const repositories = await this.authorizeRepositories(input.repositories, currentUser);

    const project = await this.dataSource.transaction(async (manager) => {
      const entity = this.projectRepository.create({
        ownerId: currentUser.id,
        name: input.name.trim(),
        description: input.description?.trim() || null,
      });
      const saved = await this.projectRepository.save(entity, undefined, manager);
      await this.memberRepository.replaceForProject(
        saved.id,
        repositories.map((repository) => this.toMember(saved.id, repository)),
        manager,
      );
      return saved;
    });

    return this.withRepositories(project);
  }

  async getById(id: string, currentUser: CurrentUserData) {
    const project = await this.projectRepository.findOne({
      where: { id, ownerId: currentUser.id, active: true },
    });
    if (!project) throw new NotFoundException('Projeto não encontrado.');
    return project;
  }

  async get(id: string, currentUser: CurrentUserData) {
    return this.withRepositories(await this.getById(id, currentUser));
  }

  async update(id: string, input: UpdateProjectDto, currentUser: CurrentUserData) {
    const project = await this.getById(id, currentUser);
    const repositories = input.repositories
      ? await this.authorizeRepositories(input.repositories, currentUser)
      : null;

    await this.dataSource.transaction(async (manager) => {
      await this.projectRepository.update(
        project.id,
        {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.description !== undefined
            ? { description: input.description.trim() || null }
            : {}),
        },
        manager,
      );
      if (repositories) {
        await this.memberRepository.replaceForProject(
          project.id,
          repositories.map((repository) => this.toMember(project.id, repository)),
          manager,
        );
      }
    });

    return this.get(id, currentUser);
  }

  async index(id: string, currentUser: CurrentUserData) {
    const project = await this.getById(id, currentUser);
    const repositories = await this.members(project.id);
    const queued = await Promise.all(
      repositories.map(async (repository) => ({
        repository: repository.fullName,
        ...(await this.repositoriesService.enqueueIndexJob(
          repository.name,
          currentUser,
          repository.owner,
        )),
      })),
    );
    return { projectId: project.id, repositories: queued };
  }

  async getIndexStatus(id: string, currentUser: CurrentUserData) {
    const project = await this.getById(id, currentUser);
    const repositories = await this.members(project.id);
    return {
      projectId: project.id,
      repositories: await Promise.all(
        repositories.map(async (repository) => {
          try {
            return {
              repository: repository.fullName,
              ...(await this.repositoriesService.getRepositoryIndexStatus(
                repository.name,
                currentUser,
                repository.owner,
              )),
            };
          } catch {
            return {
              repository: repository.fullName,
              status: 'error' as const,
              sha: null,
              stale: false,
              errorMessage: 'Não foi possível consultar este repositório.',
            };
          }
        }),
      ),
    };
  }

  async getGraph(id: string, currentUser: CurrentUserData) {
    const status = await this.getIndexStatus(id, currentUser);
    return this.aiApiClient.getProjectGraph({
      projectId: id,
      repositories: status.repositories.map((repository) => ({
        repoId: repository.repository,
        sha: repository.status === 'indexed' ? repository.sha : null,
      })),
    });
  }

  private async withRepositories<T extends { id: string }>(project: T) {
    return { ...project, repositories: await this.members(project.id) };
  }

  private members(projectId: string) {
    return this.memberRepository.find({
      where: { projectId, active: true },
      order: { fullName: 'ASC' },
    });
  }

  private async authorizeRepositories(names: string[], currentUser: CurrentUserData) {
    const available = await this.repositoriesService.listRepos(currentUser);
    const byName = new Map(available.map((repository) => [repository.fullName, repository]));
    const selected = names.map((name) => byName.get(name));
    if (selected.some((repository) => !repository)) {
      throw new BadRequestException(
        'Um ou mais repositórios não estão disponíveis para este usuário no GitHub.',
      );
    }
    return selected as AuthorizedRepository[];
  }

  private toMember(projectId: string, repository: AuthorizedRepository) {
    return {
      id: randomUUID(),
      projectId,
      githubId: String(repository.id),
      owner: repository.owner,
      name: repository.name,
      fullName: repository.fullName,
      private: repository.private,
      description: repository.description ?? null,
      htmlUrl: repository.htmlUrl,
      defaultBranch: repository.defaultBranch,
    };
  }
}
