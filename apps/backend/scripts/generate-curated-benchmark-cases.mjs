import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_FILE_CONTENT = 16_000;
const OUTPUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../src/modules/benchmarks/fixtures/curated-benchmark-cases.ts',
);

const LICENSES = {
  axios: {
    spdx: 'MIT',
    name: 'MIT License',
    url: 'https://github.com/axios/axios/blob/main/LICENSE',
  },
  express: {
    spdx: 'MIT',
    name: 'MIT License',
    url: 'https://github.com/expressjs/express/blob/master/LICENSE',
  },
  fastify: {
    spdx: 'MIT',
    name: 'MIT License',
    url: 'https://github.com/fastify/fastify/blob/main/LICENSE',
  },
  typeorm: {
    spdx: 'MIT',
    name: 'MIT License',
    url: 'https://github.com/typeorm/typeorm/blob/master/LICENSE',
  },
  nodeRedis: {
    spdx: 'MIT',
    name: 'MIT License',
    url: 'https://github.com/redis/node-redis/blob/master/LICENSE',
  },
};

const MANIFEST = [
  {
    id: 'c0000000-0000-4000-8000-000000000001',
    slug: 'axios-http-socket-memory-leak-11091',
    title: 'Vazamento de memória em sockets HTTP',
    owner: 'axios',
    repo: 'axios',
    pullNumber: 11091,
    headSha: '4b13a79256a2c0422a4463eb30a46c29454d7a04',
    category: 'performance',
    difficulty: 'hard',
    description:
      'Move um listener de erro para o escopo do módulo para evitar retenção do contexto de requisições em sockets keep-alive.',
    license: LICENSES.axios,
  },
  {
    id: 'c0000000-0000-4000-8000-000000000002',
    slug: 'axios-nullish-interceptors-11118',
    title: 'Interceptors nulos no caminho síncrono',
    owner: 'axios',
    repo: 'axios',
    pullNumber: 11118,
    headSha: 'a56dd3c4674754f594ac4f138845003ea88283e9',
    category: 'resilience',
    difficulty: 'easy',
    description:
      'Torna a coleta de interceptors síncronos tolerante a slots nulos e adiciona cobertura de regressão.',
    license: LICENSES.axios,
  },
  {
    id: 'c0000000-0000-4000-8000-000000000003',
    slug: 'express-query-revalidation-7377',
    title: 'Revalidação condicional para QUERY',
    owner: 'expressjs',
    repo: 'express',
    pullNumber: 7377,
    headSha: '741598e4d7d2fec16d6815b59c0114d61a740702',
    category: 'api-contract',
    difficulty: 'medium',
    description:
      'Amplia a semântica de freshness do Express para o método HTTP QUERY e ajusta testes e histórico.',
    license: LICENSES.express,
  },
  {
    id: 'c0000000-0000-4000-8000-000000000004',
    slug: 'express-transfer-encoding-4893',
    title: 'Conflito entre Content-Length e Transfer-Encoding',
    owner: 'expressjs',
    repo: 'express',
    pullNumber: 4893,
    headSha: 'dddae1894b8cca5f3b8f8f429def8ecf6bb98ab8',
    category: 'http-security',
    difficulty: 'hard',
    description:
      'Evita que res.send produza simultaneamente Content-Length e Transfer-Encoding, com cobertura do contrato HTTP.',
    license: LICENSES.express,
  },
  {
    id: 'c0000000-0000-4000-8000-000000000005',
    slug: 'fastify-trust-proxy-6613',
    title: 'Trust proxy e endereço de socket ausente',
    owner: 'fastify',
    repo: 'fastify',
    pullNumber: 6613,
    headSha: '70062f1af25feab3d16697b1824e923f80d8514c',
    category: 'network-security',
    difficulty: 'hard',
    description:
      'Restaura formatos suportados de trustProxy e protege o cálculo de IP quando o socket não possui remoteAddress.',
    license: LICENSES.fastify,
  },
  {
    id: 'c0000000-0000-4000-8000-000000000006',
    slug: 'fastify-port-parsing-6603',
    title: 'Parsing estrito de portas HTTP',
    owner: 'fastify',
    repo: 'fastify',
    pullNumber: 6603,
    headSha: '9f10025c6649f31cbb69688c95c2d30e80f90af3',
    category: 'input-validation',
    difficulty: 'medium',
    description:
      'Valida portas derivadas de Host e X-Forwarded-Host para rejeitar sufixos e valores fora do intervalo válido.',
    license: LICENSES.fastify,
  },
  {
    id: 'c0000000-0000-4000-8000-000000000007',
    slug: 'typeorm-offset-count-11634',
    title: 'Contagem incorreta após offset no TypeORM',
    owner: 'typeorm',
    repo: 'typeorm',
    pullNumber: 11634,
    headSha: 'f58e56fd6f08e7afa59260473907f34f3d8d968c',
    category: 'data-correctness',
    difficulty: 'hard',
    description:
      'Corrige getManyAndCount quando o offset ultrapassa o total e adiciona cenários de paginação ao suite funcional.',
    license: LICENSES.typeorm,
  },
  {
    id: 'c0000000-0000-4000-8000-000000000008',
    slug: 'node-redis-xautoclaim-2565',
    title: 'XAUTOCLAIM após trim de mensagens pendentes',
    owner: 'redis',
    repo: 'node-redis',
    pullNumber: 2565,
    headSha: '76d36f223a0814044c4ae449f53a40aaae830dcc',
    category: 'protocol-state',
    difficulty: 'hard',
    description:
      'Atualiza o parser de XAUTOCLAIM para respostas nulas após trim e propaga o contrato pelos pacotes Redis e Bloom.',
    license: LICENSES.nodeRedis,
  },
];

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

