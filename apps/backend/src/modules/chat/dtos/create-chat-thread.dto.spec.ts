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

  it('aceita escopo global', async () => {
    const value = await pipe.transform({ scope: { mode: 'global' } }, metadata);

    expect(value.scope).toEqual({ mode: 'global' });
  });

  it('rejeita projeto com ID inválido', async () => {
    await expect(
      pipe.transform(
        { scope: { mode: 'project', projectId: 'uuid-1' } },
        metadata,
      ),
    ).rejects.toBeDefined();
  });

  it('aceita escopo de projeto com UUID', async () => {
    const scope = { mode: 'project', projectId: 'cfc2b7a8-6b94-46f9-a7c1-55136f34df73' };
    expect((await pipe.transform({ scope }, metadata)).scope).toEqual(scope);
  });

  it('rejeita corpo sem scope', async () => {
    await expect(pipe.transform({}, metadata)).rejects.toBeDefined();
  });

  it('rejeita scope que não é objeto', async () => {
    await expect(
      pipe.transform({ scope: 'repository' }, metadata),
    ).rejects.toBeDefined();
  });
});
