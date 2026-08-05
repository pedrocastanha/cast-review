import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { UserService } from "./user.service";
import { CreateUserDto } from "./dtos/create-user.dto";

@Controller('users')
export class UserController {
    constructor(
        private readonly userService: UserService
    ){}

    @Post()
    async createUser(@Body() dto: CreateUserDto) {
        return this.userService.createUser(dto);
    }

    @Get(':id')
    async getById(@Param('id') id: string) {
        return this.userService.getById(id);
    }
}