import type { AgentDefinition, SkillInfo } from '../types';

const STOP_WORDS = new Set([
  'agent', 'agents', 'assistant', 'expert', 'specialist', 'manager', 'engineer',
  'developer', 'designer', 'consultant', 'system', 'systems', 'with', 'from',
  'that', 'this', 'your', 'their', 'will', 'into', 'using', 'based', 'build',
  'builds', 'create', 'creates', 'support', 'supports', 'workflow', 'process',
]);

const BLOCKED_SKILL_HINTS = ['jailbreak', 'safety-bypass', 'uncensoring', 'godmode', 'g0dmod3'];

const DIVISION_SKILL_HINTS: Record<string, string[]> = {
  academic: ['research', 'arxiv', 'paper', 'academic', 'llm-wiki', 'ocr', 'documents', 'jupyter'],
  design: ['creative', 'design', 'image-generation', 'diagram', 'visualization', 'sketch', 'excalidraw', 'p5js'],
  engineering: ['software-development', 'github', 'code-review', 'repo', 'debugging', 'tdd', 'codex', 'claude-code'],
  finance: ['airtable', 'google-workspace', 'spreadsheet', 'documents', 'nano-pdf', 'productivity'],
  'game-development': ['gaming', 'creative', 'pixel-art', 'p5js', 'design', 'architecture-diagram'],
  marketing: ['social-media', 'media', 'writing', 'humanizer', 'youtube', 'xitter', 'google-workspace'],
  'paid-media': ['google-workspace', 'airtable', 'spreadsheet', 'social-media', 'media', 'analytics'],
  product: ['linear', 'kanban', 'roadmap', 'planning', 'templates-workspaces', 'productivity'],
  'project-management': ['linear', 'kanban', 'planning', 'project', 'roadmap', 'templates-workspaces'],
  sales: ['airtable', 'google-workspace', 'himalaya', 'productivity', 'documents'],
  security: ['cybersecurity', 'cyber', 'security', 'dfir', 'blue-team', 'vulnerability', 'evidence', 'assessment'],
  'spatial-computing': ['creative', 'design', 'p5js', 'touchdesigner', 'visualization', 'mcp'],
  specialized: ['research', 'documents', 'software-development', 'productivity', 'mcp', 'creative'],
  support: ['documents', 'google-workspace', 'himalaya', 'productivity', 'ocr', 'airtable'],
  testing: ['testing', 'tdd', 'qa', 'browser', 'dogfood', 'code-review', 'software-development'],
};

const UNRELATED_CATEGORY_PENALTIES: Record<string, string[]> = {
  academic: ['creative', 'gaming', 'media', 'social-media', 'smart-home', 'leisure'],
  finance: ['creative', 'gaming', 'media', 'social-media', 'smart-home'],
  security: ['creative', 'media', 'gaming', 'leisure', 'smart-home'],
  engineering: ['leisure', 'smart-home', 'media'],
  testing: ['creative', 'media', 'gaming', 'leisure'],
};

const ML_AGENT_TERMS = ['machine learning', 'llm', 'fine tuning', 'fine-tuning', 'inference serving', 'rag', 'neural', 'ai model', 'model evaluation', 'prompt optimization'];
const ML_SKILL_TERMS = ['mlops', 'machine learning', 'fine-tuning', 'llm', 'model', 'inference', 'prompt engineering', 'huggingface', 'vllm', 'dspy', 'benchmarking'];

const DOMAIN_HINTS: Array<{
  agentTerms: string[];
  skillTerms: string[];
  score: number;
}> = [
  {
    agentTerms: ['security', 'cyber', 'dfir', 'incident', 'threat', 'pentest', 'forensic', 'vulnerability', 'red team', 'blue team', 'wifi', 'memory analysis'],
    skillTerms: ['cybersecurity', 'cyber', 'security', 'dfir', 'blue-team', 'vulnerability', 'evidence', 'assessment', 'retesting'],
    score: 34,
  },
  {
    agentTerms: ['github', 'pull request', 'repository', 'code review', 'backend', 'frontend', 'devops', 'software', 'typescript', 'python', 'api'],
    skillTerms: ['github', 'code-review', 'repo', 'software-development', 'debugging', 'tdd', 'subagent', 'codex', 'claude-code'],
    score: 26,
  },
  {
    agentTerms: ['research', 'academic', 'paper', 'science', 'historian', 'geographer', 'psychologist', 'anthropologist', 'analysis'],
    skillTerms: ['research', 'arxiv', 'paper', 'academic', 'llm-wiki', 'ocr', 'documents', 'jupyter'],
    score: 24,
  },
  {
    agentTerms: ['design', 'visual', 'image', 'brand', 'ux', 'ui', 'prototype', 'creative', 'illustration', 'diagram'],
    skillTerms: ['creative', 'design', 'image-generation', 'diagram', 'visualization', 'sketch', 'excalidraw', 'p5js'],
    score: 24,
  },
  {
    agentTerms: ['marketing', 'content', 'social', 'seo', 'campaign', 'brand', 'podcast', 'youtube', 'newsletter'],
    skillTerms: ['social-media', 'media', 'writing', 'humanizer', 'youtube', 'xitter', 'google-workspace'],
    score: 22,
  },
  {
    agentTerms: ['finance', 'accounting', 'tax', 'investment', 'revenue', 'spreadsheet', 'analytics', 'forecast'],
    skillTerms: ['productivity', 'spreadsheet', 'airtable', 'google-workspace', 'documents'],
    score: 22,
  },
  {
    agentTerms: ['project', 'roadmap', 'jira', 'kanban', 'coordination', 'operations'],
    skillTerms: ['kanban', 'linear', 'planning', 'project', 'roadmap', 'templates-workspaces'],
    score: 22,
  },
  {
    agentTerms: ['ml', 'llm', 'model', 'fine tuning', 'training', 'inference', 'rag', 'prompt', 'evaluation'],
    skillTerms: ['mlops', 'fine-tuning', 'llm', 'evaluation', 'prompt', 'huggingface', 'vllm', 'dspy'],
    score: 22,
  },
  {
    agentTerms: ['game', 'unity', 'unreal', 'godot', 'roblox', 'level', 'narrative', 'character'],
    skillTerms: ['gaming', 'creative', 'pixel-art', 'p5js', 'design', 'architecture-diagram'],
    score: 20,
  },
  {
    agentTerms: ['document', 'report', 'proposal', 'brief', 'presentation', 'deck'],
    skillTerms: ['documents', 'powerpoint', 'presentation', 'writing', 'google-workspace', 'nano-pdf'],
    score: 18,
  },
];

