/**
 * RunGateway — WebSocket entre o Nest e o frontend.
 *
 * POR QUÊ WEBSOCKET AQUI E SSE SÓ NO PYTHON
 * -----------------------------------------
 * SPEC: Python expõe SSE; Nest traduz para o WS próprio do front.
 * O browser nunca abre conexão no ai-api. Isso:
 * - mantém o Python sem CORS/auth de usuário;
 * - permite o Nest enriquecer eventos (runId) e guardar report.
 *
 * Protocolo (MVP)
 * ---------------
 * Cliente → servidor:
 *   event: "start_run"
 *   body: StartRunMessage
 *
 * Servidor → cliente:
 *   event: "run_started"   { runId }
 *   event: "agent_event"   AgentEvent & { runId }
 *   event: "run_error"     { runId?, message }
 *   event: "run_finished"  { runId }
 */
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { RunService } from './run.service';
import type { StartRunMessage } from '../../shared/types';

@WebSocketGateway({
  // Namespace default "/". CORS aberto no MVP local.
  cors: { origin: '*' },
})
export class RunGateway implements OnGatewayConnection {
  private readonly logger = new Logger(RunGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private readonly runService: RunService) {}

  handleConnection(client: Socket) {
    this.logger.log(`WS client connected: ${client.id}`);
  }

  /**
   * Handler de start_run — ponto de entrada da review em tempo real.
   *
   * Validação mínima no gateway; erros de GitHub/Python viram
   * eventos run_error / agent_event type=error.
   */
  @SubscribeMessage('start_run')
  async handleStartRun(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: StartRunMessage,
  ) {
    // Guard clauses — falha rápida com mensagem clara pro front.
    if (!body?.githubToken) {
      client.emit('run_error', { message: 'githubToken is required' });
      return;
    }
    if (!body.owner || !body.repo || !body.pullNumber) {
      client.emit('run_error', {
        message: 'owner, repo and pullNumber are required',
      });
      return;
    }
    if (!body.models?.testReviewer || !body.models?.architectureReviewer) {
      client.emit('run_error', {
        message: 'models.testReviewer and models.architectureReviewer are required',
      });
      return;
    }

    try {
      const runId = await this.runService.startRun(body, async (event) => {
        // Emite só para o socket que pediu a run (não broadcast global).
        client.emit('agent_event', event);
      });

      client.emit('run_started', { runId });
      client.emit('run_finished', { runId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`start_run failed: ${message}`);
      client.emit('run_error', { message });
    }
  }
}
