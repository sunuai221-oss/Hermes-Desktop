# Kanban Page — Audit de Design Approfondi

## Vue d'ensemble

La page Kanban est le système de gestion de tâches d'Hermes, connecté au CLI `hermes kanban`. Architecture: board horizontal (lanes) + sidebar détail. 6-7 statuts: triage, todo, ready, running, blocked, done, archived.

## 1. PROBLÈMES STRUCTURELS

### 1.1 Layout: grille horizontale avec scroll
- **Problème:** Les lanes sont dans une grille avec `min-width: laneCount × 196px` et scroll horizontal. C'est fonctionnel mais:
  - Les lanes sont trop étroits (196px) pour du contenu avec assignee + tenant + skills
  - Le scroll horizontal est mal intuitif sur desktop large — on perd des lanes de vue
  - La hauteur `max-h-[68vh]` coupe les colonnes avec beaucoup de tâches

- **Solution recommandée:**
  - Passer à un layout flex horizontal avec `flex-1 min-w-[200px]` par lane
  - Adapter la largeur selon le nombre de lanes visibles (flex grow/shrink)
  - Sur grand écran (>1400px), afficher 6 lanes sans scroll
  - Sur petit écran, passer en layout vertical (colonnes empilées) avec selecteur de lane
  - Remplacer `max-h-[68vh]` par `flex-1` avec scroll indépendant par lane

### 1.2 Pas de drag-and-drop
- **Problème:** Pour déplacer une tâche entre lanes, il faut:
  1. Clicker la carte
  2. Ouvrir le panel détail
  3. Cliquer sur Complete/Block/Archive
  4. Attendre l'API
  5. Re-cliquer une autre tâche

  C'est 5+ étapes pour un kanban. C'est l'anti-pattern kanban #1.

- **Solution recommandée:**
  - Intégrer `@dnd-kit/core` + `@dnd-kit/sortable` (déjà léger, React-friendly)
  - Drag entre lanes → auto-change de statut avec confirmation légère (toast)
  - Auto-scroll des lanes pendant le drag
  - Annulation possible (ctrl+z ou toast undo)

### 1.3 Stats pills: layout incohérent
- **Problème:** `grid-cols-2 md:grid-cols-4 xl:grid-cols-7` pour 6-7 valeurs
  - Sur `md`, 4 colonnes → 6 statuts = overflow sur 2 lignes = break du flow visuel
  - Sur `xl`, 7 colonnes = 1 par pill = correct seulement avec archived
  - Les pills sont visuellement beaux mais prennent beaucoup de place pour un ratio info/zone faible

- **Solution recommandée:**
  - Passer à une single-line flex: `flex items-center gap-2 overflow-x-auto`
  - Réduire la taille: `py-2 px-3` au lieu de `py-3 px-3.5`
  - Afficher le label + count de plus compact: `text-xs` label, `text-base` count
  - Ajouter un effet hover pour voir le nombre exact au lieu de tout afficher en grand

### 1.4 Task cards: trop denses
- **Problème:** Chaque carte affiche:
  - Titre (font-semibold) + Priority badge (P0-P3)
  - Chips: assignee, tenant, skills (max 2)
  - Task ID en mono (10px)
  - Pas de body/description visible
  - Pas de date, pas de running time, pas de run count

- **Solution recommandée:**
  - Simplifier: Titre + assignee initial (avatar circle) + priority
  - Sur hover: preview du body (2 lignes max)
  - Badges de statut visuel: dot coloré pour running/blocked
  - Afficher le temps dans le statut: "Running 2h" ou "Blocked 3d"
  - Task ID en détail seulement, pas sur la carte

## 2. PROBLÈMES DE DESIGN / THEME

