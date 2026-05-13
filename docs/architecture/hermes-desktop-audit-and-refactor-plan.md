# Hermes Desktop — Audit architectural complet et plan de refactor

Date: 2026-05-11
Repo: `/mnt/c/Users/GAMER PC/.hermes/hermes-builder`

## 1. Résumé exécutif

Verdict court:

Hermes Desktop est globalement cohérent et fonctionnel, mais il n’est pas encore "simple en mode lego".
Le backend est plutôt bien structuré et l’app compile/teste proprement, mais le frontend garde plusieurs zones de recouvrement, quelques reliquats legacy, et plusieurs gros monolithes qui créent de la confusion.

Verdict détaillé:
- cohérent: oui
- fonctionnel: oui
- simple: pas encore
- lego: partiellement
- redondances: oui, surtout Templates/Workspaces + API legacy
- code inutile: un peu
- code non fonctionnel: pas de casse majeure détectée
- séparation backend: bonne
- séparation frontend: moyenne
- efficacité globale: correcte aujourd’hui, perfectible structurellement

En une phrase:
Hermes Desktop est une bonne base qui marche, mais il a encore une architecture frontend plus large que nécessaire, avec duplication de surfaces et quelques gros blocs qui empêchent la vraie simplicité.

## 2. Ce qui a été vérifié

### Validation factuelle
- Tests: `npm test` → 66/66 passent
- Build: `npm run build` → OK
- Lint: `npm run lint` → 12 warnings, 0 erreur

### Fichiers principaux inspectés
- `src/App.tsx`
- `src/api.ts`
- `server/index.mjs`
- `src/hooks/useNavigation.ts`
- `src/components/Sidebar.tsx`
- `src/hooks/useGateway.ts`
- `src/hooks/useChat.ts`
- `src/pages/TemplatesPage.tsx`
- `src/pages/agent-studio/AgentStudioWorkspaces.tsx`
- `src/pages/IdentityPage.tsx`
- `src/pages/HomePage.tsx`
- `src/pages/ExtensionsPage.tsx`
- `src/pages/DelegationPage.tsx`
- `src/contexts/ProfileProvider.tsx`
- `server/routes/*`

### Constats instrumentés
- Cartographie frontend/backend et usages réels de `src/api.ts`
- Vérification des routes backend consommées vs exposées
- Recherche de reliquats legacy
- Vérification des duplications fonctionnelles majeures
- Mesure des gros fichiers TS/TSX/MJS
- Recherche des usages de `localStorage` pour les drafts du chat

## 3. Ce qui est solide

### 3.1 Ossature globale saine
- React Router réel, pas un simple faux système d’onglets
- route par défaut vers `/chat`
- sessions → ouverture dans le chat déjà câblée dans `App.tsx`

### 3.2 Backend globalement modulaire
- routes séparées par domaine
- services et middleware déjà présents
- middleware global `/api` + contexte Hermes bien posé

### 3.3 L’application n’est pas cassée
- tests verts
- build vert
- lint sans erreur bloquante

### 3.4 Certaines briques sont déjà bien séparées
- `IdentityPage` compose proprement:
  - `SoulPanel`
  - `MemoryPanel`
  - `ConversationSearch`
- `ExtensionsPage` est une vraie page connectée
- `DelegationPage` est une vraie page active, pas un simple placeholder

Conclusion:
ce n’est pas un chaos. C’est une base sérieuse, mais trop lourde et redondante par endroits.

## 4. Le vrai problème: la cohérence conceptuelle est incomplète

Un modèle "lego" exige:
- 1 concept = 1 surface canonique
- 1 responsabilité = 1 module
- 1 flux = 1 source de vérité

Aujourd’hui, Hermes Desktop respecte ça seulement en partie.

## 5. Incohérences principales

### 5.1 Duplication forte autour de Templates / Library

C’est le problème le plus net.

Deux surfaces réimplémentent la même brique métier:
- `src/pages/TemplatesPage.tsx`
- `src/pages/agent-studio/AgentStudioWorkspaces.tsx`

