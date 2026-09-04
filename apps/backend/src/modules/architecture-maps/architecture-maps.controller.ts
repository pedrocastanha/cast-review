import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { CurrentUserData } from '../auth/utils/current-user-decorator';
import { CurrentUser } from '../auth/utils/current-user-decorator';
import type { ArchitectureScopeType } from './domain/architecture-maps.types';
import { ArchitectureMapsService } from './architecture-maps.service';
import { AssignComponentDto } from './dtos/assign-component.dto';
import { CreateArchitectureMapDto } from './dtos/create-architecture-map.dto';
import { DeclareBoundaryDto } from './dtos/declare-boundary.dto';
import { UpsertCapabilityDto } from './dtos/upsert-capability.dto';

@Controller('architecture-maps')
export class ArchitectureMapsController {
  constructor(
    private readonly architectureMapsService: ArchitectureMapsService,
  ) {}

  @Get()
  list(@CurrentUser() currentUser: CurrentUserData) {
    return this.architectureMapsService.list(currentUser);
  }

  @Get('for-scope')
  async forScope(
    @Query('scopeType') scopeType: ArchitectureScopeType,
    @Query('scopeRef') scopeRef: string,
    @CurrentUser() currentUser: CurrentUserData,
  ) {
    return {
      map: await this.architectureMapsService.findForScope(
        scopeType,
        scopeRef,
        currentUser,
      ),
    };
  }

  @Post()
  create(
    @Body() input: CreateArchitectureMapDto,
    @CurrentUser() currentUser: CurrentUserData,
  ) {
    return this.architectureMapsService.create(input, currentUser);
  }

  @Get(':mapId')
  view(
    @Param('mapId') mapId: string,
    @CurrentUser() currentUser: CurrentUserData,
  ) {
    return this.architectureMapsService.getView(mapId, currentUser);
  }

  @Post(':mapId/suggestions')
  suggest(
    @Param('mapId') mapId: string,
    @CurrentUser() currentUser: CurrentUserData,
  ) {
    return this.architectureMapsService.suggestComponents(mapId, currentUser);
  }

  @Post(':mapId/capabilities')
  createCapability(
    @Param('mapId') mapId: string,
    @Body() input: UpsertCapabilityDto,
    @CurrentUser() currentUser: CurrentUserData,
  ) {
    return this.architectureMapsService.createCapability(
      mapId,
      input,
      currentUser,
    );
  }

  @Patch(':mapId/capabilities/:capabilityId')
  updateCapability(
    @Param('mapId') mapId: string,
    @Param('capabilityId') capabilityId: string,
    @Body() input: UpsertCapabilityDto,
    @CurrentUser() currentUser: CurrentUserData,
  ) {
    return this.architectureMapsService.updateCapability(
      mapId,
      capabilityId,
      input,
      currentUser,
    );
  }

  @Delete(':mapId/capabilities/:capabilityId')
  deleteCapability(
    @Param('mapId') mapId: string,
    @Param('capabilityId') capabilityId: string,
    @CurrentUser() currentUser: CurrentUserData,
  ) {
    return this.architectureMapsService.deleteCapability(
      mapId,
      capabilityId,
      currentUser,
    );
  }

  @Patch(':mapId/components/:componentId')
  assignComponent(
    @Param('mapId') mapId: string,
    @Param('componentId') componentId: string,
    @Body() input: AssignComponentDto,
    @CurrentUser() currentUser: CurrentUserData,
  ) {
    return this.architectureMapsService.assignComponent(
      mapId,
      componentId,
      input,
      currentUser,
    );
  }

  @Post(':mapId/boundaries')
  declareBoundary(
    @Param('mapId') mapId: string,
    @Body() input: DeclareBoundaryDto,
    @CurrentUser() currentUser: CurrentUserData,
  ) {
    return this.architectureMapsService.declareBoundary(
      mapId,
      input,
      currentUser,
    );
  }

  @Delete(':mapId/boundaries/:boundaryId')
  deleteBoundary(
    @Param('mapId') mapId: string,
    @Param('boundaryId') boundaryId: string,
    @CurrentUser() currentUser: CurrentUserData,
  ) {
    return this.architectureMapsService.deleteBoundary(
      mapId,
      boundaryId,
      currentUser,
    );
  }

  @Post(':mapId/versions')
  publish(
    @Param('mapId') mapId: string,
    @CurrentUser() currentUser: CurrentUserData,
  ) {
    return this.architectureMapsService.publish(mapId, currentUser);
  }

  @Get(':mapId/versions')
  listVersions(
    @Param('mapId') mapId: string,
    @CurrentUser() currentUser: CurrentUserData,
  ) {
    return this.architectureMapsService.listVersions(mapId, currentUser);
  }

  @Get(':mapId/versions/:version')
  getVersion(
    @Param('mapId') mapId: string,
    @Param('version', ParseIntPipe) version: number,
    @CurrentUser() currentUser: CurrentUserData,
  ) {
    return this.architectureMapsService.getVersion(
      mapId,
      version,
      currentUser,
    );
  }
}
