import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AiApiClient } from 'src/shared/clients/ai/ai-api.client';
import { AppLogger } from 'src/shared/logger/logger.service';
import type {
  ChatEvent,
  ChatRunMention,
  ChatRunRequest,
  ChatRunScopeRepository,
} from 'src/shared/types';
import type { CurrentUserData } from '../auth/utils/current-user-decorator';
import type { ProjectsService } from '../projects/projects.service';
import type { RepositoriesService } from '../repositories/repositories.service';
import type { UserService } from '../users/user.service';
import type { ChatMessage } from './chat-message.entity';
import { ChatMessageRepository } from './chat-message.repository';
import type { ChatThread } from './chat-thread.entity';
import { ChatThreadRepository } from './chat-thread.repository';
import type {
  ChatCitation,
  ChatScope,
  ChatToolCallRecord,
  ChatUsage,
} from './chat.types';
import type { CreateChatThreadDto } from './dtos/create-chat-thread.dto';
import type { SendChatMessageDto } from './dtos/send-chat-message.dto';

const HISTORY_WINDOW = 20;
const DEFAULT_TITLE = 'Nova conversa';

function splitRepoId(repoId: string): { owner: string; name: string } {
  const [owner, name] = repoId.split('/');
  if (!owner || !name) {
    throw new BadRequestException('repoId deve usar o formato owner/repo');
  }
  return { owner, name };
}

@Injectable()
export class ChatService {
  constructor(
    private readonly threadRepository: ChatThreadRepository,
    private readonly messageRepository: ChatMessageRepository,
    @Inject('REPOSITORIES_SERVICE')
    private readonly repositoriesService: RepositoriesService,
    @Inject('PROJECTS_SERVICE')
    private readonly projectsService: ProjectsService,
    @Inject('USER_SERVICE')
    private readonly userService: UserService,
    private readonly aiApiClient: AiApiClient,
    private readonly logger: AppLogger,
  ) {}

  async create(dto: CreateChatThreadDto, currentUser: CurrentUserData) {
    const scope = await this.resolveScope(dto, currentUser);
    if (!scope.repositories.some((repository) => repository.included)) {
      throw new BadRequestException(
        'Nenhum repositório indexado neste escopo. Indexe antes de abrir o chat.',
      );
    }

    const thread = await this.threadRepository.save(
      this.threadRepository.create({
        userId: currentUser.id,
        scopeType: scope.mode,
        repoId: scope.mode === 'repository' ? scope.repositories[0].repoId : null,
        projectId: scope.projectId ?? null,
        title: DEFAULT_TITLE,
        scope,
      }),
    );

    return this.toThreadDto(thread, []);
  }

  async list(
    currentUser: CurrentUserData,
    filters: { repoId?: string; projectId?: string },
  ) {
    const threads = await this.threadRepository.find({
      where: {
        userId: currentUser.id,
        active: true,
        ...(filters.repoId ? { repoId: filters.repoId } : {}),
        ...(filters.projectId ? { projectId: filters.projectId } : {}),
      },
      order: { updatedAt: 'DESC' },
    });
    return threads.map((thread) => this.toThreadDto(thread, []));
  }

  async get(id: string, currentUser: CurrentUserData) {
    const thread = await this.requireThread(id, currentUser);
    const messages = await this.messages(thread.id);
    const staleRepositories = await this.staleRepositories(thread, currentUser);
    return { ...this.toThreadDto(thread, messages), staleRepositories };
  }

  async rename(id: string, title: string, currentUser: CurrentUserData) {
    const thread = await this.requireThread(id, currentUser);
    await this.threadRepository.update(thread.id, { title });
    return this.toThreadDto({ ...thread, title } as ChatThread, []);
  }

  async remove(id: string, currentUser: CurrentUserData) {
    const thread = await this.requireThread(id, currentUser);
    await this.threadRepository.update(thread.id, { active: false });
  }