Les deux font du:
- chargement de library
- recherche de templates
- filtres
- import
- apply
- usage de la même donnée backend `agentStudio.library()`

Conséquences:
- deux UX pour un même concept
- deux endroits à maintenir
- deux logiques d’évolution
- confusion produit: où est la vraie bibliothèque ?

Conclusion:
Pour une architecture lego, il faut une seule surface canonique:
- soit `TemplatesPage` possède la library
- soit un composant `LibraryPanel` partagé est utilisé partout
- mais pas deux implémentations parallèles

### 5.2 Trop de gros monolithes

Les plus gros fichiers repérés:
- `src/pages/agent-studio/AgentStudioWorkspaces.tsx` → 1220 lignes
- `src/pages/KanbanPage.tsx` → 1199 lignes
- `server/index.mjs` → 1151 lignes
- `src/hooks/useChat.ts` → 1000 lignes
- `src/pages/ConfigPage.tsx` → 890 lignes
- `src/pages/TemplatesPage.tsx` → 620 lignes

Effets:
- coût cognitif élevé
- refactor plus risqué
- tests ciblés plus difficiles à construire
- lecture et maintenance dégradées

Conclusion:
la dette n’est pas d’abord fonctionnelle, elle est structurelle.

### 5.3 Surface API plus large que l’usage réel

Dans `src/api.ts`:
- `profiles.list` et `profiles.metadata` pointent vers le même endpoint `/api/profiles/metadata`
- c’est un doublon inutile

Routes backend présentes mais non consommées par le frontend actuel:
- `/api/agents`
- `/api/gateway/status` (alias legacy de `process-status`, utile surtout pour compatibilité/tests)
- `/api/kanban/diagnostics`

Reliquat legacy clair:
- `src/pages/SoulPage.tsx`
- contenu: simple alias `export { IdentityPage as SoulPage }`
- aucun consommateur détecté côté `src`

Conclusion:
- pas dangereux immédiatement
- mais surface plus large que nécessaire
- maintenance plus floue
- compréhension moins immédiate

### 5.4 Deux sources de vérité partielles pour le runtime status

Recouvrement entre:
- `src/contexts/ProfileProvider.tsx`
- `src/hooks/useGateway.ts`
- `src/contexts/GatewayProvider.tsx`

Les deux mondes font des probes runtime/gateway:
- `process-status`
- fallback health
- normalisation `online/degraded/offline`

Effets:
- risque de divergence d’affichage
- logique dupliquée
- responsabilité mal séparée

Conclusion:
une seule couche doit calculer l’état runtime, les autres doivent consommer cet état.

### 5.5 Couplage implicite via localStorage pour des flux produit

Pattern vérifié:
- `DelegationPage.tsx` écrit dans `localStorage`
- `AgentStudioWorkspaces.tsx` écrit aussi dans `localStorage`
- `useChat.ts` lit ensuite ces clés:
  - `hermes-chat-draft`
  - `hermes-chat-draft-ts`

Conséquence:
le passage de données entre pages n’est pas un vrai contrat applicatif, mais un bridge implicite.

Conclusion:
ça marche, mais ce n’est pas propre pour une architecture lego. Il faut une action/navigation explicite ou un petit store/bridge dédié.

### 5.6 Séparation Context/Provider trop fragmentée

Trois domaines sont éclatés en plusieurs fichiers:
- `FeedbackContext` + `FeedbackProvider`
- `GatewayContext` + `GatewayProvider`
- `ProfileContext` + `ProfileProvider`

Ce n’est pas grave en soi, mais pour cette application cela ajoute du bruit de lecture plus que de la valeur.

### 5.7 Nommage produit encore un peu flou

Exemples:
- `DelegationPage` agit surtout comme composer de prompt `delegate_task`, plus que comme vrai orchestrateur complet
- `WorkspacesPage` est un simple wrapper autour d’un énorme `AgentStudioWorkspaces`
- `Home` coexiste avec `Chat` alors que `Chat` est déjà la vraie entrée métier principale

