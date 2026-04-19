export function registerSessionRoutes({
  app,
  fs,
  path,
  buildResumeRecap,
  createContinuationSession,
  getLatestSessionByTitleVariant,
  getSessionById,
  insertMessages,
  makeSessionId,
  nowTs,
  sanitizeSessionTitle,
  upsertSession,
}) {
  app.get('/api/sessions', async (req, res) => {
    try {
      const db = req.hermes.db;
      const rows = db.prepare(`
        SELECT id, source, user_id, title, model, started_at, updated_at
        FROM sessions
        ORDER BY COALESCE(updated_at, started_at) DESC
      `).all();

      const sessions = {};
      for (const row of rows) {
        sessions[row.id] = {
          id: row.id,
          source: row.source,
          user_id: row.user_id,
          title: row.title || row.id,
          model: row.model || 'default',
          created_at: row.started_at || nowTs(),
          last_accessed: row.updated_at || row.started_at || nowTs(),
        };
      }

      res.json(sessions);
    } catch (error) {
      res.status(500).json({ error: 'Could not list sessions', details: error.message });
    }
  });

  app.post('/api/sessions', async (req, res) => {
    try {
      const parentSessionId = String(req.body?.parent_session_id || req.body?.continue_from || '').trim() || null;
      if (parentSessionId) {
        const created = createContinuationSession(req.hermes, parentSessionId, {
          source: req.body?.source ? String(req.body.source) : undefined,
          userId: req.body?.user_id ? String(req.body.user_id) : undefined,
          model: req.body?.model ? String(req.body.model) : undefined,
          title: req.body?.title ? String(req.body.title) : undefined,
        });

        return res.json({
          id: created.id,
          title: created.title || created.id,
          source: created.source || 'api-server',
          user_id: created.user_id || null,
          model: created.model || 'default',
          parent_session_id: created.parent_session_id || null,
          created_at: created.started_at || nowTs(),
          last_accessed: created.updated_at || created.started_at || nowTs(),
        });
      }

      const id = String(req.body?.id || '').trim() || makeSessionId();
      const source = String(req.body?.source || 'api-server');
      const userId = req.body?.user_id ? String(req.body.user_id) : null;
      const title = sanitizeSessionTitle(req.body?.title);
      const model = req.body?.model ? String(req.body.model) : null;
      upsertSession(req.hermes, id, { source, userId, title, model, parentSessionId: null });

      res.json({
        id,
        title: title || id,
        source,
        user_id: userId,
        model: model || 'default',
        created_at: nowTs(),
        last_accessed: nowTs(),
      });
    } catch (error) {
      if (/UNIQUE constraint failed/i.test(String(error?.message || ''))) {
        return res.status(409).json({ error: 'Session title already in use' });
      }
      if (error?.statusCode) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Could not create session', details: error.message });
    }
  });

  app.post('/api/sessions/:id/rename', async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      const title = sanitizeSessionTitle(req.body?.title);
      req.hermes.db.prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?')
        .run(title, nowTs(), id);
      res.json({ success: true, id, title });
    } catch (error) {
      if (/UNIQUE constraint failed/i.test(String(error?.message || ''))) {
        return res.status(409).json({ error: 'Session title already in use' });
      }
      res.status(500).json({ error: 'Could not rename session', details: error.message });
    }
  });

  app.get('/api/sessions/:id/title', async (req, res) => {
    try {
      const session = getSessionById(req.hermes, String(req.params.id || '').trim());
      if (!session) return res.status(404).json({ error: 'Session not found' });
      res.json({ id: session.id, title: session.title || null });
    } catch (error) {
      res.status(500).json({ error: 'Could not read session title', details: error.message });
    }
  });

  app.post('/api/sessions/:id/title', async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      const title = sanitizeSessionTitle(req.body?.title);
      const existing = req.hermes.db.prepare('SELECT id FROM sessions WHERE id = ?').get(id);
      if (!existing) return res.status(404).json({ error: 'Session not found' });
      req.hermes.db.prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?')
        .run(title, nowTs(), id);
      res.json({ success: true, id, title });
    } catch (error) {
      if (/UNIQUE constraint failed/i.test(String(error?.message || ''))) {
        return res.status(409).json({ error: 'Session title already in use' });
      }
      res.status(500).json({ error: 'Could not set session title', details: error.message });
    }
  });

  app.post('/api/sessions/:id/continue', async (req, res) => {
    try {
      const parentId = String(req.params.id || '').trim();
      const created = createContinuationSession(req.hermes, parentId, {
        source: req.body?.source ? String(req.body.source) : undefined,
        userId: req.body?.user_id ? String(req.body.user_id) : undefined,
        model: req.body?.model ? String(req.body.model) : undefined,
        title: req.body?.title ? String(req.body.title) : undefined,
      });

      res.json({
        id: created.id,
        title: created.title || created.id,
        source: created.source || 'api-server',
        user_id: created.user_id || null,
        model: created.model || 'default',
        parent_session_id: created.parent_session_id || parentId,
        created_at: created.started_at || nowTs(),
        last_accessed: created.updated_at || created.started_at || nowTs(),
      });
    } catch (error) {
      if (/UNIQUE constraint failed/i.test(String(error?.message || ''))) {
        return res.status(409).json({ error: 'Session title already in use' });
      }
      if (error?.statusCode) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Could not continue session', details: error.message });
    }
  });

  app.post('/api/sessions/resume', async (req, res) => {
    try {
      const mode = String(req.body?.mode || 'continue').toLowerCase();
      const value = String(req.body?.value || '').trim();
      const preferredSource = req.body?.source ? String(req.body.source).trim() : '';
      const db = req.hermes.db;
      let session = null;

      if (mode === 'continue') {
        if (preferredSource) {
          session = db.prepare(`
            SELECT id, source, user_id, title, model, parent_session_id, started_at, ended_at, updated_at
            FROM sessions
            WHERE source = ?
            ORDER BY COALESCE(updated_at, started_at) DESC
            LIMIT 1
          `).get(preferredSource);
        } else {
          session = db.prepare(`
            SELECT id, source, user_id, title, model, parent_session_id, started_at, ended_at, updated_at
            FROM sessions
            WHERE source IN ('cli', 'api-server')
            ORDER BY COALESCE(updated_at, started_at) DESC
            LIMIT 1
          `).get();
        }
      } else if (mode === 'resume') {
        if (!value) return res.status(400).json({ error: 'Missing resume value (session id or title)' });
        session = getSessionById(req.hermes, value);
        if (!session) {
          session = db.prepare(`
            SELECT id, source, user_id, title, model, parent_session_id, started_at, ended_at, updated_at
            FROM sessions
            WHERE title = ?
            ORDER BY COALESCE(updated_at, started_at) DESC
            LIMIT 1
          `).get(value);
        }
        if (!session) {
          session = getLatestSessionByTitleVariant(req.hermes, value);
        }
      } else {
        return res.status(400).json({ error: 'Invalid resume mode. Use continue or resume' });
      }

      if (!session) {
        return res.status(404).json({ error: 'No matching session found' });
      }

      upsertSession(req.hermes, session.id, {});
      const refreshed = getSessionById(req.hermes, session.id) || session;
      const recap = buildResumeRecap(req.hermes, session.id);
      res.json({
        session: {
          id: refreshed.id,
          source: refreshed.source || 'api-server',
          user_id: refreshed.user_id || null,
          title: refreshed.title || refreshed.id,
          model: refreshed.model || 'default',
          parent_session_id: refreshed.parent_session_id || null,
          created_at: refreshed.started_at || nowTs(),
          last_accessed: refreshed.updated_at || refreshed.started_at || nowTs(),
        },
        recap,
      });
    } catch (error) {
      res.status(500).json({ error: 'Could not resume session', details: error.message });
    }
  });

  app.post('/api/sessions/:id/messages', async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      if (!id) return res.status(400).json({ error: 'Missing session id' });
      const model = req.body?.model ? String(req.body.model) : null;
      const source = req.body?.source ? String(req.body.source) : 'api-server';
      const userId = req.body?.user_id ? String(req.body.user_id) : null;
      const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
      upsertSession(req.hermes, id, { model, source, userId });
      const inserted = insertMessages(req.hermes, id, messages);
      res.json({ success: true, inserted, session_id: id });
    } catch (error) {
      res.status(500).json({ error: 'Could not append session messages', details: error.message });
    }
  });

  app.delete('/api/sessions/:id', async (req, res) => {
    try {
      const id = req.params.id;
      req.hermes.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
      const jsonPath = path.join(req.hermes.paths.sessionsDir, `session_${id}.json`);
      const jsonlPath = path.join(req.hermes.paths.sessionsDir, `${id}.jsonl`);

      try { await fs.unlink(jsonPath); } catch {}
      try { await fs.unlink(jsonlPath); } catch {}

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Could not delete session', details: error.message });
    }
  });

  app.get('/api/sessions/:id/transcript', async (req, res) => {
    try {
      const rows = req.hermes.db.prepare(`
        SELECT role, content, tool_calls, tool_name, tool_results, token_count, timestamp
        FROM messages
        WHERE session_id = ?
        ORDER BY timestamp ASC, id ASC
      `).all(req.params.id);

      if (rows.length > 0) {
        return res.json(rows.map(row => ({
          role: row.role,
          content: row.content,
          tool_calls: row.tool_calls ? JSON.parse(row.tool_calls) : undefined,
          tool_name: row.tool_name || undefined,
          tool_results: row.tool_results ? JSON.parse(row.tool_results) : undefined,
          token_count: row.token_count || undefined,
          timestamp: row.timestamp || undefined,
        })));
      }

      const jsonlPath = path.join(req.hermes.paths.sessionsDir, `${req.params.id}.jsonl`);
      const jsonPath = path.join(req.hermes.paths.sessionsDir, `session_${req.params.id}.json`);

      try {
        const data = await fs.readFile(jsonlPath, 'utf-8');
        const lines = data.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
        return res.json(lines);
      } catch {
        const data = await fs.readFile(jsonPath, 'utf-8');
        const parsed = JSON.parse(data);
        return res.json(parsed.messages || []);
      }
    } catch {
      res.json([]);
    }
  });

  app.get('/api/sessions/stats', async (req, res) => {
    try {
      const totalSessions = req.hermes.db.prepare('SELECT COUNT(*) AS count FROM sessions').get()?.count || 0;
      const totalMessages = req.hermes.db.prepare('SELECT COUNT(*) AS count FROM messages').get()?.count || 0;
      const bySource = req.hermes.db.prepare('SELECT source, COUNT(*) AS count FROM sessions GROUP BY source ORDER BY count DESC').all();
      const dbStats = await fs.stat(req.hermes.paths.stateDb).catch(() => null);

      res.json({
        total_sessions: totalSessions,
        total_messages: totalMessages,
        by_source: bySource,
        database_size_bytes: dbStats?.size || 0,
      });
    } catch (error) {
      res.status(500).json({ error: 'Could not compute session stats', details: error.message });
    }
  });

  app.post('/api/sessions/prune', async (req, res) => {
    try {
      const olderThanDays = Math.max(1, Number(req.body?.older_than_days || 90));
      const source = req.body?.source ? String(req.body.source) : null;
      const cutoff = nowTs() - (olderThanDays * 24 * 60 * 60 * 1000);
      const params = source ? [cutoff, source] : [cutoff];
      const query = source
        ? 'DELETE FROM sessions WHERE COALESCE(ended_at, updated_at, started_at) < ? AND source = ?'
        : 'DELETE FROM sessions WHERE COALESCE(ended_at, updated_at, started_at) < ?';
      const result = req.hermes.db.prepare(query).run(...params);
      res.json({ success: true, deleted: result.changes || 0, older_than_days: olderThanDays, source });
    } catch (error) {
      res.status(500).json({ error: 'Could not prune sessions', details: error.message });
    }
  });

  app.post('/api/sessions/export', async (req, res) => {
    try {
      const source = req.body?.source ? String(req.body.source) : null;
      const sessionId = req.body?.session_id ? String(req.body.session_id) : null;
      const outputPath = req.body?.output_path ? String(req.body.output_path) : null;

      let whereClause = '';
      const args = [];
      if (source) {
        whereClause = 'WHERE s.source = ?';
        args.push(source);
      }
      if (sessionId) {
        whereClause = whereClause ? `${whereClause} AND s.id = ?` : 'WHERE s.id = ?';
        args.push(sessionId);
      }

      const sessions = req.hermes.db.prepare(`
        SELECT s.id, s.source, s.user_id, s.title, s.model, s.system_prompt, s.parent_session_id,
               s.started_at, s.ended_at, s.input_tokens, s.output_tokens, s.updated_at
        FROM sessions s
        ${whereClause}
        ORDER BY s.started_at ASC
      `).all(...args);

      const messagesStmt = req.hermes.db.prepare(`
        SELECT role, content, tool_calls, tool_name, tool_results, token_count, timestamp
        FROM messages
        WHERE session_id = ?
        ORDER BY timestamp ASC, id ASC
      `);

      const lines = sessions.map(item => JSON.stringify({
        ...item,
        messages: messagesStmt.all(item.id).map(msg => ({
          ...msg,
          tool_calls: msg.tool_calls ? JSON.parse(msg.tool_calls) : undefined,
          tool_results: msg.tool_results ? JSON.parse(msg.tool_results) : undefined,
        })),
      }));

      if (outputPath) {
        await fs.writeFile(path.resolve(outputPath), `${lines.join('\n')}\n`, 'utf-8');
        return res.json({ success: true, count: lines.length, output_path: path.resolve(outputPath) });
      }

      res.json({ count: lines.length, items: lines });
    } catch (error) {
      res.status(500).json({ error: 'Could not export sessions', details: error.message });
    }
  });
}
