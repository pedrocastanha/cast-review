import request from 'supertest';
import { createApp } from './main';

describe('GET /health', () => {
  it('returns 200 with { status: "ok" }', async () => {
    const app = createApp();

    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});