Conclusion:
les intentions produit restent un peu floues dans les noms et la navigation.

## 6. Code inutile ou non fonctionnel

Réponse rigoureuse:
- non, l’app n’est pas globalement non fonctionnelle
- oui, il existe des reliquats et surfaces inutiles ou redondantes

Les plus clairs:
- `src/pages/SoulPage.tsx` → reliquat de compatibilité
- `profiles.list` vs `profiles.metadata` → doublon API
- `/api/agents` → route backend sans usage frontend trouvé
- `/api/gateway/status` → alias legacy
- `/api/kanban/diagnostics` → exposé mais non branché à l’UI

Conclusion:
ce n’est pas une app morte, mais ce n’est pas encore une app taillée au plus juste.

## 7. Est-ce que tout est bien relié ?

### Oui, sur les flux principaux
- Chat ↔ Sessions: bien relié
- Identity ↔ soul/memory: bien relié
- Extensions ↔ plugins/hooks: bien relié
- Profiles ↔ metadata/CRUD: bien relié

### Là où la liaison est moins propre
- Delegation → Chat via `localStorage`
- Workspaces ↔ Templates avec duplication de library
- Runtime status calculé à plusieurs endroits

Conclusion:
la connexion existe, mais certaines liaisons ne sont pas encore propres.

## 8. Est-ce que tout est bien séparé ?

### Backend
Plutôt oui.
- bonne intention modulaire
- routes/services séparés
- mais `server/index.mjs` reste trop massif

### Frontend
Partiellement.
- bonne séparation par pages/features en façade
- mais plusieurs pages/hooks sont encore des mini-monolithes
- la séparation visuelle existe plus que la séparation réelle des responsabilités

Verdict séparation:
- correcte en macro
- insuffisante en micro

## 9. Priorités de refactor recommandées

### P0 — Priorité absolue
1. Unifier la bibliothèque de templates
2. Unifier la source de vérité runtime
3. Supprimer les reliquats/aliases inutiles
4. Casser les gros monolithes principaux

### P1 — Amélioration structurelle
5. Remplacer les ponts `localStorage` → Chat
6. Réduire la fragmentation Context/Provider
7. Clarifier les surfaces produit et la navigation

### P2 — Polish
8. Nettoyer les warnings React hooks
9. Réduire le bruit placeholder / TODO visible

## 10. Plan de refactor ultra concret fichier par fichier

## Phase 0 — Geler la cible

### Task 0.1 — Créer un document d’architecture cible
Créer:
- `docs/architecture/hermes-desktop-target-architecture.md`

Contenu:
- surfaces canoniques:
  - Chat
  - Identity
  - Templates
  - Workspaces
  - Extensions
  - System
- règles:
  - pas de duplication de library
  - pas de double source runtime
  - pas de flux critique via `localStorage`

### Task 0.2 — Créer une checklist de refactor
Créer:
- `docs/architecture/refactor-checklist.md`

Contenu:
- alias legacy à traiter
- routes backend orphelines
- pages wrappers
- gros fichiers à éclater
- critères de done

## Phase 1 — Unifier la bibliothèque de templates

### Task 1.1 — Extraire la logique partagée de library
Créer:
- `src/features/templates/components/TemplatesLibraryPanel.tsx`
- `src/features/templates/hooks/useTemplatesLibrary.ts`

Modifier:
- `src/pages/TemplatesPage.tsx`
- `src/pages/agent-studio/AgentStudioWorkspaces.tsx`

Action:
- déplacer la logique commune:
  - chargement library
  - recherche
  - filtres
  - import
  - apply
- vers:
  - `useTemplatesLibrary.ts`
  - `TemplatesLibraryPanel.tsx`

### Task 1.2 — Réduire TemplatesPage à une simple page-shell
Modifier:
- `src/pages/TemplatesPage.tsx`

