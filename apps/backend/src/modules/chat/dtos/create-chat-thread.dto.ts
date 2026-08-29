import {
  IsObject,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

export type ChatScopeInput =
  | { mode: 'global' }
  | { mode: 'repository'; repoId: string };

@ValidatorConstraint({ name: 'chatScope' })
class ChatScopeConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    const scope = value as Record<string, unknown>;
    if (scope.mode === 'global') return Object.keys(scope).length === 1;
    return (
      scope.mode === 'repository' &&
      typeof scope.repoId === 'string' &&
      /^[^/\s]+\/[^/\s]+$/.test(scope.repoId)
    );
  }
}

export class CreateChatThreadDto {
  @IsObject()
  @Validate(ChatScopeConstraint)
  scope!: ChatScopeInput;
}