### 2.1 Clash de couleurs
- **Problème:** Les lanes utilisent des couleurs hard-coded:
  - Triage: fuchsia (#d946ef)
  - Todo: sky (#0ea5e9)
  - Ready: emerald (#10b981)
  - Running: amber (#f59e0b)
  - Blocked: red (#ef4444)
  - Done: stone (#a8a29e)

  Ces couleurs ne correspondent PAS au thème Hermes (amber/gold/warm brown).
  Le fuchsia et le sky cassent l'harmonie visuelle du reste de l'app.

- **Solution recommandée:**
  ```
  Triage:   brand-amber (#FF8C00) → nouveau, à trier
  Todo:     brand-ember (#B4603C) → à faire
  Ready:    brand-gold (#FFD700)  → prêt à exécuter
  Running:  warning (#D8A22A)     → en cours
  Blocked:  destructive (#E6553D) → bloqué
  Done:     muted (#7A6250)       → terminé
  Archived: brand-smoke (#603018) → archivé
  ```
  Ou utiliser une palette dérivée du thème avec des opacités variées.

### 2.2 Form d'ajout: UX médiocre
- **Problème:** Le form "New task" remplace le contenu du sidebar détail.
  - On ne voit plus le board pendant qu'on crée
  - Le form est long: 8 champs + skills checkboxes
  - Pas de validation en temps réel
  - Les champs peu utilisés (tenant, maxRuntime, maxRetries, parents, workspace) prennent autant de place que les essentiels

- **Solution recommandée:**
  - Modal overlay au lieu de remplacer le sidebar
  - 2 modes: Quick (titre + assignee) vs Advanced (tous les champs)
  - Champs conditionnels: maxRuntime/maxRetries/parents seulement si triage=true
  - Skills: search/select au lieu de toutes les checkboxes (peut être 50+ skills)
  - Validation inline: titre requis, priorité numérique

### 2.3 Detail panel: trop vertical
- **Problème:** Le panel détail est très long verticalement:
  1. Titre + badges
  2. Body
  3. Meta grid (4 items)
  4. Assignee section
  5. Skills chips
  6. Result/summary
  7. Outcome + action buttons
  8. Comment section
  9. Parents/children
  10. Comments history
  11. Runs history
  12. Events history

  Avec `max-h-[calc(100vh-220px)]` et scroll, c'est difficile de voir l'ensemble.

- **Solution recommandée:**
  - Layout vertical avec tabs: "Overview" / "Actions" / "History"
  - Overview: titre, body, meta, assignee, skills, result
  - Actions: outcome + buttons (complete, block, unblock, archive, reclaim)
  - History: comments, runs, events (avec pagination ou lazy load)
  - Ou: 2 colonnes dans le sidebar (gauche=info, droite=actions+history)

## 3. FONCTIONNALITÉS MANQUANTES

### 3.1 Pas de filtres avancés
- Recherche textuelle seulement
- Pas de filtre par: assignee, priority, status, tenant, tenant, workspace
- Pas de tri: par date, priority, assignee

### 3.2 Pas de board creation en UI
- Le backend supporte `POST /api/kanban/boards` et `POST /api/kanban/boards/:slug/switch`
- L'UI n'a qu'un `<select>` — impossible de créer un nouveau board sans passer par CLI

### 3.3 Pas d'indicateurs temporels
- Pas de due date
- Pas de "age" (depuis quand dans ce statut)
- Pas de WIP limits par lane

### 3.4 Pas de bulk actions
- Pas de sélection multiple
- Pas de completion/archivage en masse

### 3.5 Pas de preview hover
- Click obligatoire pour voir le détail
- Sur un board dense, c'est fastidieux

### 3.6 Pas de keyboard shortcuts
- Pas de 'n' pour new task
- Pas de flèches pour naviguer entre cards
- Pas de raccourcis pour les actions (c=complete, b=block, etc.)

## 4. PROBLÈMES TECHNIQUES

### 4.1 Performance
- `useMemo` avec `delay: i * 0.03` pour l'animation des cartes — avec 50+ tâches par lane, les derniers delays sont à ~1.5s
- `loadBoard` appelle 3 APIs en `Promise.all` + 1 appel supplémentaire si `selectedTaskId` → 4 appels au load
- `mutateSelectedTask` fait 2 appels API (action + loadBoard) pour chaque action
- Pas de debounce sur la recherche

### 4.2 Race conditions
- `setSelectedTaskId` + `selectTask` asynchrone: si l'utilisateur change de board entre-temps, `selectedTaskId` pointe vers un task du mauvais board
- `loadBoard` avec `silent=true` peut écraser l'état pendant une action en cours

### 4.3 State management
- Trop de `useState` (15+) dans un seul composant
- Le form state est global au composant, pas isolé
- Pas de `useReducer` pour les états liés

## 5. PRIORITÉ DES AMÉLIORATIONS

### P0 — Impact immédiat
1. **Drag-and-drop entre lanes** — l'expérience kanban canonique
2. **Aligner les couleurs avec le thème Hermes** — cohérence visuelle
3. **Modal pour le form New Task** — voir le board pendant la création
4. **Filtres avancés** (par assignee, priority, status)

### P1 — Amélioration significative
5. **Tabs dans le detail panel** (Overview/Actions/History)
6. **Simplifier les task cards** (moins de chips, hover preview)
7. **Creation de boards en UI**
8. **Preview hover** sur les cartes
9. **Keyboard shortcuts**

### P2 — Polish
10. **Indicateurs temporels** (age dans le statut, due dates)
11. **Bulk actions**
12. **WIP limits** par lane
13. **Optimisation performance** (debounce, virtualisation, useReducer)
14. **Auto-refresh** configurable (polling)
15. **Export board** (JSON, Markdown)

## 6. PROPOSITION DE LAYOUT RÉVISÉ

```
┌─────────────────────────────────────────────────────────────┐
│  Kanban Board                              [Board][Archi][+New]│
├─────────────────────────────────────────────────────────────┤
│  [Triage:3] [Todo:12] [Ready:5] [Running:2] [Blocked:1] [Done:47] │
├──────────────────────────────┬──────────────────────────────┤
│  ┌──────┐ ┌──────┐          │  ┌─ Task Detail ───────────┐  │
│  │Triage│ │ Todo │          │  │ Title                  │  │
│  │      │ │      │          │  │ Body preview           │  │
│  │Card  │ │Card  │          │  │                        │  │
│  │      │ │      │          │  │ Status | Priority      │  │
│  │Card  │ │Card  │          │  │ Assignee | Tenant      │  │
│  │      │ │      │          │  │                        │  │
│  └──────┘ └──────┘          │  [Complete] [Block]       │  │
│                              │  ── History ──           │  │
│  ┌──────┐ ┌──────┐          │  Comments (3) | Runs (2) │  │
│  │Ready │ │Running│         │                        │  │
│  │      │ │      │          │                        │  │
│  │Card  │ │Card  │          │                        │  │
│  │      │ │      │          │                        │  │
│  └──────┘ └──────┘          └────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

Lanes: flex horizontal, pas de scroll sur grand écran.
Detail: 2 colonnes internes (info + actions) avec tabs pour l'historique.