Action:
- garder seulement:
  - header page
  - `TemplatesLibraryPanel`

Cible:
- page < 200–250 lignes

### Task 1.3 — Enlever la duplication de library dans Workspaces
Modifier:
- `src/pages/agent-studio/AgentStudioWorkspaces.tsx`

Action:
- si la library reste visible ici, elle doit être rendue via `TemplatesLibraryPanel`
- aucune logique métier library spécifique ne doit rester dans ce fichier

## Phase 2 — Unifier la source de vérité runtime/gateway

### Task 2.1 — Définir un modèle runtime unique
Créer:
- `src/features/runtime/runtimeStatus.ts`

Modifier:
- `src/hooks/useGateway.ts`
- `src/contexts/GatewayContext.tsx`

Action:
- centraliser:
  - `processStatus`
  - `directHealth`
  - `builder health`
  - normalisation `online/degraded/offline`

### Task 2.2 — Débrancher la logique gateway de ProfileProvider
Modifier:
- `src/contexts/ProfileProvider.tsx`
- `src/contexts/ProfileContext.tsx`

Action:
- retirer:
  - polling runtime
  - calcul de `gatewayStatus`
  - logique `start/stop` si déjà couverte ailleurs
- garder seulement:
  - profil actif
  - liste profils
  - CRUD profils
  - sélection profil

### Task 2.3 — Harmoniser les consommateurs UI
Modifier selon usages:
- `src/components/Header.tsx`
- `src/pages/HomePage.tsx`
- `src/pages/ProfilesPage.tsx`
- autres consommateurs éventuels

Action:
- utiliser:
  - `useProfiles()` pour les profils
  - `useGateway()` pour le runtime

## Phase 3 — Supprimer les alias legacy et surfaces orphelines

### Task 3.1 — Supprimer SoulPage si vraiment mort
Modifier/Supprimer:
- `src/pages/SoulPage.tsx`
- `src/App.tsx`
- `src/hooks/useNavigation.ts`

Action:
- vérifier une dernière fois qu’aucune route/import active ne l’utilise
- supprimer le fichier si confirmé mort
- garder `IdentityPage` comme surface canonique

### Task 3.2 — Nettoyer le doublon API profiles.list / profiles.metadata
Modifier:
- `src/api.ts`

Action:
- conserver un seul nom canonique, recommandé: `profiles.metadata()`
- supprimer l’alias redondant

### Task 3.3 — Statuer sur la surface /api/agents
Modifier:
- `server/routes/agents.mjs`
- `server/index.mjs`
- `src/api.ts`

Décision recommandée:
- sortir d’abord cette surface de la façade frontend si elle n’est pas utilisée
- puis décider suppression backend ou classement internal/legacy

### Task 3.4 — Statuer sur /api/gateway/status et /api/kanban/diagnostics
Modifier:
- `server/routes/gateway.mjs`
- `server/routes/kanban.mjs`
- `src/api.ts`
- tests associés si besoin

Action:
- chaque route doit avoir:
  - un consommateur UI
  - ou un test
  - ou une justification de compatibilité

## Phase 4 — Remplacer le couplage localStorage → Chat

### Task 4.1 — Introduire un bridge explicite de draft
Créer:
- `src/features/chat/chatDraftBridge.ts`
ou
- `src/features/chat/ChatDraftContext.tsx`

Action:
- exposer une API explicite:
  - `setDraft({ text, source, metadata })`
  - `consumeDraft()`

### Task 4.2 — Migrer DelegationPage
Modifier:
- `src/pages/DelegationPage.tsx`

Action:
- remplacer l’écriture directe `localStorage`
- naviguer explicitement vers `/chat`

### Task 4.3 — Migrer AgentStudioWorkspaces
Modifier:
- `src/pages/agent-studio/AgentStudioWorkspaces.tsx`

Action:
- même migration que Delegation

### Task 4.4 — Simplifier useChat
Modifier:
- `src/hooks/useChat.ts`

Action:
- remplacer la lecture brute `localStorage` par `consumeDraft()`

