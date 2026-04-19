export function nowTs() {
  return Date.now();
}

export function makeSessionId() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const timestamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const hex = Math.random().toString(16).slice(2, 10).padEnd(8, '0').slice(0, 8);
  return `${timestamp}_${hex}`;
}

function inferSessionMeta(sessionId) {
  const parts = String(sessionId || '').split(':');
  const source = parts[2] || 'api-server';
  const userId = parts[parts.length - 1] || null;
  return { source, userId };
}

export function upsertSession(hermes, sessionId, partial = {}) {
  const db = hermes.db;
  const existing = db.prepare('SELECT id FROM sessions WHERE id = ?').get(sessionId);
  const timestamp = nowTs();
  const inferred = inferSessionMeta(sessionId);

  if (!existing) {
    db.prepare(`
      INSERT INTO sessions (
        id, source, user_id, title, model, system_prompt, parent_session_id,
        started_at, ended_at, input_tokens, output_tokens, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, 0, ?)
    `).run(
      sessionId,
      partial.source || inferred.source || 'api-server',
      partial.userId ?? inferred.userId ?? null,
      partial.title ?? null,
      partial.model ?? null,
      partial.systemPrompt ?? null,
      partial.parentSessionId ?? null,
      partial.startedAt || timestamp,
      timestamp
    );
    return;
  }

  db.prepare(`
    UPDATE sessions
    SET
      source = COALESCE(?, source),
      user_id = COALESCE(?, user_id),
      title = COALESCE(?, title),
      model = COALESCE(?, model),
      system_prompt = COALESCE(?, system_prompt),
      parent_session_id = COALESCE(?, parent_session_id),
      ended_at = COALESCE(?, ended_at),
      input_tokens = input_tokens + ?,
      output_tokens = output_tokens + ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    partial.source || null,
    partial.userId ?? null,
    partial.title ?? null,
    partial.model ?? null,
    partial.systemPrompt ?? null,
    partial.parentSessionId ?? null,
    partial.endedAt ?? null,
    Number(partial.inputTokens || 0),
    Number(partial.outputTokens || 0),
    timestamp,
    sessionId
  );
}

export function insertMessages(hermes, sessionId, messages = []) {
  if (!Array.isArray(messages) || messages.length === 0) return 0;

  const db = hermes.db;
  const stmt = db.prepare(`
    INSERT INTO messages (session_id, role, content, tool_calls, tool_name, tool_results, token_count, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let inserted = 0;
  for (const message of messages) {
    const role = message?.role || 'assistant';
    const content = typeof message?.content === 'string'
      ? message.content
      : JSON.stringify(message?.content ?? '');
    const toolCalls = message?.tool_calls ? JSON.stringify(message.tool_calls) : null;
    const toolResults = message?.tool_results ? JSON.stringify(message.tool_results) : null;
    const toolName = message?.tool_name || null;
    const tokenCount = Number(message?.token_count || 0) || null;
    const timestamp = Number(message?.timestamp || nowTs()) || nowTs();
    stmt.run(sessionId, role, content, toolCalls, toolName, toolResults, tokenCount, timestamp);
    inserted += 1;
  }

  db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(nowTs(), sessionId);
  return inserted;
}

export function sanitizeSessionTitle(rawTitle) {
  if (rawTitle == null) return null;

  const normalized = String(rawTitle)
    .normalize('NFC')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[\u200B-\u200F\u2060\uFEFF]/g, '')
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, '')
    .trim();

  if (!normalized) return null;
  return normalized.slice(0, 100);
}

function parseToolNames(toolCallsRaw, toolNameRaw) {
  const names = new Set();
  if (toolNameRaw) names.add(String(toolNameRaw));

  if (toolCallsRaw) {
    try {
      const parsed = typeof toolCallsRaw === 'string' ? JSON.parse(toolCallsRaw) : toolCallsRaw;
      if (Array.isArray(parsed)) {
        for (const call of parsed) {
          const name = call?.function?.name || call?.name;
          if (name) names.add(String(name));
        }
      }
    } catch {
      // Ignore invalid tool call payloads in recap rendering.
    }
  }

  return Array.from(names);
}

function truncateUserContent(content) {
  const text = String(content || '').replace(/\s+/g, ' ').trim();
  if (text.length <= 300) return text;
  return `${text.slice(0, 300)}...`;
}

