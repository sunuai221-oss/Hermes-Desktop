function normalizeNetworkAddress(value) {
  return String(value || '')
    .trim()
    .replace(/^\[|\]$/g, '')
    .replace(/^::ffff:/, '')
    .toLowerCase();
}

function isLoopbackAddress(value) {
  const normalized = normalizeNetworkAddress(value);
  return normalized === '127.0.0.1' || normalized === '::1' || normalized === 'localhost';
}

function parseBasicAuthHeader(headerValue) {
  const header = String(headerValue || '');
  if (!header.startsWith('Basic ')) return null;

  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf-8');
    const separatorIndex = decoded.indexOf(':');
    if (separatorIndex < 0) return null;

    return {
      login: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1),
    };
  } catch {
    return null;
  }
}

export function isAllowedOrigin(origin) {
  if (!origin) return true;

  try {
    const url = new URL(origin);
    return isLoopbackAddress(url.hostname);
  } catch {
    return false;
  }
}

export function createLocalRequestChecker({ trustProxy = false } = {}) {
  return function isLocalRequest(req) {
    const forwarded = trustProxy
      ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
      : '';
    const candidate = forwarded || req.ip || req.socket?.remoteAddress || '';
    return isLoopbackAddress(candidate);
  };
}

export function createApiAuthMiddleware({
  isLocalRequest,
  apiAuthLogin = '',
  apiAuthPassword = '',
}) {
  return function apiAuthMiddleware(req, res, next) {
    if (isLocalRequest(req)) return next();

    if (!apiAuthLogin || !apiAuthPassword) {
      return res.status(503).json({
        error: 'Remote API auth is not configured. Set HERMES_API_LOGIN and HERMES_API_PASSWORD.',
      });
    }

    const creds = parseBasicAuthHeader(req.headers.authorization);
    if (!creds || creds.login !== apiAuthLogin || creds.password !== apiAuthPassword) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Hermes Gateway API"');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    return next();
  };
}
