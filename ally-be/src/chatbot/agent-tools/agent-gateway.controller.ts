import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from 'src/auth/decorators/auth.metadata';
import {
  AgentGatewayResponse,
  AgentGatewayService,
} from './agent-gateway.service';

/**
 * The chatbot agent's tool gateway (chunk 3b): the tools ally-ai's agent calls back mid-run.
 * Machine-only: `@Public()` to the user-auth guard, and no user JWT is read here. It takes two
 * credentials, both required: the service key (`x-api-key`) and the run token ally-be signed for
 * this run (`Authorization: Bearer`). Every check is in `AgentGatewayService`.
 */
@ApiExcludeController()
@Controller('v1/internal/agent')
export class AgentGatewayController {
  constructor(private readonly gateway: AgentGatewayService) {}

  @Public()
  @Post('tools/:name')
  @HttpCode(200)
  tool(
    @Param('name') name: string,
    @Headers('x-api-key') apiKey: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ): Promise<AgentGatewayResponse> {
    return this.gateway.call(name, { apiKey, authorization }, body);
  }
}
