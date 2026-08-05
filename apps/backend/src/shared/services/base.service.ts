import { ConflictException, NotFoundException } from '@nestjs/common'
import { AppLogger } from '../logger/logger.service'

export class BaseService {
  constructor(protected readonly logger: AppLogger) {}
  /**
   * Executes a function that retrieves an entity and ensures the entity exists.
   *
   * This method is useful for enforcing existence checks in repositories/services.
   * If the provided function resolves to `null` or `undefined`, it will throw
   * a `NotFoundException` with a descriptive message including the entity name
   * and the search criteria.
   *
   * @template T - The type of the entity being queried.
   *
   * @param fn - An async function that resolves to the entity or `null`.
   * Typically this will be a call like `repository.findOne({ where: criteria })`.
   *
   * @param entityName - A human-readable name of the entity (e.g., "User", "Order").
   * Used in the error message if the entity is not found.
   *
   * @param criteria - The lookup criteria used to search for the entity.
   * This is logged in the error message to provide clear debugging context.
   * Should be a valid TypeORM `FindOptionsWhere<T>` object.
   *
   * @returns The found entity of type `T`.
   *
   * @throws {NotFoundException} If no entity is found for the given criteria.
   *
   * @example
   * ```ts
   * // Inside UserService
   * return this.getOrFail(
   *   () => this.userRepository.findOne({ where: { id: userId } }),
   *   'User',
   *   { id: userId }
   * )
   * ```
   */
  protected async getOrFail<T>(
    fn: () => Promise<T | null>,
    entityName: string,
    criteria: Record<string, unknown>
  ): Promise<T> {
    const entity = await this.safeExecute(fn)
    if (!entity) {
      throw new NotFoundException(
        `${entityName} not found with criteria: ${JSON.stringify(criteria)}`
      )
    }
    return entity
  }

  /**
   * Handle database errors consistently across all services.
   */
  protected handleError(err: any): never {
    this.logger.error(err)

    if (err.code === '23505') {
      const detail = err.detail || ''
      const match = detail.match(/\(([^)]+)\)=\(([^)]+)\)/)

      if (match) {
        const field = match[1]
        const value = match[2]
        throw new ConflictException(
          `The value "${value}" for field "${field}" already exists`
        )
      }

      throw new ConflictException('Duplicate key value already exists')
    }

    throw err
  }

  /**
   * Wrap an async function with error handling.
   */
  protected async safeExecute<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (err) {
      return this.handleError(err)
    }
  }
}