function normalize(value: unknown) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function tokenize(value: unknown) {
  return Array.from(new Set(
    normalize(value)
      .split(/[^a-z0-9+#.-]+/g)
      .map(token => token.replace(/^[.-]+|[.-]+$/g, ''))
      .filter(token => token.length > 2 && !STOP_WORDS.has(token)),
  ));
}

function includesAny(text: string, terms: string[]) {
  return terms.some(term => text.includes(normalize(term)));
}

function skillText(skill: SkillInfo) {
  return [
    skill.name,
    skill.description,
    skill.category,
    skill.version,
    skill.source,
    ...(skill.tags || []),
    ...(skill.platforms || []),
    ...(skill.requiresToolsets || []),
    ...(skill.fallbackForToolsets || []),
    ...(skill.requiresTools || []),
    ...(skill.fallbackForTools || []),
  ].filter(Boolean).join(' ');
}

function agentText(agent: AgentDefinition) {
  return [
    agent.name,
    agent.slug,
    agent.description,
    agent.division,
    agent.sourcePath,
    agent.vibe,
    ...(agent.tags || []),
    String(agent.soul || '').slice(0, 9000),
  ].filter(Boolean).join(' ');
}

function isSuggestableSkill(skill: SkillInfo) {
  if (skill.enabled === false) return false;
  const text = normalize(skillText(skill));
  return !BLOCKED_SKILL_HINTS.some(hint => text.includes(hint));
}

export function getAvailableSkillNames(skills: SkillInfo[]) {
  return Array.from(new Set(
    skills
      .filter(isSuggestableSkill)
      .map(skill => skill.name)
      .filter(Boolean),
  )).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
}

export function scoreSkillForAgent(agent: AgentDefinition, skill: SkillInfo) {
  if (!isSuggestableSkill(skill)) return Number.NEGATIVE_INFINITY;

  const fullAgentText = normalize(agentText(agent));
  const fullSkillText = normalize(skillText(skill));
  const agentTokens = new Set(tokenize(fullAgentText));
  const skillNameTokens = tokenize(skill.name);
  const skillMetaTokens = tokenize(fullSkillText);
  let score = 0;

  for (const token of skillNameTokens) {
    if (fullAgentText.includes(token)) score += 11;
    if (agentTokens.has(token)) score += 6;
  }

  for (const token of skillMetaTokens) {
    if (agentTokens.has(token)) score += 2;
  }

  const division = normalize(agent.division);
  const category = normalize(skill.category);
  const divisionHints = DIVISION_SKILL_HINTS[division] || [];
  if (divisionHints.length > 0 && includesAny(fullSkillText, divisionHints)) {
    score += 38;
  }
  const penalties = UNRELATED_CATEGORY_PENALTIES[division] || [];
  if (category && penalties.includes(category) && !includesAny(fullAgentText, [category, skill.name])) {
    score -= 24;
  }

  if (division && category && (division === category || category.includes(division) || division.includes(category))) {
    score += 28;
  }

  for (const tag of skill.tags || []) {
    const normalizedTag = normalize(tag);
    if (normalizedTag && fullAgentText.includes(normalizedTag)) score += 8;
  }

  for (const hint of DOMAIN_HINTS) {
    if (includesAny(fullAgentText, hint.agentTerms) && includesAny(fullSkillText, hint.skillTerms)) {
      score += hint.score;
    }
  }

  const agentIsMlRelated = includesAny(fullAgentText, ML_AGENT_TERMS);
  if (includesAny(fullSkillText, ML_SKILL_TERMS) && !agentIsMlRelated) {
    score -= category === 'mlops' ? 84 : 32;
  }
  if (/^(ml-|evaluating-llms|guidance|dspy)/.test(normalize(skill.name)) && !agentIsMlRelated) {
    score -= 84;
  }

  if (skill.source === 'local') score += 2;
  return score;
}

export function recommendSkillsForAgent(agent: AgentDefinition, skills: SkillInfo[], max = 5) {
  return skills
    .map(skill => ({ skill, score: scoreSkillForAgent(agent, skill) }))
    .filter(item => Number.isFinite(item.score) && item.score >= 18)
    .sort((left, right) => (
      right.score - left.score
      || left.skill.name.localeCompare(right.skill.name, undefined, { sensitivity: 'base' })
    ))
    .slice(0, max)
    .map(item => item.skill.name);
}
