import { GetFileContentUseCase } from '../get-file-content/get-file-content.use-case';
import { GetConventionsDto } from './get-conventions.dto';

export class GetConventionsUseCase {
  constructor(private readonly getFileContent: GetFileContentUseCase) {}

  async execute({
    repo,
    ref,
    currentUser,
    ownerOverride,
  }: GetConventionsDto): Promise<string> {
    const content = await this.getFileContent.execute({
      repo,
      path: 'conventions.md',
      ref,
      currentUser,
      ownerOverride,
    });

    return content ?? '';
  }
}
