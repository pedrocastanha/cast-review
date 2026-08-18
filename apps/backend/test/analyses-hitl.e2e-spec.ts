import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from 'src/app.module';
import { AuthService } from 'src/modules/auth/auth.service';
import { User } from 'src/modules/users/user.entity';
import { UserRepository } from 'src/modules/users/user.repository';
import { AiApiClient } from 'src/shared/clients/ai/ai-api.client';
import type {
  AgentEvent,
  AgentResumeRequest,
  AgentRunRequest,
} from 'src/shared/types';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  GithubFetchStub,
  installGithubFetchStub,
} from './support/github-fetch-stub';

/**
 * T23 — Nest e2e: full multi-stage HITL flow.
 *
 * Drives run -> reject/approve at `prd` -> reject/approve at `spec` ->
 * report_ready -> the synthetic `awaiting_approval`/`publish` gate ->
 * publish approve -> completed, through the real Nest app (real Postgres,
 * real auth guard, real DTO validation) end to end.
 *
 * Two things can't reasonably be "real" for this run and are stubbed at the
 * network boundary instead of the app boundary:
 *
 * 1. ai-api: no fake-LLM hook exists for a real *subprocess* ai-api (the
 *    ai-api test suite's own HTTP-level tests reach a similar "real
 *    process" bar only via an in-process `TestClient` + `monkeypatch` on the
 *    LLM client — see `apps/ai-api/tests/test_agent_routes_http.py`).
 *    Standing up a real subprocess would mean either modifying ai-api
 *    source to add a fake-LLM toggle (out of this task's scope: Nest-only
 *    changes) or firing real OpenAI calls with the key in `apps/ai-api/.env`
 *    (real cost, real network flakiness, non-deterministic PRD/SPEC content
 *    that this test needs to diff between v1/v2 — not requested and not
 *    worth the risk without explicit sign-off). So `AiApiClient` is
 *    overridden with a small scripted fake at the Nest DI boundary — this
 *    is `overrideProvider`, the standard Nest e2e seam, not a source edit.
 * 2. GitHub: `RepositoriesService` builds its own `Octokit` per call with no
 *    injectable client to override, so `globalThis.fetch` is stubbed for
 *    the `api.github.com` host only (see `./support/github-fetch-stub.ts`).
 *    Every non-GET call recorded there is a "write" for the zero-GitHub-
 *    writes-before-approval assertion.
 *
 * Real for this test: Postgres (via the app's own TypeORM wiring), the JWT
 * auth guard, class-validator DTOs, `AnalysesService`/`streamLeg`'s
 * persistence + gating logic, and the HTTP routing/SSE framing.
 */

const TEST_OWNER = 'hitl-e2e-owner';
const TEST_REPO = 'hitl-e2e-repo';
const TEST_PULL_NUMBER = 42;
const HEAD_REF = 'feature/search-filter';
const HEAD_SHA = 'abc123headsha';
const BASE_REF = 'main';
const CHANGED_FILE_PATH = 'src/example.ts';
const CHANGED_FILE_CONTENT = [
  'export function add(a: number, b: number): number {',
  '  return a + b;',
  '}',
  '',
].join('\n');

const PRD_V1 = {
  markdown:
    '# PRD v1\n\nWe should implement a debounced search filter for the dashboard so results update as the user types.',
  title: 'Search Filter PRD',
};
const PRD_V1_EXCERPT = 'debounced search filter for the dashboard';

const PRD_V2 = {
  markdown:
    '# PRD v2 (revised)\n\nWe should implement a debounced search filter for the dashboard so results update as the user types, using a 300ms debounce per reviewer feedback.',
  title: 'Search Filter PRD',
};

const SPEC_V1 = {
  markdown:
    '# Spec v1\n\nAdd a useDebouncedValue hook in SearchBar.tsx with a fixed 200ms delay.',
};
const SPEC_V1_EXCERPT = 'useDebouncedValue hook in SearchBar.tsx';

const SPEC_V2 = {
  markdown:
    '# Spec v2 (revised)\n\nAdd a useDebouncedValue hook in SearchBar.tsx with a 300ms delay, per reviewer feedback.',
};