function canonicalSnapshot(snapshot) {
  const {
    snapshotHash: _hash,
    createdAt: _created,
    analysisId: _analysis,
    ...stable
  } = snapshot;
  return JSON.stringify(canonicalize(stable));
}

function isTest(path) {
  const normalized = path.toLowerCase();
  return (
    normalized.includes('/test/') ||
    normalized.includes('/tests/') ||
    normalized.includes('/__tests__/') ||
    normalized.includes('.test.') ||
    normalized.includes('.spec.')
  );
}

function diffFor(file) {
  const previous = file.previous_filename ?? file.filename;
  const from = file.status === 'added' ? '/dev/null' : `a/${previous}`;
  const to = file.status === 'removed' ? '/dev/null' : `b/${file.filename}`;
  const patch =
    file.patch ??
    '@@ patch unavailable @@\n GitHub did not return this patch; final content remains frozen below.';
  return `diff --git a/${previous} b/${file.filename}\n--- ${from}\n+++ ${to}\n${patch}`;
}

function closestSource(testPath, sourceFiles) {
  const stem = testPath
    .split('/')
    .at(-1)
    .replace(/\.(test|spec)/, '')
    .replace(/\.[^.]+$/, '');
  return (
    sourceFiles.find((file) =>
      file.filename.split('/').at(-1).startsWith(stem),
    ) ?? sourceFiles[0]
  );
}

