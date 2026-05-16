---
name: templates-workspaces-tutorial
description: Complete tutorial on using Templates (agent definitions) and Workspaces (multi-agent compositions) in Hermes Desktop.
category: productivity
---

# Templates & Workspaces — Tutoriel Complet

## Aperçu

Deux concepts, deux pages :

| Page | Onglets | Rôle |
|---|---|---|
| **Templates** | *(pas d'onglets)* | Gérer les définitions d'agents (identité, SOUL, config) |
| **Workspaces** | Canvas · Runs | Composer des workflows multi-agents à partir de templates |

**Modèle Lego** : Templates = briques individuelles. Workspaces = assembler les briques en une machine.

---

## PARTIE 1 : Templates

### Qu'est-ce qu'un Template ?

Un Template est une **définition d'agent réutilisable**. Il contient :
- **Soul** : le prompt système (SOUL.md) qui définit le comportement
- **Name / Slug** : identifiant unique
- **Default model** : modèle LLM préféré
- **Preferred skills** : compétences Hermes à activer
- **Preferred toolsets** : outils autorisés (file, terminal, web, etc.)
- **Tags, Vibe, Workflow, Deliverables** : métadonnées descriptives

**Ce qu'un template fait** : quand tu l'"Applies", il écrit son SOUL.md dans le profil actif. L'agent prend cette personnalité.

**Ce qu'un template ne fait PAS** : il ne lance pas de processus, il n'a pas de runtime. C'est une recette.

### Interface de la page Templates

```
┌─────────────────────────────────────────────────────────────────────┐
│  Templates                              [New] [Save] [Apply Soul]  │
│  Reusable agent definitions for profiles and workspaces.            │
├──────────────────────────┬──────────────────────────────────────────┤
│                          │                                          │
│  LIBRARY                 │  TEMPLATE EDITOR                          │
│  [Search...]             │                                          │
│  [Source ▼] [Division ▼] │  template-researcher            [Copy]   │
│  Agency-agents           │  agency-agents / researcher               │
│  ☐ agent-1               │  [Research]  [Agency]                     │
│  ☐ agent-2               │                                          │
│  ☐ agent-3               │  Name:        [_________________]         │
│                          │  Slug:        [_________________]         │
│  Bundled Agency          │  Default model:[_________________]        │
│  Default Agency          │  Division:    [_________________]         │
│  Import Source           │  Description: [_________________]         │
│                          │                                          │
│  User                    │  Soul:                                    │
│  ☐ my-custom-agent       │  ┌────────────────────────────────────┐  │
│                          │  │ # Identity                          │  │
│                          │  │ You are a...                        │  │
│                          │  │                                      │  │
│                          │  │ ## Style                             │  │
│                          │  │ - Be direct                          │  │
│                          │  └────────────────────────────────────┘  │
│                          │  Preferred skills: [web, search]          │
│                          │  Toolsets:       [file, terminal, web]    │
│                          │  Tags:           [research, analysis]     │
│                          │  Vibe:           [_________________]      │
│                          │  Workflow:       [_________________]      │
│                          │  Deliverables:   [_________________]      │
│                          │                                          │
└──────────────────────────┴──────────────────────────────────────────┘
```

### Cycle de vie d'un Template

#### 1. Créer un template

**Bouton [New]** → crée un template vide avec un SOUL par défaut :

```markdown
# Identity

You are a pragmatic Hermes-based specialist.

## Style
- Be direct
- Be useful
- Stay grounded in operational reality
```

Tu peux le personnaliser :

```
1. [New] → template générique créé
2. Modifie le nom → "agent-researcher"
3. Modifie le slug → "researcher"
4. Remplace le SOUL par ton identité d'agent
5. Ajoute les skills préférés (comma-separated)
6. Ajoute les toolsets (comma-separated)
7. [Save] → persisté en base
```

#### 2. Importer un template existant

Trois méthodes d'import (boutons dans la sidebar gauche) :

| Méthode | Source | Usage |
|---|---|---|
| **Bundled Agency** | Fichier JSON local pré-packagé | Agents fournis avec Hermes |
| **Default Agency** | Git repo `msitarzewski/agency-agents` | Catalogue communautaire |
| **Import Source** | URL ou chemin personnalisé | Tes propres définitions |

```
1. Clique "Bundled Agency" / "Default Agency" / "Import Source"
2. Les templates importés apparaissent dans la sidebar (section "Agency-agents")
3. Clique sur un template → il s'ouvre dans l'éditeur à droite
4. [Save] → le template importé est copié localement (source reste marquée)
```

#### 3. Appliquer un template au profil actif

**Bouton [Apply Soul]** → le SOUL du template est écrit dans `HERMES_HOME/SOUL.md`

```
1. Sélectionne un template dans la sidebar
2. Vérifies/ajustes le SOUL dans l'éditeur
3. [Apply Soul] → le SOUL est copié dans le profil actif
4. Hermes redémarre avec cette identité au prochain chat
```

**Important** : Apply Soul ne change QUE le SOUL.md. Il ne sauvegarde pas les autres champs (model, skills, toolsets, etc.) dans config.yaml.

#### 4. Dupliquer un template

- Sélectionne un template → bouton [Copy] (Duplicate)
- Crée une copie avec source "user" (même si l'original était un import agency)
- Nom : `[original] copy`

#### 5. Supprimer un template

- Sélectionne → bouton [Delete]
- Supprime de la bibliothèque locale
- Si le template était la sélection active, le focus passe au premier template restant

### Les sections de la Library (sidebar)

La library est organisée par **source** :

```
Agency-agents     → Templates importés (bundled, default repo, custom)
User              → Templates que tu as créés manuellement via [New]
```

Chaque section montre le nombre de templates et permet de filtrer.

---

## PARTIE 2 : Workspaces

### Flux actuel implemente

La page **Workspaces** sert aujourd'hui a composer, sauvegarder, generer et tester une orchestration multi-agent.

Flux nominal :

1. **Creation** : `[New workspace]` cree un workspace vide avec nom, description, `Pipeline brief`, contexte partage, regles communes, mode d'execution, nodes et relations.
2. **Ajout de node** : un template se glisse depuis le panneau **Templates** vers le canvas. Le node cree reprend le nom, le modele, les skills et toolsets preferes du template.
3. **Edition** : l'inspecteur modifie les champs workspace, les roles de nodes, les overrides modele, les skills/toolsets et les relations entre nodes.
4. **Save** : `[Save]` persiste le workspace dans le store Agent Studio.
5. **Generate prompt** : `[Generate prompt]` sauvegarde d'abord le workspace, puis genere le prompt d'orchestration depuis le backend.
6. **Auto-config preview** : `Preview auto-config` sauvegarde le workspace, envoie le `Pipeline brief` et la topologie courante au backend, puis recoit une suggestion normalisee.
7. **Preview diff** : la preview affiche localement les changements proposes avant application : champs workspace, mode d'execution, nodes et relations.
8. **Apply preview** : `Apply preview` applique localement la suggestion aux champs workspace, nodes et relations. Une sauvegarde reste necessaire ensuite pour la persistance.
9. **Apply & Save** : `Apply & Save` applique le meme plan local et le persiste immediatement, sans refaire d'appel au modele.
10. **Unsaved changes** : toute modification locale affiche `Unsaved changes` et renforce le bouton `Save changes`.
11. **Navigation sure** : les changements de workspace, creation, suppression, ouverture de l'interface, navigation hors page et reload demandent confirmation quand le workspace actif n'est pas sauvegarde.
12. **Interface / Runs** : l'onglet **Interface** permet de chatter avec le workspace, et **Runs** affiche les sorties d'execution.

Contraintes de securite actuelles :

- l'auto-config ne peut utiliser que les node ids deja presents dans le workspace ;
- les roles, modes et types de relations sont limites a des valeurs connues ;
- les nodes ou edges inconnus proposes par le modele sont ignores cote backend.

### Qu'est-ce qu'un Workspace ?

Un Workspace est une **composition multi-agent** : un graphe de nœuds où chaque nœud est un template/agent branché sur un rôle spécifique.

**Cas d'usage typique** :
- Un workspace "Code Review" avec un agent Reviewer + un agent Testeur
- Un workspace "Research" avec un agent Chercheur + un agent Synthétiseur
- Un workspace "Build" avec un architecte + un développeur + un QA

### Interface de la page Workspaces

```
┌─────────────────────────────────────────────────────────────────────┐
│  [Workspace: my-workspace ▼]  [New Workspace] [Save] [Prompt] [Del]│
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  [Canvas] ───────────┤[Runs]                                       │
│                                                                     │
├──────────────┬──────────────────────────────┬───────────────────────┤
│              │                              │                       │
│  TEMPLATES   │      CANVAS                  │   INSPECTOR           │
│  (sidebar)   │                              │                       │
│              │   ┌──────────────────────┐    │   Node: researcher    │
│  [Search..]  │   │ ┌──────────────────┐ │    │                       │
│  agent-a ────┘   │ │ ○ Researcher     │◄┼────┤─── Agent: researcher  │
│  agent-b ────┘   │ │   Role: Reviewer │ │    │   Role: [Reviewer   v]│
│  agent-c ────┘   │ └──────────────────┘ │    │   Priority: [High   v]│
│                  │          │             │    │   Max iterations: [5  │
│                  │          ├─────────────┤    │                     v]│
│                  │   ┌──────────────────┐ │    │   Model: [__________│
│                  │   │ ○ Tester         │ │    │   Context:          │
│                  │   │   Role: QA       │ │    │   [________________│
│                  │   └──────────────────┘ │    │                    │
│                  │                        │    │   [Remove Node]     │
│                  │                        │    │                     │
│                  └────────────────────────┘    │                     │
│                                                │                     │
└──────────────┴────────────────────────────────┴─────────────────────┘
```

### Cycle de vie d'un Workspace

#### 1. Créer un Workspace

**Bouton [New Workspace]** → crée un workspace vide (titre "Untitled", 0 nodes)

```
1. [New Workspace]
2. Renomme-le dans le dropdown (clique sur le titre → édite)
3. Ajoute des nodes (étape suivante)
4. [Save] → persisté
```

#### 2. Ajouter des agents au Canvas

La sidebar gauche (Templates) est ta **palette d'agents**.

**Méthode Drag-and-Drop** :
```
1. Dans la sidebar Templates, cherche un agent
2. Glisse-le vers le Canvas central
3. Le node apparaît avec l'agent lié
```

**Méthode sélection** :
```
1. Clique sur un template dans la sidebar
2. L'agent est ajouté au noeud sélectionné / nouveau noeud
```

Une fois le node sur le canvas, configure-le via **l'Inspector** (panneau droit) :

| Champ | Description |
|---|---|
| **Agent** | L'agent/template lié (lecture seule, défini au drop) |
| **Role** | Le rôle dans le workflow (Reviewer, QA, Architect, etc.) |
| **Priority** | Ordre d'exécution (Low/Medium/High) |
| **Max iterations** | Nombre de tours d'exécution pour ce node |
| **Model** | Override de modèle spécifique à ce node |
| **Context** | Contexte/instructions spécifiques au rôle |

#### 3. Organiser les nodes

- **Drag-and-drop dans le canvas** : déplace les nodes visuellement
- **Sélection** : clique sur un node pour le sélectionner → l'Inspector montre ses détails
- **Remove** : bouton [Remove Node] dans l'Inspector pour supprimer un node

#### 4. Sauvegarder le Workspace

**Bouton [Save]** → persiste le workspace (nodes, positions, configs)

#### 5. Supprimer un Workspace

**Bouton [Delete]** (dans la barre en haut) → supprime le workspace actif

---

### Tab "Canvas" : Composer et éditer

C'est l'onglet par défaut. Il contient les 3 panneaux :

1. **Templates (gauche)** : parcourir/drag les agents disponibles
2. **Canvas (centre)** : visualiser et organiser les nodes du workspace
3. **Inspector (droite)** : configurer le node sélectionné

L'agent du template est **cliqué/glissé** sur le canvas. Tu définis ensuite son rôle, ses paramètres.

### Tab "Runs" : Exécuter et monitorer

Le tab Runs montre les résultats d'exécution du workspace.

**Actions depuis Canvas ou Runs** :

| Action | Description |
|---|---|
| **[Prompt]** / **Generate Prompt** | Génère un prompt d'orchestration à partir du workspace |
| **[Copy]** | Copie le prompt généré dans le presse-papier |
| **[Send to Chat]** | Envoie le prompt dans le Chat (il sera utilisé comme instruction) |
| **[Execute]** | Exécute le workspace via le Gateway Hermes |

#### Comment l'exécution fonctionne

1. Tu as composé un workspace avec N agents
2. Tu généres un prompt → le système construit un prompt d'orchestration
3. Tu peux soit :
   - **Envoyer au Chat** pour exécution manuelle (tu ajustes avant d'envoyer)
   - **Exécuter directement** via le Gateway (lancement automatique)

Le résultat apparaît dans le tab **Runs** avec le status et l'output.

---

## PARTIE 3 : Le lien Templates ↔ Workspaces

### Le flux complet

```
Templates                    Workspaces
────────                     ──────────
1. Créer un agent "Reviewer" │
2. Lui donner un SOUL         │
3. [Save]                     │
                              │  4. Créer workspace "Code Review"
                              │  5. Glisser "Reviewer" sur le canvas
                              │  6. Configurer le node (role, priority)
                              │  7. Glisser "Tester" sur le canvas
                              │  8. [Save] le workspace
                              │  9. [Execute] ou [Send to Chat]
```

### Règles importantes

1. **Templates sont globaux** : ils ne sont pas liés à un profil. Tu peux les réutiliser dans n'importe quel profil ou workspace.

2. **Apply Soul = remplacement** : appliquer un template remplace complètement le SOUL.md du profil actif. C'est un overwrite, pas un merge.

3. **Les nodes de workspace ne modifient PAS les templates** : quand tu ajoutes un agent à un workspace, tu utilises le template tel quel. Les modifications de rôle/priority dans l'Inspector sont stockées dans le workspace, pas dans le template.

4. **Workspace ≠ runtime persistant** : un workspace est une composition. Quand tu l'exécutes, le Gateway lance les agents en séquence/parallèle. Il n'y a pas de processus long-running pour un workspace.

---

## PARTIE 4 : Workflows courants

### Workflow 1 : Créer un agent spécialisé et l'utiliser

```
Templates → [New]
    ↓
Nommer "expert-security"
    ↓
Écrire le SOUL (identité d'expert sécurité)
    ↓
Définir skills: "cyber-assessment-planning, cyber-blue-team-review"
    ↓
Définir toolsets: "terminal, file, web, vision"
    ↓
[Save]
    ↓
[Apply Soul] si tu veux l'utiliser dans ton profil actif
    — OU —
    ↓
Aller sur Workspaces → glisser "expert-security" dans un workspace "Audit"
```

### Workflow 2 : Composer un pipeline multi-agent

```
Workspaces → [New Workspace]
    ↓
Nommer "Research Pipeline"
    ↓
Sidebar Templates → chercher "researcher" → glisser sur canvas
    ↓
Configurer le node:
    Role: "Primary Researcher"
    Priority: High
    Context: "Focus on recent sources (2024+)"
    ↓
Sidebar Templates → chercher "synthesizer" → glisser sur canvas
    ↓
Configurer le node:
    Role: "Synthesizer"
    Priority: Medium
    Context: "Summarize findings into executive brief"
    ↓
[Save]
    ↓
[Generate Prompt] → vérifier le prompt
    ↓
[Send to Chat] ou [Execute]
```

### Workflow 3 : Itérer rapidement sur un template

```
Templates → sélectionner un template existant
    ↓
Modifier le SOUL → [Save]
    ↓
[Apply Soul] → tester avec un quick chat
    ↓
Si ça marche → le template est prêt pour les workspaces
    ↓
Si non → ajuster → [Save] → ré-itérer
```

---

## Résumé en une phrase

**Templates** = tes briques d'agents (identité, SOUL, config). **Workspaces** = assembler ces briques en un pipeline d'exécution orchestré. Les templates se créent et éditent sur la page Templates, puis se glissent sur le canvas des Workspaces pour composer des workflows.
