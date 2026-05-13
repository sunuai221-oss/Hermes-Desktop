# Hermes Desktop — Backlog de refactor exécutable lot par lot

Date: 2026-05-11
Repo: `/mnt/c/Users/GAMER PC/.hermes/hermes-builder`

> Ce backlog découpe le plan de refactor en lots exécutables, incrémentaux, vérifiables, avec surface de changement limitée.
> Stratégie: safe/strangler refactor, façade publique stable, vérification après chaque lot.

## Convention d’exécution

Pour chaque lot:
1. implémenter uniquement le périmètre du lot
2. exécuter les vérifications ciblées du lot
3. exécuter la vérification globale minimale:
   - `npm test`
   - `npm run build`
   - `npm run lint`
4. commit unique du lot

Format par lot:
- objectif
- fichiers
- tâches
- commandes de vérification
- critères de done
- commit recommandé

---

## LOT 0 — Cadrage et garde-fous

### Objectif
Créer les documents de référence qui figent la cible d’architecture et les critères de simplification avant le refactor.

### Fichiers
Créer:
- `docs/architecture/hermes-desktop-target-architecture.md`
- `docs/architecture/refactor-checklist.md`

### Tâches
1. Écrire l’architecture cible canonique:
   - Chat
   - Sessions
   - Identity
   - Templates
   - Workspaces
   - Extensions
   - System
2. Écrire les règles de refactor:
   - 1 concept = 1 surface canonique
   - 1 source de vérité runtime
   - pas de flux critique implicite via `localStorage`
   - pas d’alias API inutiles
3. Écrire la checklist des reliquats à traiter:
   - `SoulPage`
   - doublons `profiles.*`
   - routes backend non consommées
   - gros fichiers à éclater

### Vérification ciblée
- relecture des deux fichiers
- cohérence avec l’audit existant

### Vérification globale
- aucune nécessaire au-delà d’un quick sanity check de repo propre

### Done si
- les deux fichiers existent
- les briques canoniques sont nommées explicitement
- les anti-règles sont listées noir sur blanc

### Commit
`docs: add target architecture and refactor checklist`

---

## LOT 1 — Unifier la template library

### Objectif
Supprimer la duplication majeure entre `TemplatesPage` et `AgentStudioWorkspaces`.

### Fichiers
Créer:
- `src/features/templates/components/TemplatesLibraryPanel.tsx`
- `src/features/templates/hooks/useTemplatesLibrary.ts`
- éventuellement `src/features/templates/types.ts`

Modifier:
- `src/pages/TemplatesPage.tsx`
- `src/pages/agent-studio/AgentStudioWorkspaces.tsx`

### Tâches
1. Extraire les types et helpers de template library si nécessaire.
2. Extraire l’état partagé dans `useTemplatesLibrary.ts`:
   - chargement library
   - recherche
   - filtres
   - import source/agencies
   - apply/import actions
3. Extraire le rendu principal dans `TemplatesLibraryPanel.tsx`.
4. Réduire `TemplatesPage.tsx` à une page-shell qui compose `TemplatesLibraryPanel`.
5. Remplacer la logique doublonnée dans `AgentStudioWorkspaces.tsx` par le composant partagé ou supprimer la surface library locale.
6. Vérifier qu’il ne reste pas deux implémentations métier de la même library.

### Vérification ciblée
Commandes/recherches:
- rechercher `agentStudio.library(` dans `src/`
- rechercher les chaînes `Search templates`, `apply`, `importAgency`, `library` dans:
  - `src/pages/TemplatesPage.tsx`
  - `src/pages/agent-studio/AgentStudioWorkspaces.tsx`
- vérifier que la logique métier library est concentrée dans `src/features/templates/*`

### Vérification globale
- `npm test`
- `npm run build`
- `npm run lint`

### Done si
- `TemplatesPage.tsx` devient majoritairement composition
- `AgentStudioWorkspaces.tsx` ne réimplémente plus la logique library
- une seule implémentation canonique de la library reste

### Commit
`refactor: extract canonical templates library panel`

---

## LOT 2 — Unifier la source de vérité runtime/gateway