async function github(path) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'cast-review-curated-benchmark-generator',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub ${response.status} for ${path}`);
  }
  return response.json();
}

async function finalContent(file) {
  if (file.status === 'removed') return { content: '', truncated: false };
  const response = await fetch(file.raw_url, {
    headers: { 'User-Agent': 'cast-review-curated-benchmark-generator' },
    redirect: 'follow',
  });
  if (!response.ok)
    throw new Error(`Raw content ${response.status}: ${file.filename}`);
  const content = await response.text();
  return {
    content: content.slice(0, MAX_FILE_CONTENT),
    truncated: content.length > MAX_FILE_CONTENT,
  };
}

async function buildCase(manifest) {
  const pull = await github(
    `/repos/${manifest.owner}/${manifest.repo}/pulls/${manifest.pullNumber}`,
  );
  if (!pull.merged_at) throw new Error(`${manifest.slug} is not merged`);
  if (pull.head.sha !== manifest.headSha) {
    throw new Error(
      `${manifest.slug} head changed: expected ${manifest.headSha}, got ${pull.head.sha}`,
    );
  }

  const files = await github(
    `/repos/${manifest.owner}/${manifest.repo}/pulls/${manifest.pullNumber}/files?per_page=100`,
  );
  const contents = await Promise.all(files.map(finalContent));
  const changedFiles = files.map((file, index) => ({
    path: file.filename,
    diff: diffFor(file),
    fullContent: contents[index].content,
    relatedFiles: [],
  }));
  const diff = changedFiles.map((file) => file.diff).join('\n\n');
  const sourceFiles = files.filter((file) => !isTest(file.filename));
  const testFiles = files.filter((file) => isTest(file.filename));

  const nodes = files.map((file, index) => {
    const test = isTest(file.filename);
    const body = contents[index].content;
    return {
      id: `file:${file.filename}`,
      kind: 'file',
      path: file.filename,
      name: file.filename.split('/').at(-1),
      signature: `file ${file.filename}`,
      body: body || null,
      line: 1,
      endLine: Math.max(1, body.split('\n').length),
      contentHash: sha256(body),
      relation: test ? 'test' : 'changed',
      distance: test ? 1 : 0,
      score: test ? 0.5 : 1,
      confidence: test ? 'inferred' : 'confirmed',
      reason: test
        ? 'teste alterado no mesmo PR; relação com o código-fonte inferida pelo nome e co-change'
        : 'arquivo de código ou contrato alterado no PR',
    };
  });
  const nodeByPath = new Map(nodes.map((node) => [node.path, node]));
  const edges = testFiles
    .map((test) => {
      const source = closestSource(test.filename, sourceFiles);
      if (!source) return null;
      return {
        fromId: `file:${test.filename}`,
        toId: `file:${source.filename}`,
        kind: 'tests',
        weight: 0.5,
        confidence: 'inferred',
      };
    })
    .filter(Boolean);
  const tests = testFiles.map((file) => nodeByPath.get(file.filename));
  const changed = sourceFiles.map((file) => nodeByPath.get(file.filename));
  const repoMap = files
    .map(
      (file) =>
        `${isTest(file.filename) ? 'test' : 'changed'} ${file.filename}`,
    )
    .join('\n');
  const relatedTests = tests.map((node) => ({
    path: node.path,
    name: node.name,
    signature: node.signature,
    body: node.body,
  }));
  const relatedContext = {
    callers: [],
    callees: [],
    tests: relatedTests,
    deadCodeCandidates: [],
    repoMap,
    stats: {
      indexed: true,
      stale: false,
      indexedFiles: files.length,
      skippedFiles: 0,
      reusedFiles: 0,
      budgetUsed: Math.ceil(
        (repoMap.length +
          relatedTests.reduce(
            (sum, node) => sum + (node.body?.length ?? 0),
            0,
          )) /
          4,
      ),
      truncated: contents.some((item) => item.truncated),
    },
  };
  const graphContextBlock = [
    relatedTests.length
      ? `## Tests (testes que cobrem o código alterado)\n${relatedTests
          .map(
            (test) =>
              `### test ${test.path}::${test.name}\n${test.body ?? test.signature}`,
          )
          .join('\n\n')}`
      : '',
    `## Repo map (escopo curado: arquivos alterados)\n${repoMap}`,
  ]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 100_000);

  const inputSnapshot = {
    diffHash: sha256(diff),
    diff,
    changedFiles,
    conventions: '',
  };
  const snapshot = {
    schemaVersion: '1',
    snapshotHash: '',
    createdAt: pull.merged_at,
    analysisId: null,
    repository: {
      repoId: `${manifest.owner}/${manifest.repo}`,
      owner: manifest.owner,
      repo: manifest.repo,
      pullNumber: manifest.pullNumber,
      baseSha: pull.base.sha,
      requestedSha: pull.head.sha,
    },
    graph: {
      indexedSha: pull.head.sha,
      stale: false,
      indexerVersion: 'curated-fixture-v1',
      graphSchemaVersion: '1',
      queryVersion: 'changed-files-cochange-v1',
    },
    input: inputSnapshot,
    selected: {
      nodes,
      changedSymbols: changed,
      callers: [],
      callees: [],
      tests,
      deadCodeCandidates: [],
      repoMap,
    },
    edges,
    budget: {
      tokenBudget: 6000,
      budgetUsed: relatedContext.stats.budgetUsed,
      truncated: relatedContext.stats.truncated,
      omittedNodes: 0,
      omittedEdges: 0,
    },
    rendered: { graphContextBlock, relatedContext },
  };
  snapshot.snapshotHash = sha256(canonicalSnapshot(snapshot));

  return {
    id: manifest.id,
    slug: manifest.slug,
    title: manifest.title,
    kind: 'curated',
    evaluationMode: 'exploratory',
    ownerId: null,
    source: {
      provider: 'github',
      owner: manifest.owner,
      repo: manifest.repo,
      pullNumber: manifest.pullNumber,
      url: pull.html_url,
      originalTitle: pull.title,
      body: pull.body ?? '',
      headSha: pull.head.sha,
      baseSha: pull.base.sha,
      mergedAt: pull.merged_at,
      category: manifest.category,
      difficulty: manifest.difficulty,
      description: manifest.description,
      graphScope: 'changed-files',
      contentPolicy: `first-${MAX_FILE_CONTENT}-characters-per-file`,
      license: manifest.license,
    },
    inputSnapshot,
    graphSnapshot: snapshot,
    groundTruth: null,
    version: 1,
  };
}

