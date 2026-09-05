import { randomUUID } from 'node:crypto';
import { NotFoundException, ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import configured from 'src/shared/database/postgres/postgres.datasource';
import { AppLogger } from 'src/shared/logger/logger.service';
import { FeatureCardsController } from 'src/modules/feature-cards/feature-cards.controller';
import { FeatureCardsService } from 'src/modules/feature-cards/feature-cards.service';
import { FeatureCardRepository } from 'src/modules/feature-cards/infrastructure/persistence/feature-card.repository';
import { FeatureCard } from 'src/modules/feature-cards/entities/feature-card.entity';
import { FeatureCardRevision } from 'src/modules/feature-cards/entities/feature-card-revision.entity';
import { proposalFixture } from 'src/modules/feature-cards/use-cases/shared/card-test-fixture';
import { ProjectsService } from 'src/modules/projects/projects.service';

describe('Feature Cards HTTP and Postgres', () => {
  const database = `cast_cards_test_${randomUUID().replaceAll('-', '')}`;
  const ownerId = randomUUID();
  const projectId = randomUUID();
  const threadId = randomUUID();
  const messageId = randomUUID();
  let admin: DataSource;
  let db: DataSource;
  let app: INestApplication;
  let created = false;

  beforeAll(async () => {
    admin = new DataSource({ ...configured.options, migrations: [], entities: [] });
    await admin.initialize();
    await admin.query(`CREATE DATABASE "${database}"`);
    created = true;
    db = new DataSource({ ...configured.options, database });
    await db.initialize();
    await db.runMigrations();
    await db.query(`INSERT INTO users (id, name, email, password) VALUES ($1, 'Cards test', $2, 'test')`, [ownerId, `${ownerId}@test.invalid`]);
    await db.query(`INSERT INTO projects (id, owner_id, name) VALUES ($1, $2, 'Cards test')`, [projectId, ownerId]);
    await db.query(`INSERT INTO chat_threads (id, user_id, project_id, scope_type, title, scope) VALUES ($1, $2, $3, 'project', 'Feature', $4)`, [threadId, ownerId, projectId, JSON.stringify({ mode: 'project', projectId, repositories: [] })]);
    await db.query(`INSERT INTO chat_messages (id, thread_id, role, content, proposal) VALUES ($1, $2, 'assistant', 'Proposta', $3)`, [messageId, threadId, JSON.stringify(proposalFixture())]);
    const module = await Test.createTestingModule({
      controllers: [FeatureCardsController],
      providers: [FeatureCardsService, FeatureCardRepository, { provide: 'DATA_SOURCE', useValue: db },
        { provide: AppLogger, useValue: { error: jest.fn() } },
        { provide: ProjectsService, useValue: { getById: async (id: string, user: { id: string }) => {
          if (id !== projectId || user.id !== ownerId) throw new NotFoundException();
          return { id };
        } } }],
    }).compile();
    app = module.createNestApplication();
    app.use((req, _res, next) => { req.user = { id: req.headers['x-test-user'] ?? ownerId, email: 'test@test.invalid', username: 'test' }; next(); });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  }, 60000);

  afterAll(async () => {
    await app?.close();
    if (db?.isInitialized) await db.destroy();
    if (created) await admin.query(`DROP DATABASE "${database}"`);
    if (admin?.isInitialized) await admin.destroy();
  });

  it('saves concurrently without duplicates and persists dependency IDs', async () => {
    const url = `/projects/${projectId}/cards/from-message`;
    const responses = await Promise.all([request(app.getHttpServer()).post(url).send({ messageId }), request(app.getHttpServer()).post(url).send({ messageId })]);
    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    const cards = await db.getRepository(FeatureCard).find();
    expect(cards).toHaveLength(3);
    expect(await db.getRepository(FeatureCardRevision).count()).toBe(3);
    expect(cards.find((c) => c.taskKey === 'ui')!.dependsOn).toEqual([cards.find((c) => c.taskKey === 'api')!.id]);
  });

  it('validates DTOs and rejects access outside the project', async () => {
    const root = `/projects/${projectId}/cards`;
    await request(app.getHttpServer()).get(root).set('x-test-user', randomUUID()).expect(404);
    await request(app.getHttpServer()).post(`${root}/from-message`).send({ messageId: 'invalid' }).expect(400);
    await request(app.getHttpServer()).get(`${root}?limit=1000`).expect(400);
    const card = (await db.getRepository(FeatureCard).find())[0];
    await request(app.getHttpServer()).patch(`${root}/${card.id}`).set('x-test-user', randomUUID()).send({ version: 1, title: 'Invadido' }).expect(404);
    await request(app.getHttpServer()).patch(`${root}/${card.id}`).send({ version: 1, status: 'unknown' }).expect(400);
  });

  it('paginates without duplicating or omitting cards', async () => {
    const url = `/projects/${projectId}/cards?limit=2`;
    const first = await request(app.getHttpServer()).get(url).expect(200);
    const second = await request(app.getHttpServer()).get(`${url}&after=${first.body.nextCursor}`).expect(200);
    expect(first.body.items).toHaveLength(2);
    expect(second.body.items).toHaveLength(1);
    expect(second.body.nextCursor).toBeNull();
    expect(new Set([...first.body.items, ...second.body.items].map((c) => c.id)).size).toBe(3);
  });

  it('serializes edits, rejects stale versions, enforces dependencies and returns history', async () => {
    const cards = await db.getRepository(FeatureCard).find();
    const api = cards.find((c) => c.taskKey === 'api')!;
    const ui = cards.find((c) => c.taskKey === 'ui')!;
    const root = `/projects/${projectId}/cards`;
    await request(app.getHttpServer()).patch(`${root}/${ui.id}`).send({ version: 1, status: 'in_progress' }).expect(400);
    const edits = await Promise.all(['Avisos A', 'Avisos B'].map((title) => request(app.getHttpServer()).patch(`${root}/${api.id}`).send({ version: 1, title })));
    expect(edits.map((r) => r.status).sort()).toEqual([200, 409]);
    await request(app.getHttpServer()).patch(`${root}/${api.id}`).send({ version: 2, status: 'done' }).expect(200);
    await request(app.getHttpServer()).patch(`${root}/${ui.id}`).send({ version: 1, status: 'in_progress' }).expect(200);
    await request(app.getHttpServer()).patch(`${root}/${api.id}`).send({ version: 3, status: 'ready' }).expect(400);
    const history = await request(app.getHttpServer()).get(`${root}/${api.id}/history`).expect(200);
    expect(history.body.map((r) => r.version)).toEqual([3, 2, 1]);
    expect(history.body[2].snapshot.title).toBe('Persistir avisos');
  });

  it('archives a family atomically and does not resurrect it on repeated save', async () => {
    const parent = await db.getRepository(FeatureCard).findOneByOrFail({ taskKey: 'feature' });
    const root = `/projects/${projectId}/cards`;
    await request(app.getHttpServer()).post(`${root}/${parent.id}/archive`).send({ version: parent.version }).expect(204);
    const board = await request(app.getHttpServer()).get(root).expect(200);
    expect(board.body.items).toEqual([]);
    const saved = await request(app.getHttpServer()).post(`${root}/from-message`).send({ messageId }).expect(201);
    expect(saved.body.every((card) => !card.active)).toBe(true);
    expect(await db.getRepository(FeatureCard).count()).toBe(3);
  });
});
