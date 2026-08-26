import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { CurrentUserData } from '../auth/utils/current-user-decorator';
import { CurrentUser } from '../auth/utils/current-user-decorator';
import { CreateProjectDto } from './dtos/create-project.dto';
import { UpdateProjectDto } from './dtos/update-project.dto';
import { ProjectsService } from './projects.service';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  list(@CurrentUser() currentUser: CurrentUserData) {
    return this.projectsService.list(currentUser);
  }

  @Get('eligible')
  eligible(
    @Query('repository') repository: string,
    @CurrentUser() currentUser: CurrentUserData,
  ) {
    return this.projectsService.listEligible(repository, currentUser);
  }

  @Post()
  create(
    @Body() input: CreateProjectDto,
    @CurrentUser() currentUser: CurrentUserData,
  ) {
    return this.projectsService.create(input, currentUser);
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() currentUser: CurrentUserData) {
    return this.projectsService.get(id, currentUser);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() input: UpdateProjectDto,
    @CurrentUser() currentUser: CurrentUserData,
  ) {
    return this.projectsService.update(id, input, currentUser);
  }

  @Post(':id/index')
  @HttpCode(202)
  index(@Param('id') id: string, @CurrentUser() currentUser: CurrentUserData) {
    return this.projectsService.index(id, currentUser);
  }

  @Get(':id/index/status')
  status(@Param('id') id: string, @CurrentUser() currentUser: CurrentUserData) {
    return this.projectsService.getIndexStatus(id, currentUser);
  }

  @Get(':id/graph')
  graph(@Param('id') id: string, @CurrentUser() currentUser: CurrentUserData) {
    return this.projectsService.getGraph(id, currentUser);
  }
}
