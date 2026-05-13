import * as kanbanService from '../services/kanban.mjs';

export function registerKanbanRoutes({ app }) {
  app.get('/api/kanban/boards', async (req, res) => {
    try {
      res.json(await kanbanService.listBoards(req.hermes));
    } catch (error) {
      kanbanService.sendKanbanError(res, error);
    }
  });

  app.post('/api/kanban/boards', async (req, res) => {
    try {
      res.status(201).json(await kanbanService.createBoard(req.hermes, req.body || {}));
    } catch (error) {
      if (String(error?.message || '').includes('Board slug is required')) return res.status(400).json({ error: 'Board slug is required' });
      kanbanService.sendKanbanError(res, error);
    }
  });

  app.post('/api/kanban/boards/:slug/switch', async (req, res) => {
    try {
      res.json(await kanbanService.switchBoard(req.hermes, req.params.slug));
    } catch (error) {
      kanbanService.sendKanbanError(res, error);
    }
  });

  app.get('/api/kanban/tasks', async (req, res) => {
    try {
      res.json(await kanbanService.listTasks(req.hermes, req.query || {}));
    } catch (error) {
      kanbanService.sendKanbanError(res, error);
    }
  });

  app.post('/api/kanban/tasks', async (req, res) => {
    try {
      res.status(201).json(await kanbanService.createTask(req.hermes, req.body || {}));
    } catch (error) {
      if (String(error?.message || '').includes('Task title is required')) return res.status(400).json({ error: 'Task title is required' });
      kanbanService.sendKanbanError(res, error);
    }
  });

  app.get('/api/kanban/tasks/:taskId', async (req, res) => {
    try {
      res.json(await kanbanService.showTask(req.hermes, req.query?.board, req.params.taskId));
    } catch (error) {
      kanbanService.sendKanbanError(res, error);
    }
  });

  app.get('/api/kanban/tasks/:taskId/log', async (req, res) => {
    try {
      res.json(await kanbanService.taskLog(req.hermes, req.query?.board, req.params.taskId, req.query?.tail || 12000));
    } catch (error) {
      kanbanService.sendKanbanError(res, error);
    }
  });

  app.post('/api/kanban/tasks/:taskId/assign', async (req, res) => {
    try {
      const assignee = String(req.body?.assignee || '').trim() || 'none';
      res.json(await kanbanService.taskAction(req.hermes, req.body?.board || req.query?.board, req.params.taskId, ['assign', req.params.taskId, assignee]));
    } catch (error) {
      kanbanService.sendKanbanError(res, error);
    }
  });

  app.post('/api/kanban/tasks/:taskId/status', async (req, res) => {
    const status = String(req.body?.status || '').trim();
    if (!kanbanService.VALID_STATUSES.has(status)) return res.status(400).json({ error: 'Valid task status is required' });

    try {
      const board = req.body?.board || req.query?.board;
      await kanbanService.transitionTaskStatus(req.hermes, board, req.params.taskId, status, req.body || {});
      res.json(await kanbanService.showTask(req.hermes, board, req.params.taskId));
    } catch (error) {
      kanbanService.sendKanbanError(res, error);
    }
  });

  app.post('/api/kanban/tasks/:taskId/comment', async (req, res) => {
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Comment text is required' });
    try {
      res.json(await kanbanService.taskAction(req.hermes, req.body?.board || req.query?.board, req.params.taskId, ['comment', req.params.taskId, text, '--author', String(req.body?.author || 'desktop')]));
    } catch (error) {
      kanbanService.sendKanbanError(res, error);
    }
  });

  app.post('/api/kanban/tasks/:taskId/complete', async (req, res) => {
    try {
      const args = ['complete', req.params.taskId];
      if (req.body?.result) args.push('--result', String(req.body.result));
      if (req.body?.summary) args.push('--summary', String(req.body.summary));
      if (req.body?.metadata && typeof req.body.metadata === 'object') args.push('--metadata', JSON.stringify(req.body.metadata));
      res.json(await kanbanService.taskAction(req.hermes, req.body?.board || req.query?.board, req.params.taskId, args));
    } catch (error) {
      kanbanService.sendKanbanError(res, error);
    }
  });

  app.post('/api/kanban/tasks/:taskId/block', async (req, res) => {
    try {
      const reason = String(req.body?.reason || '').trim();
      res.json(await kanbanService.taskAction(req.hermes, req.body?.board || req.query?.board, req.params.taskId, reason ? ['block', req.params.taskId, reason] : ['block', req.params.taskId]));
    } catch (error) {
      kanbanService.sendKanbanError(res, error);
    }
  });

  app.post('/api/kanban/tasks/:taskId/unblock', async (req, res) => {
    try {
      res.json(await kanbanService.taskAction(req.hermes, req.body?.board || req.query?.board, req.params.taskId, ['unblock', req.params.taskId]));
    } catch (error) {
      kanbanService.sendKanbanError(res, error);
    }
  });

  app.post('/api/kanban/tasks/:taskId/archive', async (req, res) => {
    try {
      res.json(await kanbanService.taskAction(req.hermes, req.body?.board || req.query?.board, req.params.taskId, ['archive', req.params.taskId]));
    } catch (error) {
      kanbanService.sendKanbanError(res, error);
    }
  });

  app.post('/api/kanban/tasks/:taskId/reclaim', async (req, res) => {
    try {
      const args = ['reclaim', req.params.taskId];
      if (req.body?.reason) args.push('--reason', String(req.body.reason));
      res.json(await kanbanService.taskAction(req.hermes, req.body?.board || req.query?.board, req.params.taskId, args));
    } catch (error) {
      kanbanService.sendKanbanError(res, error);
    }
  });

  app.get('/api/kanban/stats', async (req, res) => {
    try {
      res.json(await kanbanService.stats(req.hermes, req.query?.board));
    } catch (error) {
      kanbanService.sendKanbanError(res, error);
    }
  });

  app.get('/api/kanban/assignees', async (req, res) => {
    try {
      res.json(await kanbanService.assignees(req.hermes, req.query?.board));
    } catch (error) {
      kanbanService.sendKanbanError(res, error);
    }
  });

  app.get('/api/kanban/diagnostics', async (req, res) => {
    try {
      // Internal diagnostics endpoint: currently not part of the primary frontend facade.
      res.json(await kanbanService.diagnostics(req.hermes, req.query || {}));
    } catch (error) {
      kanbanService.sendKanbanError(res, error);
    }
  });
}
