async function ensureMemoriesDir(fs, hermes) {
  await fs.mkdir(hermes.paths.memories, { recursive: true });
}

async function getMemoryStores({ fs, skillsService, hermes }) {
  const config = await skillsService.readConfigForSkills(hermes);
  await ensureMemoriesDir(fs, hermes);

  const [memoryContent, userContent] = await Promise.all([
    fs.readFile(hermes.paths.memory, 'utf-8').catch(() => ''),
    fs.readFile(hermes.paths.userMemory, 'utf-8').catch(() => ''),
  ]);

  const memoryLimit = config?.memory?.memory_char_limit ?? 2200;
  const userLimit = config?.memory?.user_char_limit ?? 1375;

  return [
    {
      target: 'memory',
      path: hermes.paths.memory,
      content: memoryContent,
      charLimit: memoryLimit,
      charCount: memoryContent.length,
      usagePercent: Math.min(100, Math.round((memoryContent.length / memoryLimit) * 100) || 0),
    },
    {
      target: 'user',
      path: hermes.paths.userMemory,
      content: userContent,
      charLimit: userLimit,
      charCount: userContent.length,
      usagePercent: Math.min(100, Math.round((userContent.length / userLimit) * 100) || 0),
    },
  ];
}

export function registerIdentityRoutes({ app, fs, skillsService }) {
  app.get('/api/soul', async (req, res) => {
    try {
      const data = await fs.readFile(req.hermes.paths.soul, 'utf-8');
      res.json({ content: data });
    } catch {
      res.status(500).json({ error: 'Could not read SOUL.md' });
    }
  });

  app.post('/api/soul', async (req, res) => {
    try {
      await fs.writeFile(req.hermes.paths.soul, req.body.content, 'utf-8');
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: 'Could not write SOUL.md' });
    }
  });

  app.get('/api/memory', async (req, res) => {
    try {
      res.json(await getMemoryStores({ fs, skillsService, hermes: req.hermes }));
    } catch (error) {
      res.status(500).json({ error: 'Could not read memory stores', details: error.message });
    }
  });

  app.post('/api/memory', async (req, res) => {
    try {
      const target = req.body?.target === 'user' ? 'user' : 'memory';
      const content = typeof req.body?.content === 'string' ? req.body.content : '';
      const stores = await getMemoryStores({ fs, skillsService, hermes: req.hermes });
      const store = stores.find(item => item.target === target);

      if (!store) {
        return res.status(400).json({ error: 'Unknown memory target' });
      }

      if (content.length > store.charLimit) {
        return res.status(400).json({
          error: `Memory at ${content.length}/${store.charLimit} chars. Trim content before saving.`,
        });
      }

      await ensureMemoriesDir(fs, req.hermes);
      await fs.writeFile(
        target === 'user' ? req.hermes.paths.userMemory : req.hermes.paths.memory,
        content,
        'utf-8'
      );
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Could not write memory store', details: error.message });
    }
  });

  app.get('/api/memory/search', async (req, res) => {
    try {
      const query = String(req.query?.q || '').trim();
      if (!query) return res.json([]);
      const db = req.hermes.db;
      const ftsQuery = query
        .replace(/[^\p{L}\p{N}\s_*"'-]/gu, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map(token => (token.includes('"') || token.includes('*')) ? token : `${token}*`)
        .join(' ');
      const rows = db.prepare(`
        SELECT
          m.session_id AS sessionId,
          s.source AS platform,
          m.role AS role,
          m.content AS content,
          m.timestamp AS timestamp
        FROM messages_fts f
        JOIN messages m ON m.id = f.rowid
        JOIN sessions s ON s.id = m.session_id
        WHERE f.content MATCH ?
        ORDER BY rank
        LIMIT 25
      `).all(ftsQuery || query);
      const lowered = query.toLowerCase();
      const results = rows.map(row => {
        const content = String(row.content || '');
        const index = Math.max(0, content.toLowerCase().indexOf(lowered));
        return {
          sessionId: row.sessionId,
          platform: row.platform || 'unknown',
          role: row.role || 'unknown',
          snippet: content.slice(Math.max(0, index - 80), index + lowered.length + 160),
          timestamp: row.timestamp,
        };
      });
      res.json(results);
    } catch (error) {
      res.status(500).json({ error: 'Could not search session history', details: error.message });
    }
  });
}