### Objectif
Supprimer la duplication de logique runtime entre `ProfileProvider` et `useGateway`.

### Fichiers
Créer:
- `src/features/runtime/runtimeStatus.ts`
- éventuellement `src/features/runtime/types.ts`

Modifier:
- `src/hooks/useGateway.ts`
- `src/contexts/GatewayContext.tsx`
- `src/contexts/GatewayProvider.tsx`
- `src/contexts/ProfileProvider.tsx`
- `src/contexts/ProfileContext.tsx`
- `src/components/Header.tsx`
- `src/pages/HomePage.tsx`
- `src/pages/ProfilesPage.tsx` si concerné

### Tâches
1. Centraliser la normalisation runtime dans `runtimeStatus.ts`:
   - `online`
   - `degraded`
   - `offline`
2. Faire de `useGateway.ts` la seule source de vérité runtime.
3. Retirer de `ProfileProvider.tsx`:
   - polling gateway/process
   - calcul `gatewayStatus`
   - normalisation runtime
4. Conserver dans `ProfileProvider.tsx` uniquement la responsabilité profils/CRUD/selection.
5. Mettre à jour les composants consommateurs pour séparer:
   - `useProfiles()`
   - `useGateway()`

### Vérification ciblée
- rechercher `gatewayStatus` dans `src/`
- vérifier qu’il ne subsiste plus dans `ProfileContext`/`ProfileProvider`
- rechercher les fonctions dupliquées de mapping de statut

### Vérification globale
- `npm test`
- `npm run build`
- `npm run lint`

### Done si
- une seule couche calcule l’état runtime
- `ProfileProvider` ne fait plus de logique gateway
- Header/Home lisent le runtime via gateway uniquement

### Commit
`refactor: unify runtime status under gateway state`

---

## LOT 3 — Nettoyer les alias API et legacy frontend

### Objectif
Réduire la surface inutile côté frontend et supprimer les reliquats évidents.

### Fichiers
Modifier:
- `src/api.ts`
- `src/pages/SoulPage.tsx`
- `src/App.tsx`
- `src/hooks/useNavigation.ts`
- autres imports éventuels de `SoulPage`

### Tâches
1. Choisir un nom canonique entre `profiles.list` et `profiles.metadata`.
2. Supprimer l’alias API redondant dans `src/api.ts`.
3. Rechercher tous les usages de `SoulPage`.
4. Si aucun usage réel:
   - supprimer `src/pages/SoulPage.tsx`
   - retirer les imports/références associées
5. Vérifier que `IdentityPage` est la seule surface canonique pour ce domaine.

### Vérification ciblée
- recherche `profiles.list(` et `profiles.metadata(`
- recherche `SoulPage` dans `src/`
- vérification du routage et de la navigation Identity

### Vérification globale
- `npm test`
- `npm run build`
- `npm run lint`

### Done si
- l’API frontend n’expose plus le doublon `profiles.*`
- `SoulPage` est supprimé ou justifié explicitement
- Identity reste stable côté UX

### Commit
`refactor: remove legacy soul page and duplicate profile api alias`

---

## LOT 4 — Assainir les routes backend orphelines/legacy

### Objectif
Réduire la surface backend exposée qui n’a pas de consommateur clair.

### Fichiers
Modifier:
- `server/routes/agents.mjs`
- `server/routes/gateway.mjs`
- `server/routes/kanban.mjs`
- `server/index.mjs`
- `src/api.ts`
- tests backend concernés si nécessaire

### Tâches
1. Statuer sur `/api/agents`:
   - retirer d’abord de `src/api.ts` si non consommé
   - décider ensuite suppression backend ou maintien documenté
2. Statuer sur `/api/gateway/status`:
   - alias de compatibilité ?
   - si oui, le commenter explicitement
   - sinon, le supprimer
3. Statuer sur `/api/kanban/diagnostics`:
   - route interne documentée
   - ou suppression si inutile
4. Vérifier que chaque route restante a:
   - un consommateur UI
   - ou un test
   - ou une justification de compatibilité

### Vérification ciblée
- recherche frontend des usages de:
  - `agents.`
  - `/api/gateway/status`
  - `kanban diagnostics`