function truncateAssistantContent(content) {
  const lines = String(content || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const firstLines = lines.slice(0, 3).join('\n');
  if (firstLines.length > 200) return `${firstLines.slice(0, 200)}...`;
  if (lines.length > 3) return `${firstLines}...`;
  return firstLines || '';
}

export function getSessionById(hermes, sessionId) {
  const db = hermes.db;
  return db.prepare(`
    SELECT id, source, user_id, title, model, parent_session_id, started_at, ended_at, updated_at
    FROM sessions
    WHERE id = ?
  `).get(sessionId);
}

export function getLatestSessionByTitleVariant(hermes, baseTitle) {
  const db = hermes.db;
  return db.prepare(`
    SELECT id, source, user_id, title, model, parent_session_id, started_at, ended_at, updated_at
    FROM sessions
    WHERE title = ?
       OR title GLOB (? || ' #[0-9]*')
    ORDER BY COALESCE(updated_at, started_at) DESC
    LIMIT 1
  `).get(baseTitle, baseTitle);
}

function nextLineageTitle(hermes, baseTitle) {
  const db = hermes.db;
  const rows = db.prepare(`
    SELECT title
    FROM sessions
    WHERE title = ?
       OR title GLOB (? || ' #[0-9]*')
  `).all(baseTitle, baseTitle);

  let max = 1;
  for (const row of rows) {
    if (row.title === baseTitle) {
      max = Math.max(max, 1);
      continue;
    }

    const match = String(row.title || '').match(new RegExp(`^${baseTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} #(\\d+)$`));
    if (!match) continue;
    max = Math.max(max, Number(match[1]) || 1);
  }

  return `${baseTitle} #${max + 1}`;
}

export function createContinuationSession(hermes, parentId, options = {}) {
  const parent = getSessionById(hermes, parentId);
  if (!parent) {
    const error = new Error('Parent session not found');
    error.statusCode = 404;
    throw error;
  }

  const id = makeSessionId();
  const titleInput = sanitizeSessionTitle(options.title);
  const inheritedTitle = parent.title ? nextLineageTitle(hermes, parent.title) : null;
  const title = titleInput || inheritedTitle;

  upsertSession(hermes, id, {
    source: options.source || parent.source || 'api-server',
    userId: options.userId ?? parent.user_id ?? null,
    title,
    model: options.model || parent.model || null,
    parentSessionId: parent.id,
  });

  return getSessionById(hermes, id);
}

export function buildResumeRecap(hermes, sessionId) {
  const db = hermes.db;
  const rows = db.prepare(`
    SELECT role, content, tool_calls, tool_name, timestamp
    FROM messages
    WHERE session_id = ?
    ORDER BY timestamp ASC, id ASC
  `).all(sessionId);

  const relevant = rows.filter(row => row.role === 'user' || row.role === 'assistant');
  const exchanges = [];
  let current = null;

  for (const row of relevant) {
    if (row.role === 'user') {
      if (current && (current.user || current.assistant)) exchanges.push(current);
      current = {
        user: truncateUserContent(row.content),
        assistant: '',
        tool_calls: [],
        timestamp: row.timestamp || null,
      };
      continue;
    }

    if (!current) {
      current = { user: '', assistant: '', tool_calls: [], timestamp: row.timestamp || null };
    }

    const toolNames = parseToolNames(row.tool_calls, row.tool_name);
    if (toolNames.length > 0) {
      current.tool_calls = Array.from(new Set([...(current.tool_calls || []), ...toolNames]));
    }

    const assistantText = truncateAssistantContent(row.content);
    if (assistantText) {
      current.assistant = current.assistant ? `${current.assistant}\n${assistantText}` : assistantText;
    } else if (toolNames.length > 0) {
      current.assistant = `[${toolNames.length} tool calls: ${toolNames.join(', ')}]`;
    }
  }

  if (current && (current.user || current.assistant)) exchanges.push(current);

  const tail = exchanges.slice(-10);
  return {
    mode: 'full',
    hidden_exchanges_count: Math.max(0, exchanges.length - tail.length),
    exchanges: tail.map(item => ({
      user: item.user,
      assistant: item.assistant,
      tool_calls: item.tool_calls,
      timestamp: item.timestamp,
    })),
  };
}