## Phase 5 — Casser les gros monolithes frontend

### 5A — useChat.ts
Créer:
- `src/features/chat/hooks/useChatSession.ts`
- `src/features/chat/hooks/useChatMessages.ts`
- `src/features/chat/hooks/useChatUploads.ts`
- `src/features/chat/hooks/useChatAudio.ts`
- `src/features/chat/hooks/useChatContextFiles.ts`
- `src/features/chat/hooks/useChatDraft.ts`
- éventuellement `src/features/chat/types.ts`

Modifier:
- `src/hooks/useChat.ts`

Action:
- garder la signature publique actuelle
- transformer `useChat.ts` en façade orchestratrice

Ordre d’extraction recommandé:
1. draft intake
2. audio
3. uploads/images
4. session/message append
5. context resolution

### 5B — AgentStudioWorkspaces.tsx
Créer:
- `src/pages/agent-studio/components/WorkspaceListPanel.tsx`
- `src/pages/agent-studio/components/WorkspaceEditorPanel.tsx`
- `src/pages/agent-studio/components/WorkspaceRunPanel.tsx`
- `src/pages/agent-studio/components/WorkspaceTemplatePanel.tsx`
- `src/pages/agent-studio/hooks/useWorkspaceExecution.ts`
- `src/pages/agent-studio/hooks/useWorkspaceCrud.ts`

Modifier:
- `src/pages/agent-studio/AgentStudioWorkspaces.tsx`

Action:
- séparer:
  - CRUD workspace
  - sélection
  - exécution
  - template binding
  - génération de prompt

### 5C — TemplatesPage.tsx
Après phase 1:
- vérifier qu’il ne reste qu’une page-shell

### 5D — KanbanPage.tsx
Créer:
- `src/pages/kanban/components/KanbanBoard.tsx`
- `src/pages/kanban/components/KanbanToolbar.tsx`
- `src/pages/kanban/components/KanbanTaskPanel.tsx`
- `src/pages/kanban/hooks/useKanbanBoard.ts`

Modifier:
- `src/pages/KanbanPage.tsx`

### 5E — ConfigPage.tsx
Créer:
- `src/pages/config/sections/ModelsConfigSection.tsx`
- `src/pages/config/sections/ProvidersConfigSection.tsx`
- `src/pages/config/sections/ToolsConfigSection.tsx`
- `src/pages/config/sections/EnvironmentConfigSection.tsx`

Modifier:
- `src/pages/ConfigPage.tsx`

## Phase 6 — Alléger le bootstrap backend

### Task 6.1 — Extraire la création d’app Express
Créer:
- `server/app.mjs`
- `server/bootstrap/configure-middleware.mjs`
- `server/bootstrap/configure-routes.mjs`
- `server/bootstrap/configure-error-handlers.mjs`

Modifier:
- `server/index.mjs`

Action:
- `index.mjs` doit surtout:
  - charger env/config
  - construire l’app
  - faire `listen()`

### Task 6.2 — Centraliser le montage des routes
Modifier:
- `server/bootstrap/configure-routes.mjs`
- `server/routes/*.mjs`

Action:
- rendre le câblage backend lisible depuis un seul fichier
- commenter explicitement les routes legacy si conservées

### Task 6.3 — Isoler la logique système Hermes si encore mélangée
Créer si nécessaire:
- `server/services/runtime-service.mjs`
- `server/services/profile-service.mjs`
- `server/services/gateway-service.mjs`

## Phase 7 — Réduire le bruit Context/Provider

### Task 7.1 — Revoir GatewayContext/GatewayProvider
Modifier:
- `src/contexts/GatewayContext.tsx`
- `src/contexts/GatewayProvider.tsx`

Option:
- déplacer vers `src/features/runtime/GatewayState.tsx`

### Task 7.2 — Revoir ProfileContext/ProfileProvider
Modifier:
- `src/contexts/ProfileContext.tsx`
- `src/contexts/ProfileProvider.tsx`

