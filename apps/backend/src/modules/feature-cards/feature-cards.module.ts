import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { FeatureCardsController } from './feature-cards.controller';
import { FeatureCardsService } from './feature-cards.service';
import { FeatureCardRepository } from './infrastructure/persistence/feature-card.repository';

@Module({
  imports: [ProjectsModule],
  controllers: [FeatureCardsController],
  providers: [FeatureCardsService, FeatureCardRepository],
})
export class FeatureCardsModule {}
