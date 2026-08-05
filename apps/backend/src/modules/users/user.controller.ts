import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { User } from "./user.entity";
import { UserService } from "./user.service";

@Controller('users')
export class UserController {
    constructor(
        private readonly userService: UserService
    ){}

    @Post()
    async createUser(@Body() user: User) {
        return this.userService.createUser(user);
    }

    @Get(':id')
    async getById(@Param('id') id: string) {
        return this.userService.getById(id);
    }
}