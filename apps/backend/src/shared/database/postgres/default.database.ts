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
import { DefaultEntity } from './default.entity';

export abstract class DefaultRepository<T extends DefaultEntity<T>> {
  constructor(
    readonly datasource: DataSource,
    readonly entity: EntityTarget<T>,
  ) {}

  private getRepository(manager?: EntityManager) {
    return manager
      ? manager.getRepository(this.entity)
      : this.datasource.getRepository(this.entity);
  }

  create(entityLike: DeepPartial<T>, manager?: EntityManager): T {
    const repository = this.getRepository(manager);
    return repository.create(entityLike);
  }

  createEmpty(manager?: EntityManager): T {
    const repository = this.getRepository(manager);
    return repository.create();
  }

  async save(
    entities: DeepPartial<T>,
    options?: SaveOptions,
    manager?: EntityManager,
  ): Promise<T> {
    const repository = this.getRepository(manager);
    return await repository.save(entities, options);
  }

  async saveMany(
    entities: DeepPartial<T>[],
    options?: SaveOptions,
    manager?: EntityManager,
  ): Promise<T[]> {
    const repository = this.getRepository(manager);
    return await repository.save(entities, options);
  }

  async find(
    findOptions: FindManyOptions<T>,
    manager?: EntityManager,
  ): Promise<T[]> {
    const repository = this.getRepository(manager);
    return await repository.find(findOptions);
  }

  async count(
    findOptions: FindManyOptions<T>,
    manager?: EntityManager,
  ): Promise<number> {
    const repository = this.getRepository(manager);
    return repository.count(findOptions);
  }

  async findAndCount(
    findOptions: FindManyOptions<T>,
    manager?: EntityManager,
  ): Promise<[T[], number]> {
    const repository = this.getRepository(manager);
    return repository.findAndCount(findOptions);
  }

  async findOne(
    options: FindOneOptions<T>,
    manager?: EntityManager,
  ): Promise<T | null> {
    const repository = this.getRepository(manager);
    return await repository.findOne(options);
  }

  async update(
    id: string,
    data: DeepPartial<T>,
    manager?: EntityManager,
  ): Promise<UpdateResult> {
    const repository = this.getRepository(manager);
    return await repository.update(id, data as any);
  }

  async delete(
    where: FindOptionsWhere<T>,
    manager?: EntityManager,
  ): Promise<DeleteResult> {
    const repository = this.getRepository(manager);
    return await repository.delete(where);
  }

  async existsBy(
    findOptionsWhere: FindOptionsWhere<T>,
    manager?: EntityManager,
  ): Promise<boolean> {
    const repository = this.getRepository(manager);
    return repository.exists({
      where: findOptionsWhere,
    });
  }

  createQueryBuilder(alias?: string, manager?: EntityManager) {
    const repository = this.getRepository(manager);
    return repository.createQueryBuilder(alias);
  }
}
