import type { AgentDefinition, AgentWorkspace, WorkspaceAgentRole, WorkspaceEdgeKind } from '../../../types';

// ── Types ─────────────────────────────────────────────────────────────

export interface TeamNodeDef {
  /** Exact name of the agent template to match (case-insensitive) */
  agentName: string;
  role: WorkspaceAgentRole;
  label?: string;
  toolsets?: string[];
}

export interface TeamEdgeDef {
  /** Index into the nodes array (0-based) of the source node */
  fromIndex: number;
  /** Index into the nodes array (0-based) of the target node */
  toIndex: number;
  kind: WorkspaceEdgeKind;
}

export interface TeamDefinition {
  id: string;
  name: string;
  description: string;
  theme: TeamThemeId;
  icon: string;
  color: string;
  pipelineBrief: string;
  sharedContext?: string;
  commonRules?: string;
  defaultMode: AgentWorkspace['defaultMode'];
  nodes: TeamNodeDef[];
  edges: TeamEdgeDef[];
}

export type TeamThemeId = 'build' | 'growth' | 'security' | 'operations' | 'creative' | 'business' | 'research';

export interface TeamTheme {
  id: TeamThemeId;
  label: string;
  description: string;
}

export const TEAM_THEMES: TeamTheme[] = [
  {
    id: 'build',
    label: 'Build & Product',
    description: 'Produit, sprint, engineering et livraison applicative.',
  },
  {
    id: 'growth',
    label: 'Growth & Content',
    description: 'Marketing, acquisition, contenu et distribution.',
  },
  {
    id: 'security',
    label: 'Security & Trust',
    description: 'Audit, incident response, pentest et conformité.',
  },
  {
    id: 'operations',
    label: 'Ops & Intelligence',
    description: 'Data, infrastructure, support interne et automatisation.',
  },
  {
    id: 'creative',
    label: 'Creative & Immersive',
    description: 'Design, jeux, XR et expériences interactives.',
  },
  {
    id: 'business',
    label: 'Business & Customer',
    description: 'Sales, service client, onboarding et fonctions métier.',
  },
  {
    id: 'research',
    label: 'Research & Strategy',
    description: 'Découverte, synthèse, stratégie et décisions amont.',
  },
];

// ── Layout helper ─────────────────────────────────────────────────────

const CARD_W = 236;
const CARD_H = 120;
const GAP_X = 80;
const GAP_Y = 60;

/**
 * Returns auto-layout positions for N nodes arranged in a left-to-right
 * flow that wraps into 2 rows if there are more than 4 nodes.
 * Nodes are placed so edges flow naturally left→right.
 */
function autoLayout(nodeCount: number, startX = 20, startY = 20) {
  const positions: { x: number; y: number }[] = [];
  const perRow = Math.min(nodeCount, Math.ceil(nodeCount / 2));
  for (let i = 0; i < nodeCount; i++) {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    positions.push({
      x: startX + col * (CARD_W + GAP_X),
      y: startY + row * (CARD_H + GAP_Y),
    });
  }
  return positions;
}

// ── Team definitions ──────────────────────────────────────────────────

