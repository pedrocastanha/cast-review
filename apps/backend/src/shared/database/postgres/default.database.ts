import {
  DataSource,
  DeepPartial,
  DeleteResult,
  EntityManager,
  EntityTarget,
  FindManyOptions,
  FindOneOptions,
  FindOptionsWhere,
  SaveOptions,
  UpdateResult,
} from 'typeorm';
import type { IsolationLevel } from 'typeorm/driver/types/IsolationLevel';
import { DefaultEntity } from './default.entity';
import { type RlsTransactionOptions, runInRlsTransaction } from './rls-context';

export abstract class DefaultRepository<T extends DefaultEntity<T>> {
  constructor(
    readonly datasource: DataSource,
    readonly entity: EntityTarget<T>,
  ) {}

  private getRepository(manager: EntityManager) {
    return manager.getRepository(this.entity);
  }

  /**
   * Todo acesso passa por aqui, e é isso que torna a RLS viável sem reescrever
   * cada service.
   *
   * Com `manager`, o chamador já abriu a transação e já injetou o contexto —
   * respeitamos a unidade de trabalho dele. Sem `manager`, abrimos uma
   * transação curta só para esta query e injetamos o contexto do ator do escopo
   * assíncrono atual. Uma query solta fora de transação veria contexto vazio, e
   * contexto vazio não lê nada.
   *
   * Custo: um round trip extra de `set_config` por query solta. Quando o caso
   * de uso faz várias queries que precisam ser consistentes entre si, use
   * `RlsTransaction.run` e propague o `manager`.
   */
  private async withRepository<R>(
    manager: EntityManager | undefined,
    work: (repository: ReturnType<typeof this.getRepository>) => Promise<R>,
  ): Promise<R> {
    if (manager) return work(this.getRepository(manager));
    return runInRlsTransaction(this.datasource, (scoped) =>
      work(this.getRepository(scoped)),
    );
  }

  // `create`/`createEmpty` só instanciam a entidade, não tocam o banco.
  create(entityLike: DeepPartial<T>, manager?: EntityManager): T {
    const repository = manager
      ? this.getRepository(manager)
      : this.datasource.getRepository(this.entity);
    return repository.create(entityLike);
  }

  createEmpty(manager?: EntityManager): T {
    const repository = manager
      ? this.getRepository(manager)
      : this.datasource.getRepository(this.entity);
    return repository.create();
  }

  async save(
    entities: DeepPartial<T>,
    options?: SaveOptions,
    manager?: EntityManager,
  ): Promise<T> {
    return this.withRepository(manager, (repository) =>
      repository.save(entities, options),
    );
  }

  async saveMany(
    entities: DeepPartial<T>[],
    options?: SaveOptions,
    manager?: EntityManager,
  ): Promise<T[]> {
    return this.withRepository(manager, (repository) =>
      repository.save(entities, options),
    );
  }

  async find(
    findOptions: FindManyOptions<T>,
    manager?: EntityManager,
  ): Promise<T[]> {
    return this.withRepository(manager, (repository) =>
      repository.find(findOptions),
    );
  }

  async count(
    findOptions: FindManyOptions<T>,
    manager?: EntityManager,
  ): Promise<number> {
    return this.withRepository(manager, (repository) =>
      repository.count(findOptions),
    );
  }

  async findAndCount(
    findOptions: FindManyOptions<T>,
    manager?: EntityManager,
  ): Promise<[T[], number]> {
    return this.withRepository(manager, (repository) =>
      repository.findAndCount(findOptions),
    );
  }

  async findOne(
    options: FindOneOptions<T>,
    manager?: EntityManager,
  ): Promise<T | null> {
    return this.withRepository(manager, (repository) =>
      repository.findOne(options),
    );
  }

  /**
   * Filtra apenas por PK. Sob RLS, atualizar linha de outro dono não lança: só
   * devolve `affected: 0`. Quem chama precisa CHECAR `affected` — ignorar o
   * retorno transforma negação de acesso em no-op silencioso.
   */
  async update(
    id: string,
    data: DeepPartial<T>,
    manager?: EntityManager,
  ): Promise<UpdateResult> {
    return this.withRepository(manager, (repository) =>
      repository.update(id, data as any),
    );
  }

  /** Ver a nota de `update`: sob RLS isto devolve `affected: 0`, não lança. */
  async delete(
    where: FindOptionsWhere<T>,
    manager?: EntityManager,
  ): Promise<DeleteResult> {
    return this.withRepository(manager, (repository) =>
      repository.delete(where),
    );
  }

  async existsBy(
    findOptionsWhere: FindOptionsWhere<T>,
    manager?: EntityManager,
  ): Promise<boolean> {
    return this.withRepository(manager, (repository) =>
      repository.exists({ where: findOptionsWhere }),
    );
  }

  /**
   * Transação com contexto de RLS já injetado, para o caso em que o chamador
   * precisa do `manager` — tipicamente `createQueryBuilder`, ou várias queries
   * que precisam ser consistentes entre si.
   */
  async withRlsTransaction<R>(
    workOrIsolation: ((manager: EntityManager) => Promise<R>) | IsolationLevel,
    workOrOptions?:
      | ((manager: EntityManager) => Promise<R>)
      | RlsTransactionOptions,
    options?: RlsTransactionOptions,
  ): Promise<R> {
    if (typeof workOrIsolation === 'string') {
      const work = workOrOptions as (manager: EntityManager) => Promise<R>;
      return runInRlsTransaction(this.datasource, work, {
        ...options,
        isolationLevel: workOrIsolation,
      });
    }
    return runInRlsTransaction(
      this.datasource,
      workOrIsolation,
      (workOrOptions as RlsTransactionOptions) ?? {},
    );
  }

  /**
   * Escapa do wrapper: o query builder é construído e executado pelo chamador,
   * então não há como abrir a transação por ele. Sob RLS, use sempre junto de
   * um `manager` vindo de `RlsTransaction.run` — sem isso a query roda com
   * contexto vazio e não devolve nada.
   */
  createQueryBuilder(alias: string | undefined, manager: EntityManager) {
    return this.getRepository(manager).createQueryBuilder(alias);
  }
}
