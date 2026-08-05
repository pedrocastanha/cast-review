import { randomUUID } from 'node:crypto'
import { Exclude } from 'class-transformer'
import {
  BeforeInsert,
  BeforeUpdate,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  PrimaryColumn,
  UpdateDateColumn
} from 'typeorm'

export abstract class DefaultEntity<T> {
  constructor(data: Partial<T>) {
    Object.assign(this, data)
    this.id = this.id || randomUUID()
  }

  @BeforeInsert()
  beforeInsert(): void {
    this.createdAt = this.createdAt || new Date()
    this.updatedAt = new Date()
  }

  @BeforeUpdate()
  beforeUpdate(): void {
    this.updatedAt = new Date()
  }

  @PrimaryColumn({ name: 'id', type: 'uuid' })
  id: string

  @Exclude()
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date

  @Exclude()
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date

  @Exclude()
  @DeleteDateColumn({ name: 'deleted_at', nullable: true })
  deletedAt: Date | null

  @Column({ name: 'active', nullable: false, default: true })
  active: boolean
}