Option:
- déplacer vers `src/features/profiles/ProfileState.tsx`

## Phase 8 — Clarifier le produit dans la navigation

Modifier:
- `src/components/Sidebar.tsx`
- `src/hooks/useNavigation.ts`
- `src/App.tsx`
- éventuellement `src/pages/HomePage.tsx`

Navigation principale recommandée:
- Chat
- Sessions
- Identity
- Templates
- Workspaces
- System

Action:
- reléguer les surfaces secondaires en niveau expert/secondaire si nécessaire
- vérifier si `Home` garde une vraie valeur distincte

## Phase 9 — Nettoyage lint et dette légère

### Task 9.1 — Corriger les warnings React hooks
Modifier:
- `src/hooks/chatAudioController.ts`
- `src/hooks/chatAudioRuntime.ts`
- `src/hooks/useChat.ts`

Action:
- corriger dépendances `useEffect` / `useCallback`
- extraire fonctions stables si besoin

### Task 9.2 — Réduire le bruit placeholder/TODO
Parcourir:
- `src/**/*.tsx`

Action:
- classer les placeholders:
  - vrai placeholder temporaire
  - copy neutre acceptable
  - UI morte
- supprimer l’UI morte

## 11. Ordre exact recommandé

Ordre safe/strangler:
1. docs de cible
2. unifier Templates/library
3. unifier runtime source unique
4. supprimer legacy/API doublons
5. remplacer le bridge Chat
6. casser les gros monolithes frontend
7. alléger `server/index.mjs`
8. simplifier Context/Provider
9. ajuster navigation
10. nettoyer warnings/placeholders

## 12. Séquence de commits recommandée

- `docs: add target architecture and refactor checklist`
- `refactor: extract canonical templates library panel`
- `refactor: remove duplicated template library logic from workspaces`
- `refactor: unify runtime status under gateway state`
- `refactor: remove profile runtime duplication`
- `refactor: remove legacy soul page and api aliases`
- `refactor: replace chat localStorage bridge with explicit draft service`
- `refactor: split useChat into focused hooks`
- `refactor: split agent studio workspaces into panels and hooks`
- `refactor: split kanban page into board modules`
- `refactor: split config page into section components`
- `refactor: extract express app bootstrap from server index`
- `refactor: simplify context/provider layout`
- `chore: fix remaining react hook warnings`

## 13. Critères de succès finaux

Le refactor est réussi si:
- `TemplatesPage` et `AgentStudioWorkspaces` ne dupliquent plus la library
- il n’existe plus qu’une source de vérité runtime
- `SoulPage` a disparu ou a une vraie utilité
- `src/api.ts` n’expose plus d’alias ou méthodes orphelines inutiles
- les flux Delegation/Workspace → Chat ne dépendent plus directement de `localStorage`
- `useChat.ts`, `AgentStudioWorkspaces.tsx`, `KanbanPage.tsx`, `ConfigPage.tsx`, `server/index.mjs` sont nettement réduits
- la navigation reflète les vraies briques produit
- tests/build/lint restent verts à chaque lot

## 14. Les 10 fichiers à traiter en premier

1. `src/pages/TemplatesPage.tsx`
2. `src/pages/agent-studio/AgentStudioWorkspaces.tsx`
3. `src/features/templates/components/TemplatesLibraryPanel.tsx`
4. `src/features/templates/hooks/useTemplatesLibrary.ts`
5. `src/hooks/useGateway.ts`
6. `src/contexts/ProfileProvider.tsx`
7. `src/api.ts`
8. `src/pages/DelegationPage.tsx`
9. `src/hooks/useChat.ts`
10. `server/index.mjs`

## 15. Priorisation pratique

Meilleur ratio impact/risque:
- d’abord Templates/library
- ensuite runtime source unique
- ensuite bridge Chat
- ensuite éclatement des gros fichiers

C’est le meilleur chemin pour récupérer rapidement de la simplicité lego sans réécrire l’application.
