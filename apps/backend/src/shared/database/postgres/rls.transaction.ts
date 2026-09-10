import { Inject, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import type { ActorType } from './db-actor';
import { runInRlsTransaction } from './rls-context';

/**
 * Unidade de trabalho sob RLS, para quando o caso de uso precisa de VÁRIAS
 * queries na mesma transação (leitura + escrita consistentes, ou escrita
 * multi-tabela). Para uma query solta não é preciso: `DefaultRepository` já
 * abre a transação com contexto sozinho quando não recebe um `manager`.
 *
 * O escopo é a UNIDADE DE TRABALHO, não a requisição HTTP. Envolver o request
 * inteiro numa transação seguraria uma conexão do pool por toda a duração de um
 * stream SSE (até `SSE_MAX_DURATION_MS`, 15 min por padrão) — pool esgotado e
 * autovacuum travado atrás da transação mais antiga. Em SSE, envolva cada passo
 * discreto: carregar, persistir iteração, finalizar.
 */
@Injectable()
export class RlsTransaction {
  constructor(@Inject('DATA_SOURCE') private readonly datasource: DataSource) {}

  /** Roda `work` com o ator do escopo assíncrono atual. */
  async run<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return runInRlsTransaction(this.datasource, work);
  }

  /**
   * Roda `work` com um ator explícito. Porta de entrada do `AuthService`
   * (`'auth'`), dos webhooks (`'service'`) e dos workers (`'job'`) — contextos
   * que não vêm de uma requisição autenticada.
   */
  async runAs<T>(
    actorType: ActorType,
    userId: string | null,
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return runInRlsTransaction(this.datasource, work, { actorType, userId });
  }
}
