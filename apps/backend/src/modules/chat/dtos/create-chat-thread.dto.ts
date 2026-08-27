import { IsObject } from 'class-validator';

export type ChatScopeInput =
  | { mode: 'repository'; repoId: string }
  | { mode: 'project'; projectId: string };

export class CreateChatThreadDto {
  @IsObject()
  scope!: ChatScopeInput;
}
