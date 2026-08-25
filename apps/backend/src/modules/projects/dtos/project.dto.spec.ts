import { validate } from 'class-validator';
import { CreateProjectDto } from './create-project.dto';
import { UpdateProjectDto } from './update-project.dto';

describe('Project DTOs', () => {
  it('rejects whitespace-only names on create', async () => {
    const input = Object.assign(new CreateProjectDto(), {
      name: '   ',
      repositories: ['cast/frontend'],
    });

    const errors = await validate(input);

    expect(errors.some((error) => error.property === 'name')).toBe(true);
  });

  it('rejects whitespace-only names on update', async () => {
    const input = Object.assign(new UpdateProjectDto(), { name: '   ' });

    const errors = await validate(input);

    expect(errors.some((error) => error.property === 'name')).toBe(true);
  });
});