- lecture du fichier de montage des routes

### Vérification globale
- `npm test`
- `npm run build`
- `npm run lint`

### Done si
- plus de route “flottante” sans raison claire
- la façade frontend n’expose plus de surface morte

### Commit
`refactor: prune or document orphan backend routes`

---

## LOT 5 — Remplacer le bridge implicite localStorage → Chat

### Objectif
Rendre explicite le passage de draft vers le chat.

### Fichiers
Créer:
- `src/features/chat/chatDraftBridge.ts`
ou
- `src/features/chat/ChatDraftContext.tsx`

Modifier:
- `src/pages/DelegationPage.tsx`
- `src/pages/agent-studio/AgentStudioWorkspaces.tsx`
- `src/hooks/useChat.ts`

### Tâches
1. Encapsuler le draft chat dans un bridge dédié:
   - `setDraft(...)`
   - `consumeDraft()`
2. Migrer `DelegationPage.tsx` vers ce bridge.
3. Migrer `AgentStudioWorkspaces.tsx` vers ce bridge.
4. Faire lire `useChat.ts` via le bridge au lieu de clés `localStorage` brutes.
5. Garder temporairement `localStorage` uniquement comme détail interne si nécessaire.

### Vérification ciblée
- recherche de `hermes-chat-draft` dans `src/`
- il ne doit plus apparaître dans les pages produit
- navigation vers `/chat` après création du draft

### Vérification globale
- `npm test`
- `npm run build`
- `npm run lint`

### Done si
- le contrat draft est explicite
- les pages métier n’accèdent plus directement à `localStorage`
- `useChat` ne connaît plus les clés de stockage concrètes

### Commit
`refactor: replace chat localStorage bridge with explicit draft service`

---

## LOT 6 — Éclater useChat.ts en sous-hooks

### Objectif
Transformer `useChat.ts` en façade orchestratrice stable et réduire le monolithe.

### Fichiers
Créer:
- `src/features/chat/hooks/useChatSession.ts`
- `src/features/chat/hooks/useChatMessages.ts`
- `src/features/chat/hooks/useChatUploads.ts`
- `src/features/chat/hooks/useChatAudio.ts`
- `src/features/chat/hooks/useChatContextFiles.ts`
- `src/features/chat/hooks/useChatDraft.ts`
- `src/features/chat/types.ts` si utile

Modifier:
- `src/hooks/useChat.ts`
- potentiellement:
  - `src/hooks/chatAudioController.ts`
  - `src/hooks/chatAudioRuntime.ts`

### Tâches
1. Extraire la lecture/consommation du draft.
2. Extraire l’audio.
3. Extraire uploads/images.
4. Extraire session/message append.
5. Extraire context resolution.
6. Garder la signature publique de `useChat.ts` stable.

### Vérification ciblée
- relire la signature exportée de `useChat`
- vérifier qu’aucun composant consommateur n’a besoin d’être réécrit lourdement
- contrôler la baisse de taille du fichier

### Vérification globale
- `npm test`
- `npm run build`
- `npm run lint`

### Done si
- `useChat.ts` devient une façade courte
- les responsabilités sont réparties en sous-hooks cohérents
- le comportement de Chat ne régresse pas

### Commit
`refactor: split useChat into focused hooks`

---

## LOT 7 — Éclater AgentStudioWorkspaces.tsx

### Objectif
Transformer la page monolithe en assemblage de panneaux et hooks spécialisés.

### Fichiers
Créer:
- `src/pages/agent-studio/components/WorkspaceListPanel.tsx`
- `src/pages/agent-studio/components/WorkspaceEditorPanel.tsx`
- `src/pages/agent-studio/components/WorkspaceRunPanel.tsx`
- `src/pages/agent-studio/components/WorkspaceTemplatePanel.tsx`
- `src/pages/agent-studio/hooks/useWorkspaceCrud.ts`
- `src/pages/agent-studio/hooks/useWorkspaceExecution.ts`

Modifier:
- `src/pages/agent-studio/AgentStudioWorkspaces.tsx`
- `src/pages/WorkspacesPage.tsx` si nécessaire

