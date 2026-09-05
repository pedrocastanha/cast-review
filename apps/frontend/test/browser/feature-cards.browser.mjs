export default async function featureCardsBrowser(page, evidenceDir = null) {
  const projectId = 'cfc2b7a8-6b94-46f9-a7c1-55136f34df73';
  const project = { id: projectId, name: 'Cast · Teste de cards', repositories: [] };
  const content = { description: 'Acompanhar conclusão de análises', rationale: 'Dar visibilidade ao usuário', scope: ['Inbox'], outOfScope: ['Email'], businessRules: ['Privado'], acceptanceCriteria: ['Conclusão aparece na inbox'], edgeCases: ['Evento duplicado'], openQuestions: [] };
  const task = { key: 'api', title: 'Persistir notificações', area: 'Backend', description: 'Salvar o evento de conclusão', rationale: 'Permitir consulta posterior', acceptanceCriteria: ['Evento idempotente'], dependsOn: [], evidence: [], confidence: 'hypothesis' };
  const proposal = { title: 'Notificações de análises', problem: content.description, objective: content.rationale, ...content, tasks: [task, { ...task, key: 'ui', title: 'Criar central de notificações', area: 'Frontend', description: 'Exibir avisos de análises concluídas', rationale: 'Dar visibilidade ao usuário no aplicativo', dependsOn: ['api'] }] };
  const repositories = [{ repoId: 'acme/api', sha: 'abc', included: true, omissionReason: null }];
  const thread = { id: 'thread', title: 'Planejar notificações', projectId, repoId: null, scope: { mode: 'project', projectId, repositories }, messages: [] };
  let cards = [];
  let saved = false;
  const errors = [];
  const onError = (error) => errors.push(error.message);
  page.on('pageerror', onError);
  await page.addInitScript(() => localStorage.setItem('cast_review.accessToken', `test.${btoa(JSON.stringify({ sub: 'browser-test' }))}.test`));
  await page.route('http://127.0.0.1:5173/api/**', async (route) => {
    const req = route.request();
    const path = req.url().split('/api')[1].split('?')[0];
    let body;
    if (path.startsWith('/users/')) body = { id: 'browser-test', name: 'Browser Test', githubConnected: true, openaiConnected: true };
    else if (path === '/projects') body = [project];
    else if (path.endsWith('/index/status')) body = { projectId, repositories: [{ repository: 'acme/api', sha: 'abc', status: 'indexed', stale: false }] };
    else if (path === `/projects/${projectId}`) body = project;
    else if (path === '/chat/threads' && req.method() === 'POST') body = thread;
    else if (path === '/chat/threads') body = thread.messages.length ? [thread] : [];
    else if (path === '/chat/threads/thread') body = thread;
    else if (path.endsWith('/messages')) {
      const input = req.postDataJSON();
      if (input.assistanceMode !== 'requirements') throw new Error('Perfil não enviado ao servidor');
      thread.messages = [
        { id: 'user-message', role: 'user', content: input.content, mentions: [], toolCalls: [], citations: [], model: 'gpt-test' },
        { id: 'answer', role: 'assistant', content: 'Proposta estruturada.', proposal, mentions: [], toolCalls: [], citations: [], model: 'gpt-test' },
      ];
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: `data: ${JSON.stringify({ type: 'message_done', payload: thread.messages[1] })}\n\n` });
      return;
    } else if (path.endsWith('/from-message')) {
      if (!saved) {
        cards = [
          { id: 'parent', projectId, parentId: null, title: proposal.title, area: 'Feature', status: 'draft', version: 1, active: true, content, dependsOn: [], snapshot: { repositories, evidence: [], confidence: 'hypothesis' } },
          { id: 'child', projectId, parentId: 'parent', title: task.title, area: task.area, status: 'draft', version: 1, active: true, content: { ...content, description: task.description, rationale: task.rationale }, dependsOn: [], snapshot: { repositories, evidence: [], confidence: 'hypothesis' } },
          { id: 'ui', projectId, parentId: 'parent', title: 'Criar central de notificações', area: 'Frontend', status: 'draft', version: 1, active: true, content, dependsOn: ['child'], snapshot: { repositories, evidence: [], confidence: 'hypothesis' } },
        ];
        saved = true;
      }
      body = cards;
    } else if (path.endsWith('/history')) {
      body = [{ id: 'revision', version: 1, snapshot: cards.find((card) => path.includes(card.id)) }];
    } else if (req.method() === 'PATCH' && path.includes('/cards/')) {
      const patch = req.postDataJSON();
      const card = cards.find((candidate) => path.endsWith(`/${candidate.id}`));
      if (card.version !== patch.version) {
        await route.fulfill({ status: 409, json: { message: 'Versão desatualizada' } }); return;
      }
      Object.assign(card, patch, { version: card.version + 1 });
      body = card;
    } else if (path.endsWith('/cards')) body = { items: cards, nextCursor: null };
    else { await route.fulfill({ status: 404, json: { message: `Rota de teste ausente: ${path}` } }); return; }
    await route.fulfill({ status: 200, json: body });
  });
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`http://127.0.0.1:5173/chat?project=${projectId}&profile=requirements`);
    await page.getByRole('heading', { name: 'Da ideia ao plano de execução' }).waitFor();
    await page.getByPlaceholder('Pergunte sobre o código…').fill('Quero notificações ao concluir análises.');
    await page.getByRole('button', { name: 'Enviar', exact: true }).click();
    await page.getByRole('button', { name: 'Salvar proposta no Kanban' }).waitFor();
    if (evidenceDir) {
      await page.getByRole('region', { name: 'Proposta de feature' }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${evidenceDir}/01-requisitos-proposta.png`, fullPage: true });
    }
    await page.getByRole('button', { name: 'Salvar proposta no Kanban' }).click();
    await page.getByRole('link', { name: 'Cards salvos · abrir Kanban →' }).click();
    await page.getByRole('button', { name: task.title, exact: true }).click();
    await page.getByRole('textbox', { name: 'Título', exact: true }).fill('Persistir notificações com idempotência');
    await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
    await page.getByText('Alterações salvas.', { exact: true }).waitFor();
    await page.getByLabel('Mover Persistir notificações com idempotência').selectOption('ready');
    await page.getByRole('region', { name: 'Pronto', exact: true }).getByRole('button', { name: 'Persistir notificações com idempotência', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Ver histórico de edições' }).click();
    await page.getByText(/Versão 1 · Persistir notificações/).waitFor();
    if (evidenceDir) {
      await page.getByText(/Versão 1 · Persistir notificações/).click();
      await page.screenshot({ path: `${evidenceDir}/03-card-edicao-historico.png`, fullPage: true });
    }
    await page.getByRole('button', { name: 'Fechar', exact: true }).click();
    await page.getByRole('region', { name: 'Pronto', exact: true }).locator('article').dragTo(page.getByRole('region', { name: 'Em andamento', exact: true }));
    await page.getByRole('region', { name: 'Em andamento', exact: true }).getByRole('button', { name: 'Persistir notificações com idempotência', exact: true }).waitFor();
    if (evidenceDir) await page.screenshot({ path: `${evidenceDir}/02-kanban.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    if (overflow) throw new Error('Página transborda no mobile');
    if (evidenceDir) await page.screenshot({ path: `${evidenceDir}/04-kanban-mobile.png`, fullPage: true });
    if (errors.length) throw new Error(errors.join('\n'));
    return { passed: ['requirements profile', 'proposal save', 'kanban navigation', 'card editing', 'status selection', 'history', 'drag and drop', 'mobile containment'], cards: cards.length };
  } finally {
    page.off('pageerror', onError);
    await page.unroute('http://127.0.0.1:5173/api/**');
    await page.evaluate(() => localStorage.removeItem('cast_review.accessToken')).catch(() => {});
  }
}