const REPORT_READY_PAYLOAD = {
  markdown:
    '# Final Report\n\nOverall the change looks reasonable but needs a fix.',
  verdict: 'request_changes',
  overallScore: 6,
  failCount: 1,
  warningCount: 0,
  headline: 'Needs one fix before merge',
  conventionsSource: 'default',
  results: [
    {
      name: 'test_reviewer',
      score: 6,
      findings: [
        {
          status: 'fail',
          title: 'Missing test coverage',
          detail: 'The new debounce logic has no unit test.',
          path: CHANGED_FILE_PATH,
          line: 1,
        },
      ],
    },
    {
      name: 'architecture_reviewer',
      score: 8,
      findings: [],
    },
  ],
};

const MODELS = {
  testReviewer: 'gpt-4o-mini',
  architectureReviewer: 'gpt-4o-mini',
};
const API_KEYS = { openai: 'sk-test-fake-key' };

/**
 * Scripted `AiApiClient` replacement. Each method is an async generator, so
 * it slots into `streamLeg`'s `for await (const event of events)` loop
 * exactly like the real HTTP-SSE client would, minus the network hop.
 * Branches strictly on `decision.stage`/`decision.action`, matching the one
 * linear path this test drives (reject-then-approve at `prd`, then the same
 * at `spec`) — anything else throws loudly rather than silently no-op-ing.
 */
class ScriptedAiApiClient {
  runCalls: AgentRunRequest[] = [];
  resumeCalls: AgentResumeRequest[] = [];

  async *runAgent(payload: AgentRunRequest): AsyncGenerator<AgentEvent> {
    this.runCalls.push(payload);
    yield {
      type: 'change_analysis_done',
      payload: {
        changeAnalysis: { files: [], hasTests: false, hasMigration: false },
      },
    };
    yield { type: 'prd_generated', payload: PRD_V1 };
    yield {
      type: 'awaiting_approval',
      payload: { stage: 'prd', iteration: 1 },
    };
  }

  async *resumeAgent(payload: AgentResumeRequest): AsyncGenerator<AgentEvent> {
    this.resumeCalls.push(payload);
    const decision = payload.decision;
    if (!decision) {
      throw new Error(
        'ScriptedAiApiClient: unscripted resume without a decision',
      );
    }

    if (decision.stage === 'prd' && decision.action === 'reject') {
      yield { type: 'prd_generated', payload: PRD_V2 };
      yield {
        type: 'awaiting_approval',
        payload: { stage: 'prd', iteration: 2 },
      };
      return;
    }

    if (decision.stage === 'prd' && decision.action === 'approve') {
      yield { type: 'spec_generated', payload: SPEC_V1 };
      yield {
        type: 'awaiting_approval',
        payload: { stage: 'spec', iteration: 1 },
      };
      return;
    }

    if (decision.stage === 'spec' && decision.action === 'reject') {
      yield { type: 'spec_generated', payload: SPEC_V2 };
      yield {
        type: 'awaiting_approval',
        payload: { stage: 'spec', iteration: 2 },
      };
      return;
    }

    if (decision.stage === 'spec' && decision.action === 'approve') {
      yield { type: 'report_ready', payload: REPORT_READY_PAYLOAD };
      return;
    }

    throw new Error(
      `ScriptedAiApiClient: unscripted decision ${JSON.stringify(decision)}`,
    );
  }
}

function parseSse(text: string): AgentEvent[] {
  const events: AgentEvent[] = [];
  for (const rawEvent of text.split('\n\n')) {
    const dataLine = rawEvent
      .split('\n')
      .find((line) => line.startsWith('data:'));
    if (!dataLine) continue;
    events.push(JSON.parse(dataLine.slice(5).trim()));
  }
  return events;
}