### Tâches
1. Extraire le panneau liste/sélection.
2. Extraire le panneau édition CRUD.
3. Extraire le panneau exécution.
4. Extraire le binding templates/workspaces.
5. Extraire la logique d’exécution et CRUD vers hooks dédiés.
6. Réduire `AgentStudioWorkspaces.tsx` à l’orchestration.

### Vérification ciblée
- taille des nouveaux composants
- présence d’une séparation claire CRUD / exécution / templates / sélection
- navigation Workspaces inchangée

### Vérification globale
- `npm test`
- `npm run build`
- `npm run lint`

### Done si
- la page principale orchestre au lieu d’implémenter tout
- chaque sous-composant reste lisible

### Commit
`refactor: split agent studio workspaces into panels and hooks`

---

## LOT 8 — Éclater KanbanPage.tsx

### Objectif
Réduire une autre grosse surface UI en sous-modules compréhensibles.

### Fichiers
Créer:
- `src/pages/kanban/components/KanbanBoard.tsx`
- `src/pages/kanban/components/KanbanToolbar.tsx`
- `src/pages/kanban/components/KanbanTaskPanel.tsx`
- `src/pages/kanban/hooks/useKanbanBoard.ts`

Modifier:
- `src/pages/KanbanPage.tsx`

### Tâches
1. Extraire l’affichage board.
2. Extraire la toolbar/filtres/actions.
3. Extraire le panneau de détail tâche.
4. Extraire le hook de coordination board.

### Vérification ciblée
- board et détails continuent à fonctionner visuellement
- le fichier page principal diminue nettement

### Vérification globale
- `npm test`
- `npm run build`
- `npm run lint`

### Done si
- `KanbanPage.tsx` devient composition claire

### Commit
`refactor: split kanban page into board modules`

---

## LOT 9 — Éclater ConfigPage.tsx

### Objectif
Découper la configuration en sections métier séparées.

### Fichiers
Créer:
- `src/pages/config/sections/ModelsConfigSection.tsx`
- `src/pages/config/sections/ProvidersConfigSection.tsx`
- `src/pages/config/sections/ToolsConfigSection.tsx`
- `src/pages/config/sections/EnvironmentConfigSection.tsx`

Modifier:
- `src/pages/ConfigPage.tsx`

### Tâches
1. Extraire section modèles.
2. Extraire section providers.
3. Extraire section tools.
4. Extraire section environment/runtime.
5. Garder `ConfigPage.tsx` comme page-shell.

### Vérification ciblée
- les sections chargent les mêmes données qu’avant
- l’ordre et la lisibilité sont améliorés

### Vérification globale
- `npm test`
- `npm run build`
- `npm run lint`

### Done si
- `ConfigPage.tsx` n’est plus un monolithe
- les sections sont séparées par responsabilité

### Commit
`refactor: split config page into section components`

---

## LOT 10 — Alléger server/index.mjs

### Objectif
Transformer `server/index.mjs` en vrai point d’entrée léger.

### Fichiers
Créer:
- `server/app.mjs`
- `server/bootstrap/configure-middleware.mjs`
- `server/bootstrap/configure-routes.mjs`
- `server/bootstrap/configure-error-handlers.mjs`
- éventuellement `server/services/runtime-service.mjs`
- éventuellement `server/services/gateway-service.mjs`
- éventuellement `server/services/profile-service.mjs`

Modifier:
- `server/index.mjs`

### Tâches
1. Extraire la construction d’app Express.
2. Extraire le câblage middleware.
3. Extraire le montage des routes.
4. Extraire les error handlers.
5. Laisser `server/index.mjs` gérer principalement:
   - chargement config/env
   - création app
   - listen

### Vérification ciblée
- lecture de `server/index.mjs` en moins de quelques écrans
- démarrage backend inchangé
- routes toujours montées

### Vérification globale
- `npm test`
- `npm run build`
- `npm run lint`

### Done si
- `server/index.mjs` devient un bootstrap lisible
- le montage global backend est compréhensible depuis un seul point

### Commit
`refactor: extract express app bootstrap from server index`

---

## LOT 11 — Réduire le bruit Context/Provider

### Objectif
Rendre les domaines `gateway` et `profiles` plus lisibles structurellement.

