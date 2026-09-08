import { BadRequestException } from '@nestjs/common';
import {
  decryptBoundSecret,
  encryptBoundSecret,
  encryptSecret,
  isBoundToOwner,
} from 'src/shared/crypto/secret-crypto';
import { runWithRequestCredentials } from 'src/shared/security/request-credentials';
import { UserService } from './user.service';

const OWNER = 'user-1';
const FIELD = 'openai_key';

function buildService(overrides: any = {}) {
  const userRepository = {
    findOne: jest.fn(async () => ({
      id: OWNER,
      openaiKey: encryptBoundSecret('sk-guardada', {
        ownerId: OWNER,
        field: FIELD,
      }),
    })),
    update: jest.fn(async () => ({ affected: 1 })),
    createQueryBuilder: jest.fn(() => ({
      update: () => ({
        set: () => ({
          where: () => ({ execute: jest.fn(async () => ({ affected: 1 })) }),
        }),
      }),
    })),
    ...overrides.userRepository,
  };
  const logger = { error: jest.fn(), log: jest.fn(), warn: jest.fn() };
  const refreshSessions = {
    revokeAllForUser: jest.fn(async () => 0),
    ...overrides.refreshSessions,
  };
  const service = new UserService(
    userRepository as any,
    refreshSessions as any,
    logger as any,
  );
  return { service, userRepository, refreshSessions, logger };
}

