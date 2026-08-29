import { Type } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsString,
  Validate,
  ValidateIf,
  ValidateNested,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { ReviewModelsDto } from './run-analysis.dto';

export class AnnotationDto {
  @IsString()
  excerpt!: string;

  @IsString()
  note!: string;
}

@ValidatorConstraint({ name: 'annotationsRequiredOnReject', async: false })
class AnnotationsRequiredOnRejectConstraint implements ValidatorConstraintInterface {
  validate(annotations: AnnotationDto[] | undefined, args: ValidationArguments): boolean {
    const dto = args.object as ApproveAnalysisDto;
    const requiresAnnotations =
      (dto.stage === 'prd' || dto.stage === 'spec') && dto.decision === 'reject';

    if (!requiresAnnotations) {
      return true;
    }

    return Array.isArray(annotations) && annotations.length > 0;
  }

  defaultMessage(): string {
    return 'annotations must contain at least 1 entry when rejecting a prd or spec stage';
  }
}

export class ApproveAnalysisDto {
  @IsIn(['prd', 'spec', 'publish'])
  stage!: 'prd' | 'spec' | 'publish';

  @IsIn(['approve', 'reject'])
  decision!: 'approve' | 'reject';

  @ValidateNested({ each: true })
  @Type(() => AnnotationDto)
  @Validate(AnnotationsRequiredOnRejectConstraint)
  annotations?: AnnotationDto[];

  @ValidateIf((o: ApproveAnalysisDto) => o.stage === 'prd' || o.stage === 'spec')
  @IsDefined()
  @ValidateNested()
  @Type(() => ReviewModelsDto)
  models?: ReviewModelsDto;
}
