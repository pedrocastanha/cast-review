import { Inject, Injectable } from '@nestjs/common';
import { DefaultRepository } from 'src/shared/database/postgres/default.database';
import { DataSource } from 'typeorm';
import { FeatureCard } from '../../entities/feature-card.entity';

@Injectable()
export class FeatureCardRepository extends DefaultRepository<FeatureCard> {
  constructor(@Inject('DATA_SOURCE') readonly datasource: DataSource) {
    super(datasource, FeatureCard);
  }
}
