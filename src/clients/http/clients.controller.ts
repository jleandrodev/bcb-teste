import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CLOCK } from '../../shared/domain/clock';
import type { Clock } from '../../shared/domain/clock';
import { ClientsService } from '../application/clients.service';
import { AddCreditsDto, AuthDto, CreateClientDto, UpdateClientDto } from './dto';
import { ApiErrors } from '../../shared/http/api-errors';
import { presentBalance, presentClient, presentTransaction } from './presenters';
import { AuthResponse, BalanceResponse, ClientResponse, TransactionResponse } from './responses';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly clients: ClientsService) {}

  @ApiOkResponse({ type: AuthResponse })
  @ApiErrors(400, 401)
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

  @ApiOkResponse({ type: [ClientResponse], description: 'Rota administrativa: aberta nesta entrega (ADR-009)' })
  @Get()
  async list() {
    return (await this.clients.list()).map(presentClient);
  }

  @ApiCreatedResponse({ type: ClientResponse })
  @ApiErrors(400, 409)
  @Post()
  async create(@Body() dto: CreateClientDto) {
    return presentClient(await this.clients.create(dto));
  }

  @ApiOkResponse({ type: ClientResponse })
  @ApiErrors(404)
  @Get(':id')
  async get(@Param('id') id: string) {
    return presentClient(await this.clients.get(id));
  }

  @ApiOkResponse({ type: ClientResponse })
  @ApiErrors(400, 404)
  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateClientDto) {
    return presentClient(await this.clients.update(id, dto));
  }

  @ApiOkResponse({ type: BalanceResponse })
  @ApiErrors(404)
  @Get(':id/balance')
  async balance(@Param('id') id: string) {
    return presentBalance(await this.clients.get(id), this.clock.now());
  }

  @ApiCreatedResponse({ type: BalanceResponse })
  @ApiErrors(400, 404)
  @Post(':id/credits')
  async addCredits(@Param('id') id: string, @Body() dto: AddCreditsDto) {
    return presentBalance(await this.clients.addCredits(id, dto.amount), this.clock.now());
  }

  @ApiOkResponse({ type: [TransactionResponse] })
  @ApiErrors(404)
  @Get(':id/transactions')
  async transactions(@Param('id') id: string) {
    await this.clients.get(id);
    return (await this.clients.transactionsOf(id)).map(presentTransaction);
  }
}