describe('UserService.updateUser com chave da OpenAI', () => {
  const environment = { ...process.env };

  beforeEach(() => {
    process.env.SECRET_ENCRYPTION_KEY = '01'.repeat(32);
    delete process.env.SECRET_ENCRYPTION_ACTIVE_KEY;
    delete process.env.CREDENTIALS_MODE;
  });

  afterEach(() => {
    process.env = { ...environment };
  });

  it('guarda a chave cifrada e presa ao dono, com os quatro últimos em claro', async () => {
    const { service, userRepository } = buildService();
    jest.spyOn(service, 'getByIdOrFail').mockResolvedValue({} as any);

    await service.updateUser(OWNER, { openaiKey: '  sk-abcdef1234WXYZ  ' });

    const [, patch] = userRepository.update.mock.calls[0];
    expect(patch.openaiKeyLastFour).toBe('WXYZ');
    expect(patch.openaiKey).not.toContain('sk-abcdef1234WXYZ');
    expect(isBoundToOwner(patch.openaiKey)).toBe(true);
    expect(
      decryptBoundSecret(patch.openaiKey, { ownerId: OWNER, field: FIELD }),
    ).toBe('sk-abcdef1234WXYZ');
  });

  it('não deixa outro usuário decifrar a chave guardada', async () => {
    const { service, userRepository } = buildService();
    jest.spyOn(service, 'getByIdOrFail').mockResolvedValue({} as any);

    await service.updateUser(OWNER, { openaiKey: 'sk-abcdef1234WXYZ' });
    const [, patch] = userRepository.update.mock.calls[0];

    expect(() =>
      decryptBoundSecret(patch.openaiKey, {
        ownerId: 'attacker',
        field: FIELD,
      }),
    ).toThrow(/decifrar/);
  });

  it('não deixa a chave ser lida como se fosse outro campo', async () => {
    const { service, userRepository } = buildService();
    jest.spyOn(service, 'getByIdOrFail').mockResolvedValue({} as any);

    await service.updateUser(OWNER, { openaiKey: 'sk-abcdef1234WXYZ' });
    const [, patch] = userRepository.update.mock.calls[0];

    expect(() =>
      decryptBoundSecret(patch.openaiKey, {
        ownerId: OWNER,
        field: 'github_token',
      }),
    ).toThrow(/decifrar/);
  });

  it('recusa chave vazia', async () => {
    const { service } = buildService();

    await expect(
      service.updateUser(OWNER, { openaiKey: '   ' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recusa guardar credencial quando a instância é efêmera', async () => {
    process.env.CREDENTIALS_MODE = 'ephemeral';
    const { service, userRepository } = buildService();

    await expect(
      service.updateUser(OWNER, { openaiKey: 'sk-abcdef1234WXYZ' }),
    ).rejects.toThrow(/não guarda credenciais/);
    expect(userRepository.update).not.toHaveBeenCalled();
  });
});

describe('UserService.getOpenaiKey', () => {
  const environment = { ...process.env };

  beforeEach(() => {
    process.env.SECRET_ENCRYPTION_KEY = '01'.repeat(32);
    delete process.env.SECRET_ENCRYPTION_ACTIVE_KEY;
    delete process.env.CREDENTIALS_MODE;
  });

  afterEach(() => {
    process.env = { ...environment };
  });

  it('devolve a chave decifrada', async () => {
    const { service } = buildService();
    await expect(service.getOpenaiKey(OWNER)).resolves.toBe('sk-guardada');
  });

  it('prefere a credencial da sessão e nem toca no banco', async () => {
    const { service, userRepository } = buildService();

    await expect(
      runWithRequestCredentials({ openaiKey: 'sk-da-sessao' }, () =>
        service.getOpenaiKey(OWNER),
      ),
    ).resolves.toBe('sk-da-sessao');
    expect(userRepository.findOne).not.toHaveBeenCalled();
  });

  it('exige a credencial da sessão quando a instância é efêmera', async () => {
    process.env.CREDENTIALS_MODE = 'ephemeral';
    const { service, userRepository } = buildService();

    await expect(service.getOpenaiKey(OWNER)).rejects.toThrow(
      /nesta sessão/,
    );
    expect(userRepository.findOne).not.toHaveBeenCalled();
  });

  it('pede configuração quando não há chave salva', async () => {
    const { service } = buildService({
      userRepository: {
        findOne: jest.fn(async () => ({ id: OWNER, openaiKey: null })),
      },
    });

    await expect(service.getOpenaiKey(OWNER)).rejects.toThrow(
      /Configure sua chave/,
    );
  });

  it('vira erro legível quando a chave não decifra', async () => {
    const { service } = buildService({
      userRepository: {
        findOne: jest.fn(async () => ({
          id: OWNER,
          openaiKey: 'v3::AAAA:BBBB:CCCC',
        })),
      },
    });

    await expect(service.getOpenaiKey(OWNER)).rejects.toThrow(/ilegível/);
  });

  it('recusa uma credencial cifrada movida de outro usuário', async () => {
    const { service } = buildService({
      userRepository: {
        findOne: jest.fn(async () => ({
          id: OWNER,
          openaiKey: encryptBoundSecret('sk-da-vitima', {
            ownerId: 'victim',
            field: FIELD,
          }),
        })),
      },
    });

    await expect(service.getOpenaiKey(OWNER)).rejects.toThrow(/ilegível/);
  });

  it('lê um segredo legado e o religa ao dono', async () => {
    const legacy = encryptSecret('sk-legado');
    const execute = jest.fn(async () => ({ affected: 1 }));
    const { service } = buildService({
      userRepository: {
        findOne: jest.fn(async () => ({ id: OWNER, openaiKey: legacy })),
        createQueryBuilder: jest.fn(() => ({
          update: () => ({ set: () => ({ where: () => ({ execute }) }) }),
        })),
      },
    });

    await expect(service.getOpenaiKey(OWNER)).resolves.toBe('sk-legado');
    expect(execute).toHaveBeenCalled();
  });

  it('ainda devolve a chave se a religação falhar', async () => {
    const legacy = encryptSecret('sk-legado');
    const { service, logger } = buildService({
      userRepository: {
        findOne: jest.fn(async () => ({ id: OWNER, openaiKey: legacy })),
        createQueryBuilder: jest.fn(() => {
          throw new Error('banco indisponível');
        }),
      },
    });

    await expect(service.getOpenaiKey(OWNER)).resolves.toBe('sk-legado');
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('UserService.removeOpenaiKey', () => {
  it('zera chave e últimos quatro', async () => {
    const { service, userRepository } = buildService();
    jest.spyOn(service, 'getByIdOrFail').mockResolvedValue({} as any);

    await service.removeOpenaiKey(OWNER);

    expect(userRepository.update).toHaveBeenCalledWith(OWNER, {
      openaiKey: null,
      openaiKeyLastFour: null,
    });
  });
});
