import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DefaultRepository } from '../../../../shared/database/postgres/default.database';
import { GithubWebhookDelivery } from '../../entities/github-webhook-delivery.entity';

@Injectable()
export class GithubWebhookDeliveryRepository extends DefaultRepository<GithubWebhookDelivery> {
  constructor(@Inject('DATA_SOURCE') readonly datasource: DataSource) {
    super(datasource, GithubWebhookDelivery);
  }
}
