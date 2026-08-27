export type ChatScopeInput =
  | { mode: 'repository'; repoId: string }
  | { mode: 'project'; projectId: string };

export class CreateChatThreadDto {
  scope!: ChatScopeInput;
}