export const TEAMS: TeamDefinition[] = [
  {
    id: 'mvp-builder',
    name: 'MVP Builder',
    description:
      'Lance un produit minimum viable : du sprint planning au déploiement, avec code review et QA.',
    theme: 'build',
    icon: '🚀',
    color: 'blue',
    pipelineBrief:
      'Break the project into sprints → Backend Architect designs the API and data model → Frontend Developer builds the UI → Code Review validates both sides → API Tester validates all endpoints → escalate issues back to the PM.',
    sharedContext:
      'We are building an MVP. Speed matters, but quality gates must be respected at each stage. The Sprint Prioritizer defines the scope and timeline. All agents should reference the sprint plan and research brief.',
    commonRules:
      "1. Quality gates are mandatory — no phase advances without passing review.\n2. When a task fails review, include specific feedback and retry.\n3. Keep the scope minimal — only build what's in the current sprint.",
    defaultMode: 'delegate',
    nodes: [
      { agentName: 'Sprint Prioritizer', role: 'orchestrator', label: 'PM' },
      { agentName: 'Backend Architect', role: 'worker', label: 'API Design' },
      { agentName: 'Frontend Developer', role: 'worker', label: 'UI Build' },
      { agentName: 'Code Reviewer', role: 'reviewer', label: 'Code Review' },
      { agentName: 'API Tester', role: 'qa', label: 'QA' },
    ],
    edges: [
      { fromIndex: 0, toIndex: 1, kind: 'handoff' },
      { fromIndex: 0, toIndex: 2, kind: 'handoff' },
      { fromIndex: 1, toIndex: 3, kind: 'review' },
      { fromIndex: 2, toIndex: 3, kind: 'review' },
      { fromIndex: 3, toIndex: 4, kind: 'qa' },
      { fromIndex: 4, toIndex: 0, kind: 'escalation' },
    ],
  },

  {
    id: 'bug-bash',
    name: 'Bug Bash',
    description:
      'Triage, correction et validation de bugs. Un senior dev orchestre, un reviewer valide, un testeur vérifie la régression.',
    theme: 'build',
    icon: '🐛',
    color: 'red',
    pipelineBrief:
      'Senior Developer trie et corrige le bug → Code Reviewer valide l\'approche → API Tester vérifie qu\'il n\'y a pas de régression → Reality Checker confirme le correctif en conditions réelles.',
    sharedContext:
      'This is a bug-fix sprint. The Senior Developer drives the fix. Every fix must be reviewed before it is considered complete. Regression testing is mandatory.',
    commonRules:
      "1. Start by reproducing the bug — understanding it is half the fix.\n2. Every fix must include a test that would catch the regression.\n3. If the bug is in production, prioritize a hotfix path first.",
    defaultMode: 'delegate',
    nodes: [
      { agentName: 'Senior Developer', role: 'orchestrator', label: 'Fix Lead' },
      { agentName: 'Code Reviewer', role: 'reviewer', label: 'Review' },
      { agentName: 'API Tester', role: 'qa', label: 'Regression QA' },
      { agentName: 'Reality Checker', role: 'observer', label: 'Gatekeeper' },
    ],
    edges: [
      { fromIndex: 0, toIndex: 1, kind: 'review' },
      { fromIndex: 1, toIndex: 2, kind: 'qa' },
      { fromIndex: 2, toIndex: 3, kind: 'handoff' },
      { fromIndex: 3, toIndex: 0, kind: 'escalation' },
    ],
  },

  {
    id: 'content-engine',
    name: 'Content Engine',
    description:
      'Pipeline de création de contenu marketing : rédaction, optimisation SEO, validation de marque et distribution.',
    theme: 'growth',
    icon: '📝',
    color: 'green',
    pipelineBrief:
      'Content Creator rédige le contenu → Brand Guardian vérifie la voix et le ton → SEO Specialist optimise le référencement → Brand Guardian valide la version finale → Social Media Strategist planifie la distribution.',
    sharedContext:
      'We produce content that is on-brand, SEO-optimised, and ready for multi-channel distribution. Every piece must pass brand review before publication.',
    commonRules:
      "1. Brand voice and tone are non-negotiable — Brand Guardian has final approval.\n2. SEO optimisation must not compromise readability.\n3. Content must be adaptable to at least 2 distribution channels.",
    defaultMode: 'delegate',
    nodes: [
      { agentName: 'Content Creator', role: 'orchestrator', label: 'Writer' },
      { agentName: 'SEO Specialist', role: 'worker', label: 'SEO' },
      { agentName: 'Brand Guardian', role: 'reviewer', label: 'Brand Review' },
      { agentName: 'Social Media Strategist', role: 'observer', label: 'Distribution' },
    ],
    edges: [
      { fromIndex: 0, toIndex: 2, kind: 'review' },
      { fromIndex: 0, toIndex: 1, kind: 'handoff' },
      { fromIndex: 1, toIndex: 2, kind: 'review' },
      { fromIndex: 2, toIndex: 0, kind: 'escalation' },
      { fromIndex: 2, toIndex: 3, kind: 'broadcast' },
    ],
  },

  {
    id: 'product-launch',
    name: 'Full Product Launch',
    description:
      'Lancement complet : du PM à la mise sur le marché, en passant par le design, le dev, la QA et le marketing.',
    theme: 'build',
    icon: '🎯',
    color: 'purple',
    pipelineBrief:
      'PM définit le scope → UI Designer conçoit les maquettes → Backend Architect construit l\'API → Frontend Developer intègre → Code Review + QA valident l\'ensemble → Growth Hacker prépare le lancement → Content Creator rédige les annonces.',
    sharedContext:
      'Full product launch across engineering, design, marketing, and sales. The PM owns the timeline. Quality gates must be respected. Marketing content runs in parallel with development.',
    commonRules:
      "1. The PM's scope document is the source of truth — don't add features not in scope.\n2. UI must be approved before frontend implementation begins.\n3. Marketing content is prepared in parallel but only published after QA sign-off.",
    defaultMode: 'delegate',
    nodes: [
      { agentName: 'Sprint Prioritizer', role: 'orchestrator', label: 'Orchestrator' },
      { agentName: 'Product Manager', role: 'worker', label: 'PM' },
      { agentName: 'UI Designer', role: 'worker', label: 'Design' },
      { agentName: 'Backend Architect', role: 'worker', label: 'Backend' },
      { agentName: 'Frontend Developer', role: 'worker', label: 'Frontend' },
      { agentName: 'Code Reviewer', role: 'reviewer', label: 'Code Review' },
      { agentName: 'API Tester', role: 'qa', label: 'QA' },
      { agentName: 'Growth Hacker', role: 'observer', label: 'GTM' },
      { agentName: 'Content Creator', role: 'worker', label: 'Marketing Content' },
    ],
    edges: [
      { fromIndex: 0, toIndex: 1, kind: 'handoff' },
      { fromIndex: 1, toIndex: 2, kind: 'handoff' },
      { fromIndex: 1, toIndex: 3, kind: 'handoff' },
      { fromIndex: 2, toIndex: 4, kind: 'handoff' },
      { fromIndex: 3, toIndex: 4, kind: 'handoff' },
      { fromIndex: 4, toIndex: 5, kind: 'review' },
      { fromIndex: 3, toIndex: 5, kind: 'review' },
      { fromIndex: 5, toIndex: 6, kind: 'qa' },
      { fromIndex: 6, toIndex: 0, kind: 'escalation' },
      { fromIndex: 6, toIndex: 7, kind: 'broadcast' },
      { fromIndex: 1, toIndex: 8, kind: 'handoff' },
    ],
  },

  {
    id: 'security-review',
    name: 'Security & Compliance Review',
    description:
      'Audit de sécurité complet : analyse de code, vérification des conformités réglementaires, détection de menaces.',
    theme: 'security',
    icon: '🛡️',
    color: 'amber',
    pipelineBrief:
      'Security Engineer audite le code et l\'infrastructure → Code Reviewer examine la surface d\'attaque → Compliance Auditor vérifie les exigences réglementaires → Threat Detection Engineer consolide tous les findings dans un rapport.',
    sharedContext:
      'Security audit across codebase, infrastructure, and compliance. All findings must be categorised by severity. Critical and High findings block deployment.',
    commonRules:
      "1. Use OWASP Top 10 and OWASP API Security Top 10 as reference.\n2. Every finding must include: severity, location, impact, and remediation.\n3. False positives are acceptable but must be documented with justification.",
    defaultMode: 'delegate',
    nodes: [
      { agentName: 'Security Engineer', role: 'orchestrator', label: 'Audit Lead' },
      { agentName: 'Code Reviewer', role: 'reviewer', label: 'Code Review' },
      { agentName: 'Compliance Auditor', role: 'qa', label: 'Compliance' },
      { agentName: 'Threat Detection Engineer', role: 'observer', label: 'Findings' },
    ],
    edges: [
      { fromIndex: 0, toIndex: 1, kind: 'handoff' },
      { fromIndex: 1, toIndex: 2, kind: 'qa' },
      { fromIndex: 2, toIndex: 0, kind: 'escalation' },
      { fromIndex: 0, toIndex: 3, kind: 'broadcast' },
    ],
  },

  {
    id: 'devops-pipeline',
    name: 'DevOps Pipeline',
    description:
      'Mise en place et optimisation de l\'infrastructure : CI/CD, monitoring, sécurité, performance.',
    theme: 'operations',
    icon: '⚙️',
    color: 'cyan',
    pipelineBrief:
      'SRE définit l\'architecture d\'infrastructure → DevOps Automator configure les pipelines et l\'automatisation → Security Engineer audite la configuration → Performance Benchmarker valide les métriques de performance → SRE approuve la mise en production.',
    sharedContext:
      'Infrastructure-as-code first approach. Every change must be reviewed for security and performance impact before reaching production.',
    commonRules:
      "1. All infrastructure must be defined as code (Terraform, Pulumi, or similar).\n2. Security scanning is mandatory before any production deployment.\n3. Performance baselines must be established before and after changes.",
    defaultMode: 'delegate',
    nodes: [
      { agentName: 'SRE (Site Reliability Engineer)', role: 'orchestrator', label: 'Infra Lead' },
      { agentName: 'DevOps Automator', role: 'worker', label: 'Automation' },
      { agentName: 'Security Engineer', role: 'reviewer', label: 'Security Review' },
      { agentName: 'Performance Benchmarker', role: 'qa', label: 'Performance' },
    ],
    edges: [
      { fromIndex: 0, toIndex: 1, kind: 'handoff' },
      { fromIndex: 1, toIndex: 2, kind: 'review' },
      { fromIndex: 2, toIndex: 0, kind: 'escalation' },
      { fromIndex: 1, toIndex: 3, kind: 'qa' },
      { fromIndex: 3, toIndex: 0, kind: 'broadcast' },
    ],
  },

  {
    id: 'docs-onboarding',
    name: 'Documentation & Onboarding',
    description:
      'Crée une documentation complète couvrant le code, l\'infrastructure et l\'onboarding des nouveaux développeurs.',
    theme: 'operations',
    icon: '📖',
    color: 'indigo',
    pipelineBrief:
      'Technical Writer rédige la documentation → Senior Developer vérifie l\'exactitude technique → Codebase Onboarding Engineer ajoute des exemples concrets et du contexte → Reality Checker teste que la doc est compréhensible par un nouveau développeur.',
    sharedContext:
      'Documentation must be accurate, complete, and accessible to developers who are new to the project. The Senior Developer is the authority on technical accuracy.',
    commonRules:
      "1. Every code example must be tested and runnable.\n2. Assume the reader has development experience but no project-specific context.\n3. Include at least one troubleshooting section per major topic.",
    defaultMode: 'delegate',
    nodes: [
      { agentName: 'Technical Writer', role: 'orchestrator', label: 'Writer' },
      { agentName: 'Senior Developer', role: 'reviewer', label: 'Tech Review' },
      { agentName: 'Codebase Onboarding Engineer', role: 'worker', label: 'Examples & Context' },
      { agentName: 'Reality Checker', role: 'qa', label: 'Reader Test' },
    ],
    edges: [
      { fromIndex: 0, toIndex: 1, kind: 'review' },
      { fromIndex: 1, toIndex: 2, kind: 'handoff' },
      { fromIndex: 2, toIndex: 0, kind: 'broadcast' },
      { fromIndex: 2, toIndex: 3, kind: 'qa' },
      { fromIndex: 3, toIndex: 0, kind: 'escalation' },
    ],
  },

  {
    id: 'discovery-sprint',
    name: 'Discovery Sprint',
    description:
      'Recherche utilisateur, tendances marché, priorisation produit et synthèse décisionnelle.',
    theme: 'research',
    icon: '🔎',
    color: 'cyan',
    pipelineBrief:
      'Trend Researcher cartographie le marché → UX Researcher collecte les besoins utilisateurs → Product Manager transforme les insights en options produit → Feedback Synthesizer consolide les signaux → Executive Summary Generator produit une note de décision.',
    sharedContext:
      'This workspace is for early product discovery. The goal is to reduce uncertainty before implementation. Evidence, user signals, and clear trade-offs matter more than feature volume.',
    commonRules:
      '1. Separate evidence from assumptions.\n2. Every recommendation must include the confidence level and the source of insight.\n3. End with a short decision memo that a product lead can act on.',
    defaultMode: 'delegate',
    nodes: [
      { agentName: 'Trend Researcher', role: 'orchestrator', label: 'Market Scan' },
      { agentName: 'UX Researcher', role: 'worker', label: 'User Needs' },
      { agentName: 'Product Manager', role: 'worker', label: 'Product Options' },
      { agentName: 'Feedback Synthesizer', role: 'reviewer', label: 'Signal Review' },
      { agentName: 'Executive Summary Generator', role: 'observer', label: 'Decision Memo' },
    ],
    edges: [
      { fromIndex: 0, toIndex: 1, kind: 'handoff' },
      { fromIndex: 0, toIndex: 2, kind: 'handoff' },
      { fromIndex: 1, toIndex: 3, kind: 'review' },
      { fromIndex: 2, toIndex: 3, kind: 'review' },
      { fromIndex: 3, toIndex: 4, kind: 'broadcast' },
      { fromIndex: 4, toIndex: 2, kind: 'escalation' },
    ],
  },

  {
    id: 'ai-feature-lab',
    name: 'AI Feature Lab',
    description:
      'Conçoit et valide une fonctionnalité IA : architecture, intégration, QA modèle et revue code.',
    theme: 'build',
    icon: '🧠',
    color: 'indigo',
    pipelineBrief:
      'AI Engineer définit la capacité IA → Software Architect pose l’architecture → Backend Architect et Frontend Developer implémentent → Code Reviewer vérifie la qualité → Model QA Specialist valide les réponses et les limites.',
    sharedContext:
      'We are building an AI-powered feature. The feature must be useful, testable, explainable to users, and resilient to malformed inputs.',
    commonRules:
      '1. Define expected model behavior before implementation.\n2. Include fallback and failure states in the product flow.\n3. Model QA must include edge cases, refusal cases, and user-facing quality checks.',
    defaultMode: 'delegate',
    nodes: [
      { agentName: 'AI Engineer', role: 'orchestrator', label: 'AI Lead' },
      { agentName: 'Software Architect', role: 'worker', label: 'Architecture' },
      { agentName: 'Backend Architect', role: 'worker', label: 'Backend' },
      { agentName: 'Frontend Developer', role: 'worker', label: 'Frontend' },
      { agentName: 'Code Reviewer', role: 'reviewer', label: 'Code Review' },
      { agentName: 'Model QA Specialist', role: 'qa', label: 'Model QA' },
    ],
    edges: [
      { fromIndex: 0, toIndex: 1, kind: 'handoff' },
      { fromIndex: 1, toIndex: 2, kind: 'handoff' },
      { fromIndex: 1, toIndex: 3, kind: 'handoff' },
      { fromIndex: 2, toIndex: 4, kind: 'review' },
      { fromIndex: 3, toIndex: 4, kind: 'review' },
      { fromIndex: 4, toIndex: 5, kind: 'qa' },
      { fromIndex: 5, toIndex: 0, kind: 'escalation' },
    ],
  },

  {
    id: 'data-intelligence-desk',
    name: 'Data Intelligence Desk',
    description:
      'Transforme des données brutes en insights lisibles, actions et reporting exécutif.',
    theme: 'operations',
    icon: '📊',
    color: 'blue',
    pipelineBrief:
      'Data Engineer cadre la demande → Data Consolidation Agent parse les documents et détecte les jeux de données → Analytics Reporter lance l’analyse Open_Pandas_AI → Workflow Optimizer vérifie l’actionnabilité → Executive Summary Generator livre la synthèse.',
    sharedContext:
      'This workspace turns scattered operational data into a clear intelligence brief. Accuracy, traceability, and actionability are the main quality gates.',
    commonRules:
      '1. Every metric must have a source and a definition.\n2. Flag missing or low-confidence data instead of hiding it.\n3. The final summary must separate observations, risks, and recommended actions.',
    defaultMode: 'profiles',
    nodes: [
      { agentName: 'Data Engineer', role: 'orchestrator', label: 'Data Lead' },
      { agentName: 'Data Consolidation Agent', role: 'worker', label: 'Consolidation', toolsets: ['document_parse'] },
      { agentName: 'Analytics Reporter', role: 'worker', label: 'Metrics', toolsets: ['open_pandas_analysis'] },
      { agentName: 'Workflow Optimizer', role: 'reviewer', label: 'Action Review' },
      { agentName: 'Executive Summary Generator', role: 'observer', label: 'Exec Brief' },
    ],
    edges: [
      { fromIndex: 0, toIndex: 1, kind: 'handoff' },
      { fromIndex: 1, toIndex: 2, kind: 'handoff' },
      { fromIndex: 2, toIndex: 3, kind: 'review' },
      { fromIndex: 3, toIndex: 4, kind: 'broadcast' },
      { fromIndex: 3, toIndex: 0, kind: 'escalation' },
    ],
  },

  {
    id: 'paid-growth-lab',
    name: 'Paid Growth Lab',
    description:
      'Audit paid media, création publicitaire, campagnes PPC et mesure de performance.',
    theme: 'growth',
    icon: '📈',
    color: 'amber',
    pipelineBrief:
      'Growth Hacker fixe l’objectif → Paid Media Auditor identifie les opportunités → Ad Creative Strategist et PPC Campaign Strategist préparent les campagnes → Tracking & Measurement Specialist valide la mesure → Search Query Analyst nourrit l’optimisation.',
    sharedContext:
      'This workspace optimizes paid acquisition. Budget efficiency, measurement hygiene, and creative-message fit are the core constraints.',
    commonRules:
      '1. No campaign recommendation without measurement requirements.\n2. Separate quick wins from experiments that need budget.\n3. Always include kill criteria and next optimization steps.',
    defaultMode: 'delegate',
    nodes: [
      { agentName: 'Growth Hacker', role: 'orchestrator', label: 'Growth Lead' },
      { agentName: 'Paid Media Auditor', role: 'reviewer', label: 'Audit' },
      { agentName: 'Ad Creative Strategist', role: 'worker', label: 'Creative' },
      { agentName: 'PPC Campaign Strategist', role: 'worker', label: 'PPC' },
      { agentName: 'Tracking & Measurement Specialist', role: 'qa', label: 'Measurement' },
      { agentName: 'Search Query Analyst', role: 'observer', label: 'Query Intel' },
    ],
    edges: [
      { fromIndex: 0, toIndex: 1, kind: 'handoff' },
      { fromIndex: 1, toIndex: 2, kind: 'handoff' },
      { fromIndex: 1, toIndex: 3, kind: 'handoff' },
      { fromIndex: 2, toIndex: 4, kind: 'qa' },
      { fromIndex: 3, toIndex: 4, kind: 'qa' },
      { fromIndex: 4, toIndex: 5, kind: 'broadcast' },
      { fromIndex: 5, toIndex: 0, kind: 'escalation' },
    ],
  },

  {
    id: 'community-launch',
    name: 'Community Launch',
    description:
      'Prépare un lancement communautaire coordonné sur réseaux sociaux et communautés spécialisées.',
    theme: 'growth',
    icon: '📣',
    color: 'green',
    pipelineBrief:
      'Social Media Strategist définit le calendrier → Reddit Community Builder, LinkedIn Content Creator et Twitter Engager adaptent les messages → Brand Guardian valide la voix → les retours reviennent au lead pour ajustement.',
    sharedContext:
      'This workspace plans a community-led launch. Each channel needs native copy, not generic reposting. Brand tone and community norms are both mandatory.',
    commonRules:
      '1. Adapt the message to each channel culture.\n2. Avoid spammy launch language; lead with relevance.\n3. Capture early objections and feed them back into the launch plan.',
    defaultMode: 'delegate',
    nodes: [
      { agentName: 'Social Media Strategist', role: 'orchestrator', label: 'Channel Lead' },
      { agentName: 'Reddit Community Builder', role: 'worker', label: 'Reddit' },
      { agentName: 'LinkedIn Content Creator', role: 'worker', label: 'LinkedIn' },
      { agentName: 'Twitter Engager', role: 'worker', label: 'X/Twitter' },
      { agentName: 'Brand Guardian', role: 'reviewer', label: 'Brand Review' },
    ],
    edges: [
      { fromIndex: 0, toIndex: 1, kind: 'handoff' },
      { fromIndex: 0, toIndex: 2, kind: 'handoff' },
      { fromIndex: 0, toIndex: 3, kind: 'handoff' },
      { fromIndex: 1, toIndex: 4, kind: 'review' },
      { fromIndex: 2, toIndex: 4, kind: 'review' },
      { fromIndex: 3, toIndex: 4, kind: 'review' },
      { fromIndex: 4, toIndex: 0, kind: 'escalation' },
    ],
  },

  {
    id: 'incident-response-room',
    name: 'Incident Response Room',
    description:
      'Triage, investigation forensique, analyse mémoire, défense et rapport post-incident.',
    theme: 'security',
    icon: '🚨',
    color: 'red',
    pipelineBrief:
      'Incident Response Commander coordonne → Triage Agent qualifie l’incident → DFIR Agent et Memory Analysis Agent investiguent → Blue Team Agent valide la défense → Reporting Agent produit le rapport.',
    sharedContext:
      'This workspace handles active or suspected security incidents. Containment, evidence preservation, and clear communication are the priorities.',
    commonRules:
      '1. Preserve evidence and timeline before remediation recommendations.\n2. Distinguish confirmed facts from hypotheses.\n3. End with containment actions, eradication steps, and follow-up controls.',
    defaultMode: 'delegate',
    nodes: [
      { agentName: 'Incident Response Commander', role: 'orchestrator', label: 'IR Lead' },
      { agentName: 'Triage Agent', role: 'worker', label: 'Triage' },
      { agentName: 'DFIR Agent', role: 'worker', label: 'Forensics' },
      { agentName: 'Memory Analysis Agent', role: 'worker', label: 'Memory' },
      { agentName: 'Blue Team Agent', role: 'reviewer', label: 'Defense' },
      { agentName: 'Reporting Agent', role: 'observer', label: 'Report' },
    ],
    edges: [
      { fromIndex: 0, toIndex: 1, kind: 'handoff' },
      { fromIndex: 1, toIndex: 2, kind: 'handoff' },
      { fromIndex: 1, toIndex: 3, kind: 'handoff' },
      { fromIndex: 2, toIndex: 4, kind: 'review' },
      { fromIndex: 3, toIndex: 4, kind: 'review' },
      { fromIndex: 4, toIndex: 5, kind: 'broadcast' },
      { fromIndex: 4, toIndex: 0, kind: 'escalation' },
    ],
  },

  {
    id: 'web-app-pentest',
    name: 'Web App Pentest',
    description:
      'Pentest web structuré avec attaque, validation défensive, rapport et remédiation.',
    theme: 'security',
    icon: '🕸️',
    color: 'purple',
    pipelineBrief:
      'Web Pentester définit le scope → Web Bounty Hunter et Red Team Agent explorent les failles → Security Engineer vérifie le risque → Blue Team Agent propose les contrôles → Reporting Agent synthétise.',
    sharedContext:
      'This workspace is for authorized security testing only. Scope, severity, reproduction steps, and remediation clarity are mandatory.',
    commonRules:
      '1. Stay inside the authorized scope.\n2. Every finding needs reproducible steps, impact, severity, and remediation.\n3. Separate exploitable issues from hardening recommendations.',
    defaultMode: 'delegate',
    nodes: [
      { agentName: 'Web Pentester', role: 'orchestrator', label: 'Pentest Lead' },
      { agentName: 'Web Bounty Hunter', role: 'worker', label: 'Bug Hunt' },
      { agentName: 'Red Team Agent', role: 'worker', label: 'Attack Path' },
      { agentName: 'Security Engineer', role: 'reviewer', label: 'Risk Review' },
      { agentName: 'Blue Team Agent', role: 'qa', label: 'Defense QA' },
      { agentName: 'Reporting Agent', role: 'observer', label: 'Report' },
    ],
    edges: [
      { fromIndex: 0, toIndex: 1, kind: 'handoff' },
      { fromIndex: 0, toIndex: 2, kind: 'handoff' },
      { fromIndex: 1, toIndex: 3, kind: 'review' },
      { fromIndex: 2, toIndex: 3, kind: 'review' },
      { fromIndex: 3, toIndex: 4, kind: 'qa' },
      { fromIndex: 4, toIndex: 5, kind: 'broadcast' },
      { fromIndex: 5, toIndex: 0, kind: 'escalation' },
    ],
  },

  {
    id: 'customer-care-ops',
    name: 'Customer Care Ops',
    description:
      'Organise le support client, retours, réponses, conformité et reporting qualité.',
    theme: 'business',
    icon: '🎧',
    color: 'cyan',
    pipelineBrief:
      'Customer Service qualifie les demandes → Support Responder prépare les réponses → Retail Customer Returns traite les retours → Legal Compliance Checker vérifie les risques → Analytics Reporter remonte les tendances.',
    sharedContext:
      'This workspace improves customer operations. The team should prioritize fast resolution, consistent tone, compliance, and learning loops.',
    commonRules:
      '1. Keep responses clear, empathetic, and policy-aware.\n2. Escalate legal or compliance uncertainty before sending guidance.\n3. Track recurring issues as product or process feedback.',
    defaultMode: 'delegate',
    nodes: [
      { agentName: 'Customer Service', role: 'orchestrator', label: 'Care Lead' },
      { agentName: 'Support Responder', role: 'worker', label: 'Responses' },
      { agentName: 'Retail Customer Returns', role: 'worker', label: 'Returns' },
      { agentName: 'Legal Compliance Checker', role: 'reviewer', label: 'Compliance' },
      { agentName: 'Analytics Reporter', role: 'observer', label: 'Trends' },
    ],
    edges: [
      { fromIndex: 0, toIndex: 1, kind: 'handoff' },
      { fromIndex: 0, toIndex: 2, kind: 'handoff' },
      { fromIndex: 1, toIndex: 3, kind: 'review' },
      { fromIndex: 2, toIndex: 3, kind: 'review' },
      { fromIndex: 3, toIndex: 4, kind: 'broadcast' },
      { fromIndex: 4, toIndex: 0, kind: 'escalation' },
    ],
  },

  {
    id: 'sales-deal-room',
    name: 'Sales Deal Room',
    description:
      'Prépare discovery, solutioning, proposition commerciale et pilotage pipeline.',
    theme: 'business',
    icon: '🤝',
    color: 'amber',
    pipelineBrief:
      'Account Strategist orchestre le deal → Discovery Coach affine les besoins → Sales Engineer construit l’angle technique → Proposal Strategist rédige l’offre → Deal Strategist challenge la stratégie → Pipeline Analyst suit les risques.',
    sharedContext:
      'This workspace helps move qualified opportunities through a sales process. The output should be useful for the seller, the buyer, and internal forecasting.',
    commonRules:
      '1. Tie every proposal point to a discovered business need.\n2. Surface deal risks early instead of hiding them.\n3. Keep next steps explicit, dated, and owner-assigned.',
    defaultMode: 'delegate',
    nodes: [
      { agentName: 'Account Strategist', role: 'orchestrator', label: 'Deal Lead' },
      { agentName: 'Discovery Coach', role: 'worker', label: 'Discovery' },
      { agentName: 'Sales Engineer', role: 'worker', label: 'Solution' },
      { agentName: 'Proposal Strategist', role: 'worker', label: 'Proposal' },
      { agentName: 'Deal Strategist', role: 'reviewer', label: 'Deal Review' },
      { agentName: 'Pipeline Analyst', role: 'observer', label: 'Forecast' },
    ],
    edges: [
      { fromIndex: 0, toIndex: 1, kind: 'handoff' },
      { fromIndex: 1, toIndex: 2, kind: 'handoff' },
      { fromIndex: 2, toIndex: 3, kind: 'handoff' },
      { fromIndex: 3, toIndex: 4, kind: 'review' },
      { fromIndex: 4, toIndex: 5, kind: 'broadcast' },
      { fromIndex: 5, toIndex: 0, kind: 'escalation' },
    ],
  },

  {
    id: 'game-prototype-crew',
    name: 'Game Prototype Crew',
    description:
      'Passe d’un concept de jeu à un prototype jouable avec narration, technique, art et audio.',
    theme: 'creative',
    icon: '🎮',
    color: 'indigo',
    pipelineBrief:
      'Game Designer pose la boucle de gameplay → Narrative Designer structure l’expérience → Unity Architect définit l’implémentation → Technical Artist et Game Audio Engineer préparent la sensation → Reality Checker teste le prototype.',
    sharedContext:
      'This workspace prototypes a game experience. The goal is a playable loop with a clear feeling, not a complete production plan.',
    commonRules:
      '1. Prioritize the core loop over content volume.\n2. Every creative recommendation must support player feedback.\n3. Prototype scope should fit a short build cycle.',
    defaultMode: 'delegate',
    nodes: [
      { agentName: 'Game Designer', role: 'orchestrator', label: 'Game Lead' },
      { agentName: 'Narrative Designer', role: 'worker', label: 'Narrative' },
      { agentName: 'Unity Architect', role: 'worker', label: 'Unity' },
      { agentName: 'Technical Artist', role: 'worker', label: 'Tech Art' },
      { agentName: 'Game Audio Engineer', role: 'worker', label: 'Audio' },
      { agentName: 'Reality Checker', role: 'qa', label: 'Playtest' },
    ],
    edges: [
      { fromIndex: 0, toIndex: 1, kind: 'handoff' },
      { fromIndex: 0, toIndex: 2, kind: 'handoff' },
      { fromIndex: 0, toIndex: 3, kind: 'handoff' },
      { fromIndex: 0, toIndex: 4, kind: 'handoff' },
      { fromIndex: 1, toIndex: 5, kind: 'qa' },
      { fromIndex: 2, toIndex: 5, kind: 'qa' },
      { fromIndex: 3, toIndex: 5, kind: 'qa' },
      { fromIndex: 4, toIndex: 5, kind: 'qa' },
      { fromIndex: 5, toIndex: 0, kind: 'escalation' },
    ],
  },

  {
    id: 'xr-app-studio',
    name: 'XR App Studio',
    description:
      'Conçoit une expérience XR avec interaction, spatial computing, recherche UX et accessibilité.',
    theme: 'creative',
    icon: '🥽',
    color: 'blue',
    pipelineBrief:
      'XR Interface Architect définit les patterns → XR Immersive Developer prototype l’expérience → visionOS Spatial Engineer et macOS Spatial/Metal Engineer valident la plateforme → UX Researcher teste → Accessibility Auditor vérifie l’accessibilité.',
    sharedContext:
      'This workspace designs immersive or spatial interfaces. Comfort, clarity, performance, and accessibility are core constraints.',
    commonRules:
      '1. Avoid interactions that create fatigue or disorientation.\n2. Define platform assumptions before implementation details.\n3. Accessibility and comfort checks are release blockers.',
    defaultMode: 'delegate',
    nodes: [
      { agentName: 'XR Interface Architect', role: 'orchestrator', label: 'XR Lead' },
      { agentName: 'XR Immersive Developer', role: 'worker', label: 'Prototype' },
      { agentName: 'visionOS Spatial Engineer', role: 'worker', label: 'visionOS' },
      { agentName: 'macOS Spatial/Metal Engineer', role: 'worker', label: 'Spatial/Metal' },
      { agentName: 'UX Researcher', role: 'reviewer', label: 'UX Test' },
      { agentName: 'Accessibility Auditor', role: 'qa', label: 'A11y' },
    ],
    edges: [
      { fromIndex: 0, toIndex: 1, kind: 'handoff' },
      { fromIndex: 0, toIndex: 2, kind: 'handoff' },
      { fromIndex: 0, toIndex: 3, kind: 'handoff' },
      { fromIndex: 1, toIndex: 4, kind: 'review' },
      { fromIndex: 2, toIndex: 4, kind: 'review' },
      { fromIndex: 3, toIndex: 4, kind: 'review' },
      { fromIndex: 4, toIndex: 5, kind: 'qa' },
      { fromIndex: 5, toIndex: 0, kind: 'escalation' },
    ],
  },

  {
    id: 'automation-back-office',
    name: 'Automation Back Office',
    description:
      'Automatise des processus internes avec gouvernance, workflow, documents, conformité et diffusion.',
    theme: 'operations',
    icon: '🧩',
    color: 'purple',
    pipelineBrief:
      'Automation Governance Architect pose les garde-fous → Workflow Architect dessine le processus → Accounts Payable Agent et Document Generator traitent les cas métier → Legal Compliance Checker valide → Report Distribution Agent diffuse.',
    sharedContext:
      'This workspace automates business operations. The team must balance speed, maintainability, compliance, and human fallback paths.',
    commonRules:
      '1. Automate only after the business rule is explicit.\n2. Include auditability, owner, rollback, and exception handling.\n3. Compliance review is mandatory before operational rollout.',
    defaultMode: 'delegate',
    nodes: [
      { agentName: 'Automation Governance Architect', role: 'orchestrator', label: 'Governance' },
      { agentName: 'Workflow Architect', role: 'worker', label: 'Workflow' },
      { agentName: 'Accounts Payable Agent', role: 'worker', label: 'AP Ops' },
      { agentName: 'Document Generator', role: 'worker', label: 'Docs' },
      { agentName: 'Legal Compliance Checker', role: 'reviewer', label: 'Compliance' },
      { agentName: 'Report Distribution Agent', role: 'observer', label: 'Distribution' },
    ],
    edges: [
      { fromIndex: 0, toIndex: 1, kind: 'handoff' },
      { fromIndex: 1, toIndex: 2, kind: 'handoff' },
      { fromIndex: 1, toIndex: 3, kind: 'handoff' },
      { fromIndex: 2, toIndex: 4, kind: 'review' },
      { fromIndex: 3, toIndex: 4, kind: 'review' },
      { fromIndex: 4, toIndex: 5, kind: 'broadcast' },
      { fromIndex: 4, toIndex: 0, kind: 'escalation' },
    ],
  },

  {
    id: 'market-entry-brief',
    name: 'Market Entry Brief',
    description:
      'Prépare une entrée marché multi-pays avec intelligence culturelle, localisation et synthèse.',
    theme: 'research',
    icon: '🌐',
    color: 'green',
    pipelineBrief:
      'Cultural Intelligence Strategist orchestre → China Market Localization Strategist, French Consulting Market Navigator et Korean Business Navigator analysent les marchés → Language Translator adapte les nuances → Brand Guardian vérifie la cohérence → Executive Summary Generator synthétise.',
    sharedContext:
      'This workspace prepares market-entry strategy. It should surface cultural, messaging, channel, and operational differences across markets.',
    commonRules:
      '1. Do not flatten markets into generic global advice.\n2. Highlight localization risks and assumptions.\n3. End with a comparative recommendation and next validation steps.',
    defaultMode: 'delegate',
    nodes: [
      { agentName: 'Cultural Intelligence Strategist', role: 'orchestrator', label: 'Culture Lead' },
      { agentName: 'China Market Localization Strategist', role: 'worker', label: 'China' },
      { agentName: 'French Consulting Market Navigator', role: 'worker', label: 'France' },
      { agentName: 'Korean Business Navigator', role: 'worker', label: 'Korea' },
      { agentName: 'Language Translator', role: 'worker', label: 'Localization' },
      { agentName: 'Brand Guardian', role: 'reviewer', label: 'Brand Fit' },
      { agentName: 'Executive Summary Generator', role: 'observer', label: 'Brief' },
    ],
    edges: [
      { fromIndex: 0, toIndex: 1, kind: 'handoff' },
      { fromIndex: 0, toIndex: 2, kind: 'handoff' },
      { fromIndex: 0, toIndex: 3, kind: 'handoff' },
      { fromIndex: 1, toIndex: 4, kind: 'handoff' },
      { fromIndex: 2, toIndex: 4, kind: 'handoff' },
      { fromIndex: 3, toIndex: 4, kind: 'handoff' },
      { fromIndex: 4, toIndex: 5, kind: 'review' },
      { fromIndex: 5, toIndex: 6, kind: 'broadcast' },
      { fromIndex: 6, toIndex: 0, kind: 'escalation' },
    ],
  },
] satisfies TeamDefinition[];