const cases = [];
for (const manifest of MANIFEST) {
  process.stdout.write(`Freezing ${manifest.slug}...\n`);
  cases.push(await buildCase(manifest));
}

const generated = `/* This file is generated by scripts/generate-curated-benchmark-cases.mjs. */
import type { AnalysisContextSnapshot } from '../../analyses/analyses.types';

export type CuratedBenchmarkDifficulty = 'easy' | 'medium' | 'hard';

export interface CuratedBenchmarkSource {
  provider: 'github';
  owner: string;
  repo: string;
  pullNumber: number;
  url: string;
  originalTitle: string;
  body: string;
  headSha: string;
  baseSha: string;
  mergedAt: string;
  category: string;
  difficulty: CuratedBenchmarkDifficulty;
  description: string;
  graphScope: 'changed-files';
  contentPolicy: string;
  license: { spdx: string; name: string; url: string };
}

export interface CuratedBenchmarkFixture {
  id: string;
  slug: string;
  title: string;
  kind: 'curated';
  evaluationMode: 'exploratory';
  ownerId: null;
  source: CuratedBenchmarkSource;
  inputSnapshot: AnalysisContextSnapshot['input'];
  graphSnapshot: AnalysisContextSnapshot;
  groundTruth: null;
  version: number;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function canonicalBenchmarkSnapshot(
  snapshot: AnalysisContextSnapshot,
): string {
  const {
    snapshotHash: _snapshotHash,
    createdAt: _createdAt,
    analysisId: _analysisId,
    ...stable
  } = snapshot;
  return JSON.stringify(canonicalize(stable));
}

export const CURATED_BENCHMARK_CASES: CuratedBenchmarkFixture[] = ${JSON.stringify(cases, null, 2)};
`;

await writeFile(OUTPUT, generated, 'utf8');
process.stdout.write(`Wrote ${cases.length} cases to ${OUTPUT}\n`);
