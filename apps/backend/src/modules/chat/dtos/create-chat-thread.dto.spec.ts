import { ValidationPipe } from '@nestjs/common';
import { CreateChatThreadDto } from './create-chat-thread.dto';

const pipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  forbidNonWhitelisted: true,
});

const metadata = { type: 'body' as const, metatype: CreateChatThreadDto };

describe('CreateChatThreadDto', () => {
  it('sobrevive ao ValidationPipe global usado em main.ts', async () => {
    const value = await pipe.transform(
      { scope: { mode: 'repository', repoId: 'acme/back' } },
      metadata,
    );

    expect(value.scope).toEqual({ mode: 'repository', repoId: 'acme/back' });
  });

  it('aceita escopo de projeto', async () => {
    const value = await pipe.transform(
      { scope: { mode: 'project', projectId: 'uuid-1' } },
      metadata,
    );

    expect(value.scope).toEqual({ mode: 'project', projectId: 'uuid-1' });
  });

  it('rejeita corpo sem scope', async () => {
    await expect(pipe.transform({}, metadata)).rejects.toBeDefined();
  });

  it('rejeita scope que não é objeto', async () => {
    await expect(pipe.transform({ scope: 'repository' }, metadata)).rejects.toBeDefined();
  });
});
