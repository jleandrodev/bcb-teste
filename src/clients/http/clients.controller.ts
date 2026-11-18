import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CLOCK } from '../../shared/domain/clock';
import type { Clock } from '../../shared/domain/clock';
import { ClientsService } from '../application/clients.service';
import { AddCreditsDto, AuthDto, CreateClientDto, UpdateClientDto } from './dto';
import { presentBalance, presentClient, presentTransaction } from './presenters';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly clients: ClientsService) {}

  @Post()
  @HttpCode(200)
  async authenticate(@Body() dto: AuthDto) {
    const { token, client } = await this.clients.authenticate(dto.documentType, dto.documentId);
    return { token, client: presentClient(client) };
  }
}

@ApiTags('clients')
@Controller('clients')
export class ClientsController {
  constructor(
    private readonly clients: ClientsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Get()
  async list() {
    return (await this.clients.list()).map(presentClient);
  }

  @Post()
  async create(@Body() dto: CreateClientDto) {
    return presentClient(await this.clients.create(dto));
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return presentClient(await this.clients.get(id));
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateClientDto) {
    return presentClient(await this.clients.update(id, dto));
  }

  @Get(':id/balance')
  async balance(@Param('id') id: string) {
    return presentBalance(await this.clients.get(id), this.clock.now());
  }

  @Post(':id/credits')
  async addCredits(@Param('id') id: string, @Body() dto: AddCreditsDto) {
    return presentBalance(await this.clients.addCredits(id, dto.amount), this.clock.now());
  }

  @Get(':id/transactions')
  async transactions(@Param('id') id: string) {
    await this.clients.get(id);
    return (await this.clients.transactionsOf(id)).map(presentTransaction);
  }
}
