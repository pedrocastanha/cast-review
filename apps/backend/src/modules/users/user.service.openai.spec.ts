import { BadRequestException } from '@nestjs/common';
import { SecretDecryptionError } from 'src/shared/crypto/secret-crypto';
import { UserService } from './user.service';

function buildService(overrides: any = {}) {
  const userRepository = {
    findOne: jest.fn(async () => ({ id: 'user-1', openaiKey: 'sk-guardada' })),
    update: jest.fn(async () => ({ affected: 1 })),
    ...overrides.userRepository,
  };
  const logger = { error: jest.fn(), log: jest.fn(), warn: jest.fn() };
  const service = new UserService(userRepository as any, logger as any);
  return { service, userRepository, logger };
}

describe('UserService.updateUser com chave da OpenAI', () => {
  it('guarda a chave e os quatro últimos caracteres', async () => {
    const { service, userRepository } = buildService();
    jest.spyOn(service, 'getByIdOrFail').mockResolvedValue({} as any);

    await service.updateUser('user-1', { openaiKey: '  sk-abcdef1234WXYZ  ' });

    expect(userRepository.update).toHaveBeenCalledWith('user-1', {
      openaiKey: 'sk-abcdef1234WXYZ',
      openaiKeyLastFour: 'WXYZ',
    });
  });

  it('recusa chave vazia', async () => {
    const { service } = buildService();

    await expect(
      service.updateUser('user-1', { openaiKey: '   ' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('UserService.getOpenaiKey', () => {
  it('devolve a chave decifrada', async () => {
    const { service } = buildService();
    await expect(service.getOpenaiKey('user-1')).resolves.toBe('sk-guardada');
  });

  it('pede configuração quando não há chave salva', async () => {
    const { service } = buildService({
      userRepository: { findOne: jest.fn(async () => ({ id: 'user-1', openaiKey: null })) },
    });

    await expect(service.getOpenaiKey('user-1')).rejects.toThrow(/Configure sua chave/);
  });

  it('vira erro legível quando a chave não decifra', async () => {
    const { service } = buildService({
      userRepository: {
        findOne: jest.fn(async () => {
          throw new SecretDecryptionError();
        }),
      },
    });

    await expect(service.getOpenaiKey('user-1')).rejects.toThrow(/ilegível/);
  });
});

describe('UserService.removeOpenaiKey', () => {
  it('zera chave e últimos quatro', async () => {
    const { service, userRepository } = buildService();
    jest.spyOn(service, 'getByIdOrFail').mockResolvedValue({} as any);

    await service.removeOpenaiKey('user-1');

    expect(userRepository.update).toHaveBeenCalledWith('user-1', {
      openaiKey: null,
      openaiKeyLastFour: null,
    });
  });
});
