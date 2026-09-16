import 'dotenv/config';
import express, { type Express } from 'express';
import { loadConfig } from './config';
import { mountMcpTransport } from './mcp/server';

export function createApp(): Express {
  const app = express();

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  mountMcpTransport(app);

  return app;
}

function bootstrap() {
  const config = loadConfig();
  const app = createApp();

  app.listen(config.port, () => {
    console.log(`mcp-server listening on http://localhost:${config.port}`);
  });
}

if (require.main === module) {
  bootstrap();
}