  async listFiles(
    id: string,
    currentUser: CurrentUserData,
    query: string | undefined,
    limit: number,
  ) {
    const thread = await this.requireThread(id, currentUser);
    const included = thread.scope.repositories.filter(
      (repository) => repository.included && repository.sha,
    );

    const perRepo = await Promise.all(
      included.map(async (repository) => {
        const result = await this.aiApiClient.listIndexFiles(
          repository.repoId,
          repository.sha as string,
          query,
          limit,
        );
        return result.paths.map((path) => ({
          repoId: repository.repoId,
          path,
        }));
      }),
    );

    return perRepo.flat().slice(0, limit);
  }

  async sendMessage(
    id: string,
    dto: SendChatMessageDto,
    currentUser: CurrentUserData,
    req: Request,
    res: Response,
  ) {
    const thread = await this.requireThread(id, currentUser);
    const included = thread.scope.repositories.filter(
      (repository) => repository.included && repository.sha,
    );
    if (included.length === 0) {
      throw new BadRequestException(
        'Nenhum repositório indexado nesta conversa.',
      );
    }

    const openai = await this.userService.getOpenaiKey(currentUser.id);
    const history = await this.messages(thread.id);
    const mentions = await this.resolveMentions(
      thread,
      dto.mentions ?? [],
      currentUser,
    );

    const userMessage = await this.messageRepository.save(
      this.messageRepository.create({
        threadId: thread.id,
        role: 'user',
        content: dto.content,
        mentions: (dto.mentions ?? []).map((mention) => ({
          repoId: mention.repoId,
          path: mention.path,
        })),
        toolCalls: [],
        citations: [],
        usage: null,
        truncated: false,
      }),
    );

    if (thread.title === DEFAULT_TITLE) {
      await this.threadRepository.update(thread.id, {
        title: dto.content.slice(0, 120),
      });
    }

    const payload: ChatRunRequest = {
      threadId: thread.id,
      mode: thread.scope.mode,
      projectId: thread.scope.projectId ?? null,
      repositories: included.map<ChatRunScopeRepository>((repository) => ({
        repoId: repository.repoId,
        sha: repository.sha as string,
      })),
      history: history.slice(-HISTORY_WINDOW).map((message) => ({
        role: message.role,
        content: message.content,
      })),
      question: dto.content,
      mentions,
      model: dto.model,
      apiKeys: { openai },
    };

    const abortController = new AbortController();
    req.on('close', () => abortController.abort());

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Chat-Message-Id': userMessage.id,
    });
    res.flushHeaders();

    try {
      for await (const event of this.aiApiClient.runChat(
        payload,
        abortController.signal,
      )) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
        if (event.type === 'message_done') {
          await this.persistAnswer(thread.id, event);
        }
      }
      res.end();
    } catch (err) {
      this.logger.error('Falha ao rodar chat', {
        exception: err,
        threadId: thread.id,
      });
      res.write(
        `data: ${JSON.stringify({
          type: 'error',
          payload: { message: 'Falha ao responder no chat' },
        })}\n\n`,
      );
      res.end();
    }
  }

  private async persistAnswer(threadId: string, event: ChatEvent) {
    const payload = event.payload as {
      content?: string;
      citations?: ChatCitation[];
      toolCalls?: ChatToolCallRecord[];
      usage?: ChatUsage;
      truncated?: boolean;
    };

    await this.messageRepository.save(
      this.messageRepository.create({
        threadId,
        role: 'assistant',
        content: payload.content ?? '',
        mentions: [],
        toolCalls: payload.toolCalls ?? [],
        citations: payload.citations ?? [],
        usage: payload.usage ?? null,
        truncated: payload.truncated ?? false,
      }),
    );
    await this.threadRepository.update(threadId, { updatedAt: new Date() });
  }

  private async resolveMentions(
    thread: ChatThread,
    mentions: { repoId: string; path: string }[],
    currentUser: CurrentUserData,
  ): Promise<ChatRunMention[]> {
    const resolved: ChatRunMention[] = [];

    for (const mention of mentions) {
      const repository = thread.scope.repositories.find(
        (candidate) => candidate.repoId === mention.repoId,
      );
      if (!repository?.sha || !repository.included) continue;

      const fromGraph = await this.aiApiClient.getIndexFile(
        repository.repoId,
        repository.sha,
        mention.path,
      );
      if (fromGraph) {
        resolved.push({
          repoId: repository.repoId,
          path: mention.path,
          content: fromGraph.content,
        });
        continue;
      }

      const { owner, name } = splitRepoId(repository.repoId);
      const fromGithub = await this.repositoriesService.getFileContent(
        name,
        mention.path,
        repository.sha,
        currentUser,
        owner,
      );
      if (fromGithub) {
        resolved.push({
          repoId: repository.repoId,
          path: mention.path,
          content: fromGithub,
        });
      }
    }

    return resolved;
  }

  private async resolveScope(
    dto: CreateChatThreadDto,
    currentUser: CurrentUserData,
  ): Promise<ChatScope> {
    const scope = dto?.scope;
    if (scope?.mode === 'repository') {
      const { owner, name } = splitRepoId(scope.repoId);
      const status = await this.repositoriesService.getRepositoryIndexStatus(
        name,
        currentUser,
        owner,
      );
      return {
        mode: 'repository',
        repositories: [
          {
            repoId: `${owner}/${name}`,
            sha: status.sha,
            included: status.status === 'indexed' && Boolean(status.sha),
            omissionReason:
              status.status === 'indexed' && status.sha ? null : status.status,
          },
        ],
      };
    }

    if (scope?.mode === 'project') {
      const project = await this.projectsService.getById(
        scope.projectId,
        currentUser,
      );
      const status = await this.projectsService.getIndexStatus(
        project.id,
        currentUser,
      );
      return {
        mode: 'project',
        projectId: project.id,
        projectName: project.name,
        repositories: status.repositories.map((repository) => ({
          repoId: repository.repository,
          sha: repository.sha ?? null,
          included: repository.status === 'indexed' && Boolean(repository.sha),
          omissionReason:
            repository.status === 'indexed' && repository.sha
              ? null
              : repository.status,
        })),
      };
    }

    throw new BadRequestException('scope.mode deve ser repository ou project');
  }

  private async staleRepositories(
    thread: ChatThread,
    currentUser: CurrentUserData,
  ): Promise<string[]> {
    const included = thread.scope.repositories.filter(
      (repository) => repository.included && repository.sha,
    );

    const checked = await Promise.all(
      included.map(async (repository) => {
        try {
          const { owner, name } = splitRepoId(repository.repoId);
          const status = await this.repositoriesService.getRepositoryIndexStatus(
            name,
            currentUser,
            owner,
          );
          return status.sha && status.sha !== repository.sha
            ? repository.repoId
            : null;
        } catch {
          return null;
        }
      }),
    );

    return checked.filter((repoId): repoId is string => repoId !== null);
  }

  private async requireThread(id: string, currentUser: CurrentUserData) {
    const thread = await this.threadRepository.findOne({
      where: { id, userId: currentUser.id, active: true },
    });
    if (!thread) throw new NotFoundException('Conversa não encontrada.');
    return thread;
  }

  private messages(threadId: string) {
    return this.messageRepository.find({
      where: { threadId, active: true },
      order: { createdAt: 'ASC' },
    });
  }

  private toThreadDto(thread: ChatThread, messages: ChatMessage[]) {
    return {
      id: thread.id,
      scope: thread.scope,
      title: thread.title,
      repoId: thread.repoId,
      projectId: thread.projectId,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      messages: messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        mentions: message.mentions,
        toolCalls: message.toolCalls,
        citations: message.citations,
        usage: message.usage,
        truncated: message.truncated,
        createdAt: message.createdAt,
      })),
    };
  }
}
