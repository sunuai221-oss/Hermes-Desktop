function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function addMs(date, count, unit) {
  const mult = unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
  return new Date(date.getTime() + count * mult);
}

export function computeNextRunAt(schedule, paused = false) {
  if (paused) return null;
  const now = new Date();
  const trimmed = String(schedule || '').trim();
  const delayMatch = trimmed.match(/^(\d+)(m|h|d)$/i);
  if (delayMatch) {
    return addMs(now, parseInt(delayMatch[1], 10), delayMatch[2].toLowerCase()).toISOString();
  }
  const everyMatch = trimmed.match(/^every\s+(\d+)(m|h|d)$/i);
  if (everyMatch) {
    return addMs(now, parseInt(everyMatch[1], 10), everyMatch[2].toLowerCase()).toISOString();
  }
  const iso = new Date(trimmed);
  if (!Number.isNaN(iso.getTime())) return iso.toISOString();
  return null;
}

function isValidSchedule(schedule) {
  return computeNextRunAt(schedule, false) !== null;
}

function normalizeCronJob(input, existing = null) {
  const now = new Date().toISOString();
  const job = {
    id: existing?.id || `cron_${Date.now()}`,
    name: input.name || existing?.name || '',
    prompt: input.prompt ?? existing?.prompt ?? '',
    schedule: input.schedule ?? existing?.schedule ?? '',
    repeat: input.repeat ?? existing?.repeat ?? null,
    delivery: input.delivery ?? existing?.delivery ?? 'local',
    skills: Array.isArray(input.skills) ? input.skills : (existing?.skills || []),
    paused: typeof input.paused === 'boolean' ? input.paused : (existing?.paused || false),
    next_run_at: input.next_run_at ?? existing?.next_run_at ?? null,
    last_run_at: existing?.last_run_at || null,
    created_at: existing?.created_at || now,
    updated_at: now,
    force_run: existing?.force_run || false,
  };
  if (!job.next_run_at || input.schedule !== undefined || input.paused !== undefined) {
    job.next_run_at = computeNextRunAt(job.schedule, job.paused);
  }
  return job;
}

export function createCronJobsService({ fs, path }) {
  async function ensureCronDir(hermes) {
    await fs.mkdir(hermes.paths.cronOutput, { recursive: true });
  }

  async function writeJsonAtomic(targetPath, data) {
    const tmpPath = `${targetPath}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    await fs.rename(tmpPath, targetPath);
  }

  async function readCronJobsFile(hermes) {
    await ensureCronDir(hermes);
    try {
      const raw = await fs.readFile(hermes.paths.cronJobs, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return { jobs: parsed, wrapper: 'array' };
      if (Array.isArray(parsed?.jobs)) return { jobs: parsed.jobs, wrapper: 'object' };
      return { jobs: [], wrapper: 'array' };
    } catch {
      return { jobs: [], wrapper: 'array' };
    }
  }

  async function writeCronJobsFile(hermes, jobs, wrapper = 'array') {
    await ensureCronDir(hermes);
    const payload = wrapper === 'object' ? { jobs } : jobs;
    await writeJsonAtomic(hermes.paths.cronJobs, payload);
  }

  async function requireCronJob(hermes, jobId) {
    const { jobs, wrapper } = await readCronJobsFile(hermes);
    const index = jobs.findIndex(job => job.id === jobId);
    if (index < 0) {
      throw createHttpError(404, 'Cron job not found');
    }
    return { jobs, wrapper, index, job: jobs[index] };
  }

  async function listCronJobs(hermes) {
    const { jobs } = await readCronJobsFile(hermes);
    return jobs;
  }

  async function createCronJob(hermes, payload = {}) {
    const { jobs, wrapper } = await readCronJobsFile(hermes);
    if (!isValidSchedule(payload.schedule)) {
      throw createHttpError(400, 'Invalid schedule format. Supported: "15m", "2h", "1d", "every 30m", or ISO datetime.');
    }
    const job = normalizeCronJob(payload);
    jobs.push(job);
    await writeCronJobsFile(hermes, jobs, wrapper);
    return job;
  }

  async function updateCronJob(hermes, jobId, payload = {}) {
    const { jobs, wrapper, index, job } = await requireCronJob(hermes, jobId);
    if (payload.schedule !== undefined && !isValidSchedule(payload.schedule)) {
      throw createHttpError(400, 'Invalid schedule format. Supported: "15m", "2h", "1d", "every 30m", or ISO datetime.');
    }
    jobs[index] = normalizeCronJob(payload, job);
    await writeCronJobsFile(hermes, jobs, wrapper);
    return jobs[index];
  }

  async function pauseCronJob(hermes, jobId) {
    const { jobs, wrapper, job } = await requireCronJob(hermes, jobId);
    job.paused = true;
    job.next_run_at = null;
    job.updated_at = new Date().toISOString();
    await writeCronJobsFile(hermes, jobs, wrapper);
    return { success: true };
  }

  async function resumeCronJob(hermes, jobId) {
    const { jobs, wrapper, job } = await requireCronJob(hermes, jobId);
    job.paused = false;
    job.next_run_at = computeNextRunAt(job.schedule, false);
    job.updated_at = new Date().toISOString();
    await writeCronJobsFile(hermes, jobs, wrapper);
    return { success: true };
  }

  async function runCronJob(hermes, jobId) {
    const { jobs, wrapper, job } = await requireCronJob(hermes, jobId);
    job.force_run = true;
    job.next_run_at = new Date().toISOString();
    job.updated_at = new Date().toISOString();
    await writeCronJobsFile(hermes, jobs, wrapper);
    return { success: true };
  }

  async function removeCronJob(hermes, jobId) {
    const { jobs, wrapper } = await readCronJobsFile(hermes);
    const next = jobs.filter(item => item.id !== jobId);
    await writeCronJobsFile(hermes, next, wrapper);
    return { success: true };
  }

  async function listCronOutputs(hermes, jobId = null) {
    await ensureCronDir(hermes);
    const outputs = [];
    const jobDirs = await fs.readdir(hermes.paths.cronOutput, { withFileTypes: true }).catch(() => []);
    for (const dir of jobDirs) {
      if (!dir.isDirectory()) continue;
      if (jobId && dir.name !== jobId) continue;
      const fullDir = path.join(hermes.paths.cronOutput, dir.name);
      const files = await fs.readdir(fullDir, { withFileTypes: true }).catch(() => []);
      for (const file of files) {
        if (!file.isFile()) continue;
        const fullPath = path.join(fullDir, file.name);
        const stat = await fs.stat(fullPath).catch(() => null);
        const content = await fs.readFile(fullPath, 'utf-8').catch(() => '');
        outputs.push({
          jobId: dir.name,
          path: fullPath,
          fileName: file.name,
          modifiedAt: stat?.mtime?.toISOString?.() || new Date().toISOString(),
          contentPreview: content.slice(0, 2000),
        });
      }
    }
    return outputs.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());
  }

  return {
    listCronJobs,
    createCronJob,
    updateCronJob,
    pauseCronJob,
    resumeCronJob,
    runCronJob,
    removeCronJob,
    listCronOutputs,
  };
}