// ── Resolver ──────────────────────────────────────────────────────────

export interface ResolvedTeamNode {
  id: string;
  agentId: string;
  role: WorkspaceAgentRole;
  label: string;
  position: { x: number; y: number };
  skills?: string[];
  toolsets?: string[];
  modelOverride?: string;
}

export interface ResolvedTeamEdge {
  fromNodeId: string;
  toNodeId: string;
  kind: WorkspaceEdgeKind;
}

export interface ResolvedTeamAgentMatch {
  id: string;
  name: string;
  source?: string;
  sourcePath?: string;
  slug?: string;
}

export interface ResolvedTeamAgentAmbiguity {
  agentName: string;
  matches: ResolvedTeamAgentMatch[];
}

export interface ResolvedTeam {
  definition: TeamDefinition;
  name: string;
  description: string;
  pipelineBrief: string;
  sharedContext: string;
  commonRules: string;
  defaultMode: AgentWorkspace['defaultMode'];
  nodes: ResolvedTeamNode[];
  edges: ResolvedTeamEdge[];
  missingAgents: string[];
  ambiguousAgents: ResolvedTeamAgentAmbiguity[];
}

/**
 * Given a team definition and a list of available agents (from the library),
 * resolve agent references by name and produce the full workspace payload.
 *
 * Returns the resolved team with node IDs, positions, and edges, plus a list
 * of agent names that could not be found (so the UI can warn the user).
 */