describe('Analyses HITL flow (e2e)', () => {
  let app: INestApplication<App>;
  let scriptedAiApiClient: ScriptedAiApiClient;
  let githubStub: GithubFetchStub;
  let accessToken: string;

  beforeAll(async () => {
    githubStub = installGithubFetchStub({
      owner: TEST_OWNER,
      repo: TEST_REPO,
      pullNumber: TEST_PULL_NUMBER,
      headRef: HEAD_REF,
      headSha: HEAD_SHA,
      baseRef: BASE_REF,
      diff: '--- a/src/example.ts\n+++ b/src/example.ts\n@@ -0,0 +1,3 @@\n+export function add(a, b) {\n+  return a + b;\n+}\n',
      files: [
        {
          filename: CHANGED_FILE_PATH,
          status: 'modified',
          patch:
            '@@ -0,0 +1,3 @@\n+export function add(a, b) {\n+  return a + b;\n+}\n',
        },
      ],
      fileContents: {
        [CHANGED_FILE_PATH]: CHANGED_FILE_CONTENT,
        'conventions.md': null,
      },
    });

    scriptedAiApiClient = new ScriptedAiApiClient();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AiApiClient)
      .useValue(scriptedAiApiClient)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();

    const userRepository = moduleFixture.get(UserRepository);
    const authService = moduleFixture.get(AuthService);

    const user = await userRepository.save(
      userRepository.create({
        id: randomUUID(),
        name: 'HITL E2E User',
        email: `hitl-e2e-${randomUUID()}@example.com`,
        username: `hitl-e2e-${randomUUID()}`,
        password: 'irrelevant-not-used-for-login',
        githubToken: 'gho_fake_token_for_e2e_testing_only',
        githubTokenLastFour: 'nly',
        githubLogin: TEST_OWNER,
      }) as Partial<User>,
    );
    accessToken = await authService.generateAccessToken(user);
  });

  afterAll(async () => {
    githubStub.restore();
    await app.close();
  });

  it('drives a 3-stage manual run through reject/approve cycles with zero GitHub writes before the final publish approval', async () => {
    const authHeader = `Bearer ${accessToken}`;

    // --- Step 1: run, all-manual policies, stream ends at awaiting_approval/prd ---
    const runResponse = await request(app.getHttpServer())
      .post(`/repositories/${TEST_REPO}/pulls/${TEST_PULL_NUMBER}/analyses`)
      .set('Authorization', authHeader)
      .send({
        models: MODELS,
        apiKeys: API_KEYS,
        policies: { prd: 'manual', spec: 'manual' },
      })
      .expect(200);

    const analysisId = runResponse.headers['x-analysis-id'];
    expect(analysisId).toBeTruthy();

    let events = parseSse(runResponse.text);
    expect(events.map((e) => e.type)).toEqual([
      'change_analysis_done',
      'prd_generated',
      'awaiting_approval',
    ]);
    expect(events.at(-1)?.payload).toEqual({ stage: 'prd', iteration: 1 });

    // Zero GitHub writes so far — only reads happened while building the
    // agent-run context (pull metadata, diff, files, conventions.md).
    expect(githubStub.writeCalls).toHaveLength(0);

    // --- Step 2: reject prd with an annotation on the actual v1 content ---
    expect(PRD_V1.markdown).toContain(PRD_V1_EXCERPT);
    const prdRejectResponse = await request(app.getHttpServer())
      .post(`/analyses/${analysisId}/approve`)
      .set('Authorization', authHeader)
      .send({
        stage: 'prd',
        decision: 'reject',
        annotations: [{ excerpt: PRD_V1_EXCERPT, note: 'test feedback' }],
        apiKeys: API_KEYS,
        models: MODELS,
      })
      .expect(200);

    events = parseSse(prdRejectResponse.text);
    expect(events.map((e) => e.type)).toEqual([
      'prd_generated',
      'awaiting_approval',
    ]);
    expect(events.at(-1)?.payload).toEqual({ stage: 'prd', iteration: 2 });
    expect((events[0].payload as { markdown: string }).markdown).toBe(
      PRD_V2.markdown,
    );

    const afterPrdReject = await request(app.getHttpServer())
      .get(`/analyses/${analysisId}`)
      .set('Authorization', authHeader)
      .expect(200);
    expect(afterPrdReject.body.prdIterations).toHaveLength(1);
    expect(afterPrdReject.body.prdIterations[0].annotations).toEqual([
      { excerpt: PRD_V1_EXCERPT, note: 'test feedback' },
    ]);
    expect(afterPrdReject.body.specIterations).toHaveLength(0);
    expect(githubStub.writeCalls).toHaveLength(0);

    // --- Step 3: approve prd (v2) -> spec generated -> awaiting_approval/spec ---
    const prdApproveResponse = await request(app.getHttpServer())
      .post(`/analyses/${analysisId}/approve`)
      .set('Authorization', authHeader)
      .send({
        stage: 'prd',
        decision: 'approve',
        apiKeys: API_KEYS,
        models: MODELS,
      })
      .expect(200);

    events = parseSse(prdApproveResponse.text);
    expect(events.map((e) => e.type)).toEqual([
      'spec_generated',
      'awaiting_approval',
    ]);
    expect(events.at(-1)?.payload).toEqual({ stage: 'spec', iteration: 1 });
    expect(githubStub.writeCalls).toHaveLength(0);

    // --- Step 4: reject spec with an annotation on the actual v1 content ---
    expect(SPEC_V1.markdown).toContain(SPEC_V1_EXCERPT);
    const specRejectResponse = await request(app.getHttpServer())
      .post(`/analyses/${analysisId}/approve`)
      .set('Authorization', authHeader)
      .send({
        stage: 'spec',
        decision: 'reject',
        annotations: [{ excerpt: SPEC_V1_EXCERPT, note: 'test feedback' }],
        apiKeys: API_KEYS,
        models: MODELS,
      })
      .expect(200);

    events = parseSse(specRejectResponse.text);
    expect(events.map((e) => e.type)).toEqual([
      'spec_generated',
      'awaiting_approval',
    ]);
    expect(events.at(-1)?.payload).toEqual({ stage: 'spec', iteration: 2 });

    const afterSpecReject = await request(app.getHttpServer())
      .get(`/analyses/${analysisId}`)
      .set('Authorization', authHeader)
      .expect(200);
    expect(afterSpecReject.body.specIterations).toHaveLength(1);
    expect(afterSpecReject.body.specIterations[0].annotations).toEqual([
      { excerpt: SPEC_V1_EXCERPT, note: 'test feedback' },
    ]);
    // prdIterations from step 2 must still be intact (v1 still inspectable).
    expect(afterSpecReject.body.prdIterations).toHaveLength(1);
    expect(githubStub.writeCalls).toHaveLength(0);

    // --- Step 5: approve spec (v2) -> report_ready -> synthetic awaiting_approval/publish ---
    const specApproveResponse = await request(app.getHttpServer())
      .post(`/analyses/${analysisId}/approve`)
      .set('Authorization', authHeader)
      .send({
        stage: 'spec',
        decision: 'approve',
        apiKeys: API_KEYS,
        models: MODELS,
      })
      .expect(200);

    events = parseSse(specApproveResponse.text);
    expect(events.map((e) => e.type)).toEqual([
      'report_ready',
      'awaiting_approval',
    ]);
    expect(events.at(-1)?.payload).toEqual({ stage: 'publish' });

    // This is the noted gap (see class-level docstring and final report):
    // `RunAnalysisDto`/`run()` never set `analysis.publishPolicy`, so
    // `streamLeg`'s `analysis.publishPolicy?.publish === 'auto'` check is
    // always false — every run fails closed to a manual publish gate here,
    // by construction, regardless of what policies were requested.
    const afterReportReady = await request(app.getHttpServer())
      .get(`/analyses/${analysisId}`)
      .set('Authorization', authHeader)
      .expect(200);
    expect(afterReportReady.body.status).toBe('awaiting_approval');
    expect(afterReportReady.body.approvalStage).toBe('publish');
    expect(afterReportReady.body.publishPolicy).toBeNull();
    expect(githubStub.writeCalls).toHaveLength(0);

    // --- Step 6: approve publish -> plain JSON, completed, exactly one GitHub write ---
    const publishApproveResponse = await request(app.getHttpServer())
      .post(`/analyses/${analysisId}/approve`)
      .set('Authorization', authHeader)
      .send({ stage: 'publish', decision: 'approve' })
      // Nest defaults POST handlers to 201 even in `@Res()` mode, as long as
      // the handler hasn't already called `res.writeHead(...)` itself (the
      // SSE routes do; `approvePublish` doesn't — it's a plain `res.json()`
      // reply, so Nest's own default status wins). Verified empirically
      // against this codebase's actual `approvePublish` behavior.
      .expect(201)
      .expect('Content-Type', /json/);

    expect(publishApproveResponse.body.status).toBe('completed');
    expect(publishApproveResponse.body.report.githubComments).toBeDefined();
    expect(publishApproveResponse.body.report.githubComments.status).toBe(
      'posted',
    );

    expect(githubStub.writeCalls).toHaveLength(1);
    expect(githubStub.writeCalls[0]).toEqual({
      method: 'POST',
      pathname: `/repos/${TEST_OWNER}/${TEST_REPO}/pulls/${TEST_PULL_NUMBER}/reviews`,
    });

    // Full success-criteria recap: 3 distinct awaiting_approval events
    // (prd, spec, publish) across the whole flow, zero GitHub writes before
    // the final explicit approval.
    expect(scriptedAiApiClient.runCalls).toHaveLength(1);
    expect(scriptedAiApiClient.resumeCalls).toHaveLength(4);
  });
});