### Fichiers
Modifier:
- `src/contexts/GatewayContext.tsx`
- `src/contexts/GatewayProvider.tsx`
- `src/contexts/ProfileContext.tsx`
- `src/contexts/ProfileProvider.tsx`

Créer éventuellement:
- `src/features/runtime/GatewayState.tsx`
- `src/features/profiles/ProfileState.tsx`

### Tâches
1. Décider domaine par domaine si context + provider doivent être fusionnés.
2. Si oui, regrouper dans un point d’entrée clair.
3. Aligner les imports côté consommateurs.

### Vérification ciblée
- moins de fichiers structurels pour le même domaine
- lisibilité améliorée sans casser l’API React publique

### Vérification globale
- `npm test`
- `npm run build`
- `npm run lint`

### Done si
- la structure context/provider n’ajoute plus de bruit inutile

### Commit
`refactor: simplify context provider layout`

---

## LOT 12 — Clarifier la navigation produit

### Objectif
Faire refléter la navigation les vraies briques canoniques.

### Fichiers
Modifier:
- `src/components/Sidebar.tsx`
- `src/hooks/useNavigation.ts`
- `src/App.tsx`
- `src/pages/HomePage.tsx` si nécessaire

### Tâches
1. Revoir la hiérarchie principale du menu.
2. Garder en navigation principale:
   - Chat
   - Sessions
   - Identity
   - Templates
   - Workspaces
   - System
3. Reléguer en secondaire/expert selon besoin:
   - Extensions
   - Delegation
   - Kanban
   - Profiles
   - Config
4. Statuer sur `Home`:
   - cockpit distinct utile
   - ou simplification/fusion

### Vérification ciblée
- cohérence `Sidebar` / `useNavigation` / `App.tsx`
- absence de doublons conceptuels dans la nav

### Vérification globale
- `npm test`
- `npm run build`
- `npm run lint`

### Done si
- la navigation aide à comprendre l’architecture au lieu de la brouiller

### Commit
`refactor: align navigation with canonical product surfaces`

---

## LOT 13 — Nettoyage final des warnings et placeholders

### Objectif
Finir par la dette légère et rendre la base propre après refactor.

### Fichiers
Modifier:
- `src/hooks/chatAudioController.ts`
- `src/hooks/chatAudioRuntime.ts`
- `src/hooks/useChat.ts`
- `src/**/*.tsx` concernés par placeholders/TODO

### Tâches
1. Corriger les warnings React hooks restants.
2. Classer les placeholders:
   - utile temporaire
   - neutre acceptable
   - mort à supprimer
3. Supprimer le dead UI et réduire le bruit copy/TODO.

### Vérification ciblée
- `npm run lint`
- baisse nette du bruit placeholder dans l’interface

### Vérification globale
- `npm test`
- `npm run build`
- `npm run lint`

### Done si
- warnings hooks réduits au minimum, idéalement zéro
- UI plus nette, moins de promesses produit floues

### Commit
`chore: fix remaining hook warnings and remove dead placeholders`

---

## Ordre d’exécution recommandé

Exécution stricte recommandée:
1. LOT 0
2. LOT 1
3. LOT 2
4. LOT 3
5. LOT 4
6. LOT 5
7. LOT 6
8. LOT 7
9. LOT 8
10. LOT 9
11. LOT 10
12. LOT 11
13. LOT 12
14. LOT 13

## Lots à plus fort ROI immédiat

Si on veut les gains maximaux le plus tôt possible:
- LOT 1 — template library
- LOT 2 — runtime unique
- LOT 5 — bridge chat explicite
- LOT 6 — useChat
- LOT 7 — AgentStudioWorkspaces

## Définition de terminé globale

Le programme de refactor est terminé si:
- il n’existe plus qu’une seule implémentation canonique de la template library
- runtime/gateway a une seule source de vérité
- les reliquats legacy visibles ont disparu ou sont explicitement documentés
- les flux inter-pages ne reposent plus sur un couplage implicite brut
- les gros monolithes principaux ont été éclatés
- la navigation reflète les briques canoniques
- tests/build/lint restent stables lot après lot