export function resolveTeam(
  team: TeamDefinition,
  availableAgents: Array<Pick<AgentDefinition, 'id' | 'name' | 'defaultModel' | 'preferredSkills' | 'preferredToolsets' | 'source' | 'sourcePath' | 'slug'>>,
): ResolvedTeam {
  const positions = autoLayout(team.nodes.length);
  const instanceId = `${team.id}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;

  // Build a lookup: lowercase name → candidate matches.
  const agentsByName = new Map<string, Array<Pick<AgentDefinition, 'id' | 'name' | 'defaultModel' | 'preferredSkills' | 'preferredToolsets' | 'source' | 'sourcePath' | 'slug'>>>();
  for (const agent of availableAgents) {
    const key = agent.name.trim().toLowerCase();
    const matches = agentsByName.get(key);
    if (matches) matches.push(agent);
    else agentsByName.set(key, [agent]);
  }

  const missingAgents: string[] = [];
  const ambiguousAgents: ResolvedTeamAgentAmbiguity[] = [];
  const ambiguousAgentsByName = new Map<string, ResolvedTeamAgentAmbiguity>();
  const nodeIds: string[] = [];
  const resolvedNodes: ResolvedTeamNode[] = [];

  for (let i = 0; i < team.nodes.length; i++) {
    const def = team.nodes[i];
    const matches = agentsByName.get(def.agentName.trim().toLowerCase()) || [];
    const agent = matches.length === 1 ? matches[0] : null;
    const nodeId = `node_team_${instanceId}_${i}`;

    if (agent) {
      const nodeToolsets = Array.isArray(def.toolsets) && def.toolsets.length > 0
        ? def.toolsets
        : (agent.preferredToolsets || []);
      resolvedNodes.push({
        id: nodeId,
        agentId: agent.id,
        role: def.role,
        label: def.label || agent.name,
        position: positions[i],
        modelOverride: agent.defaultModel || '',
        skills: agent.preferredSkills || [],
        toolsets: nodeToolsets,
      });
    } else if (matches.length > 1) {
      if (!ambiguousAgentsByName.has(def.agentName)) {
        const ambiguity = {
          agentName: def.agentName,
          matches: matches.map(match => ({
            id: match.id,
            name: match.name,
            source: match.source,
            sourcePath: match.sourcePath,
            slug: match.slug,
          })),
        };
        ambiguousAgentsByName.set(def.agentName, ambiguity);
        ambiguousAgents.push(ambiguity);
      }

      resolvedNodes.push({
        id: nodeId,
        agentId: '',
        role: def.role,
        label: def.label || def.agentName,
        toolsets: def.toolsets || [],
        position: positions[i],
      });
    } else {
      // Agent not found — still create a node but flag it
      missingAgents.push(def.agentName);
      resolvedNodes.push({
        id: nodeId,
        agentId: '',
        role: def.role,
        label: def.label || def.agentName,
        toolsets: def.toolsets || [],
        position: positions[i],
      });
    }
    nodeIds.push(nodeId);
  }

  const resolvedEdges: ResolvedTeamEdge[] = team.edges.map((edge) => ({
    fromNodeId: nodeIds[edge.fromIndex],
    toNodeId: nodeIds[edge.toIndex],
    kind: edge.kind,
  }));

  return {
    definition: team,
    name: team.name,
    description: team.description,
    pipelineBrief: team.pipelineBrief,
    sharedContext: team.sharedContext || '',
    commonRules: team.commonRules || '',
    defaultMode: team.defaultMode,
    nodes: resolvedNodes,
    edges: resolvedEdges,
    missingAgents,
    ambiguousAgents,
  };
}
