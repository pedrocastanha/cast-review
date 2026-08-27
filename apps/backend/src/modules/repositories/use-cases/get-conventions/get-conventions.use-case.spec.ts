import type { CurrentUserData } from '../../../auth/utils/current-user-decorator';
import { GetFileContentUseCase } from '../get-file-content/get-file-content.use-case';
import { GetConventionsUseCase } from './get-conventions.use-case';

const currentUser: CurrentUserData = {
  id: 'user-1',
  username: 'octocat',
  email: 'octocat@example.com',
};

function fakeGetFileContent(content: string | null) {
  return {
    execute: jest.fn().mockResolvedValue(content),
  } as unknown as GetFileContentUseCase;
}

describe('GetConventionsUseCase', () => {
  it('reads conventions.md at the given ref', async () => {
    const getFileContent = fakeGetFileContent('use camelCase');
    const useCase = new GetConventionsUseCase(getFileContent);

    const result = await useCase.execute({
      repo: 'hello-world',
      ref: 'main',
      currentUser,
    });

    expect(getFileContent.execute).toHaveBeenCalledWith({
      repo: 'hello-world',
      path: 'conventions.md',
      ref: 'main',
      currentUser,
      ownerOverride: undefined,
    });
    expect(result).toBe('use camelCase');
  });

  it('falls back to an empty string when the file does not exist', async () => {
    const useCase = new GetConventionsUseCase(fakeGetFileContent(null));

    const result = await useCase.execute({
      repo: 'hello-world',
      ref: 'main',
      currentUser,
    });

    expect(result).toBe('');
  });
});
