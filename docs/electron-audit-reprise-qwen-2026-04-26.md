# Hermes Builder / Electron — audit et consignes de reprise Qwen

Date: 2026-04-26
Cible auditée: `C:\Users\GAMER PC\.hermes\hermes-builder`
Chemin WSL: `/mnt/c/Users/GAMER PC/.hermes/hermes-builder`
Arbre WSL canonique attendu: `/home/nabs/.hermes/hermes-builder`
Runtime Hermes actif: `/home/nabs/.hermes`

## Verdict court

L’app Electron Windows est globalement bien câblée comme shell autour du même backend Builder/Express et du même front React que la web app. Le backend Windows résout bien la source runtime WSL (`\\wsl.localhost\\Ubuntu\\home\\nabs\\.hermes`) et lit/écrit la config, mémoire, sessions, skills, hooks, cron, profils via cette source.

Mais il y a deux problèmes P0 avant toute évolution:

1. Dérive majeure entre le dossier Windows et `/home/nabs/.hermes/hermes-builder`.
   - Le dossier Windows est beaucoup plus avancé: routes backend modulaires, tests, GitHub metadata, launchers locaux, Kokoro TTS, providers, docs, etc.
   - Le dossier WSL `/home/nabs/.hermes/hermes-builder` existe mais est stale/incomplet par rapport à Windows.
   - Ne surtout pas lancer `/home/nabs/.hermes/scripts/sync-hermes-builder-to-windows.sh` maintenant: il écraserait des changements Windows récents avec l’arbre WSL stale.
   - Si Nabs veut que WSL redevienne source de vérité code, faire d’abord une migration `Windows -> WSL`, pas l’inverse.

2. Packaging Electron Windows incomplet à cause du privilège symlink Windows.
   - `npm run build` passe sous Windows.
   - `npm test` passe sous Windows: 33/33.
   - `npm run desktop:pack` échoue pendant l’extraction `winCodeSign-2.6.0.7z`: Windows refuse la création de symlinks (`Le client ne dispose pas d'un privilège nécessaire`).
   - Même avec `CSC_IDENTITY_AUTO_DISCOVERY=false`, l’échec persiste.
   - Correctifs probables: activer Windows Developer Mode, ou lancer le terminal en admin, ou pré-extraire/réparer le cache electron-builder avec privilège symlink.

## Validations exécutées

Depuis Windows CMD via WSL:

```cmd
cd /d C:\Users\GAMER PC\.hermes\hermes-builder
npm run build
```
Résultat: OK. `tsc -b` + `vite build` passent.

```cmd
cd /d C:\Users\GAMER PC\.hermes\hermes-builder
npm test
```
Résultat: OK. 33 tests passés.

```cmd
cd /d C:\Users\GAMER PC\.hermes\hermes-builder
npm run desktop:pack
```
Résultat: build OK, packaging KO sur extraction `winCodeSign` à cause des symlinks.

Depuis WSL dans le dossier Windows:

```bash
cd '/mnt/c/Users/GAMER PC/.hermes/hermes-builder'
npm run build
```
Résultat: KO attendu, binding natif Rolldown Linux manquant (`@rolldown/binding-linux-x64-gnu`). Ce n’est pas un bug TypeScript; c’est le piège node_modules Windows/WSL. Pour Electron Windows, toujours build/test depuis Windows CMD/PowerShell.

Backend observé sur port 3130:

```bash
cd '/mnt/c/Users/GAMER PC/.hermes/hermes-builder'
PORT=3130 HERMES_BUILDER_PORT=3130 node server/index.mjs
```

Note: une tentative de lancement a rencontré `EADDRINUSE` sur 3130, mais les endpoints 3130 ont répondu juste avant/pendant le check. Interprétation: un backend était déjà présent ou a libéré le port ensuite. Ne pas tuer de processus inconnu sans confirmation; vérifier avec `ss -ltnp`/PowerShell avant action.

Endpoints vérifiés:

- `GET http://127.0.0.1:3130/api/desktop/health` -> 200 OK, service `hermes-desktop-backend`, frontend bundled ready.
- `GET http://127.0.0.1:3130/api/builder/health` -> 200 OK.
- `GET http://127.0.0.1:3130/api/gateway/process-status` -> 200 OK, gateway online sur 8642, source `shared-global`, home WSL `\\wsl.localhost\\Ubuntu\\home\\nabs\\.hermes`.
- `GET http://127.0.0.1:3130/api/gateway/health` -> 200 OK.
- `GET http://127.0.0.1:3130/api/config` -> lit `/home/nabs/.hermes/config.yaml` via UNC WSL.
- `GET http://127.0.0.1:3130/api/sessions/stats` -> OK.
- `GET http://127.0.0.1:3130/api/memory` -> OK.
- `GET http://127.0.0.1:3130/api/plugins` -> OK.
- `GET http://127.0.0.1:3130/api/hooks` -> OK.

Browser check sur `http://127.0.0.1:3130/` et `/chat`:

- UI charge correctement.
- Sidebar et routing React Router OK.
- Home landing OK.
- Chat montre runtime/provider/model après hydratation config.
- Pas d’erreurs console observées pendant le chargement Chat.

## Source de vérité runtime WSL

Le backend Windows/Electron choisit le runtime Hermes comme suit dans `server/index.mjs`:

- `resolveHermesHome()` score plusieurs candidats.
- Il détecte WSL via `wsl.exe` et construit un UNC comme `\\wsl.localhost\\Ubuntu\\home\\nabs\\.hermes`.
- `getHermesHome(profileName)` renvoie ce home pour `default`, ou `HERMES_BASE/profiles/<profile>` pour les profils.
- Middleware `hermesContextMiddleware` lit `X-Hermes-Profile` ou `?profile=` puis injecte `req.hermes`.

Conclusion: le desktop Windows est bien câblé à la source runtime WSL. Le problème est la source code WSL, pas la source runtime.

## Config actuelle modèle/provider

Le fichier runtime actif `/home/nabs/.hermes/config.yaml` contient actuellement:

```yaml
model:
  default: gpt-5.3-codex
  provider: openai-codex
  base_url: https://chatgpt.com/backend-api/codex
custom_providers:
- name: llama-cpp-local-8081
  base_url: http://127.0.0.1:8081/v1
  model: Qwen3.6-27B-Q3_K_M
  api_mode: chat_completions
  models:
    Qwen3.6-27B-Q3_K_M:
      context_length: 75264
```

Donc le custom provider Qwen existe bien, mais le modèle par défaut est encore `gpt-5.3-codex` dans `config.yaml` au moment de l’audit. Si Nabs redémarre Hermes avec Qwen local, vérifier que la config effective est bien basculée vers:

```yaml
model:
  default: Qwen3.6-27B-Q3_K_M
  provider: custom
  base_url: http://127.0.0.1:8081/v1
```

Ne pas modifier automatiquement sans accord de Nabs: ce rapport constate seulement l’état.

## Architecture Electron

Fichiers clés Windows:

- `package.json`
  - `main`: `electron/main.mjs`
  - scripts: `desktop`, `desktop:dev`, `desktop:pack`, `desktop:build`
  - build Electron: appId `local.hermes.desktop`, product `Hermes Desktop`, icon `build/icons/hermes.ico`, `asar: false`.
- `electron/main.mjs`
  - démarre ou réutilise le backend Builder sur `HERMES_DESKTOP_BACKEND_PORT || HERMES_BUILDER_PORT || PORT || 3020`.
  - health check sur `/api/desktop/health`.
  - spawn backend avec `ELECTRON_RUN_AS_NODE=1`.
  - charge `http://127.0.0.1:<port>` dans BrowserWindow.
  - fond dark/light aligné avec le thème.
  - external links ouverts via `shell.openExternal`.
- `electron/preload.mjs`
  - expose `window.hermesDesktop = { platform: 'electron', version }`.

Évaluation: bonne séparation. Electron est un shell, pas un fork logique. C’est exactement la bonne approche.

Risques restants Electron:

- `asar: false` acceptable en dev, à revoir pour packaging final (`asar + asarUnpack` si nécessaire).
- `author` absent dans `package.json`, electron-builder le signale.
- `desktop:pack` dépend de winCodeSign/cache et échoue sans privilège symlink.
- Besoin d’un vrai test GUI Windows avec `start-hermes-desktop.bat` après correction symlink.

## Routing et navigation

`src/App.tsx` utilise React Router:

- `/` -> Home
- `/chat` -> Chat
- `/sessions` -> Sessions
- `/automations` -> Automations
- `/identity` -> Agent Studio/Soul+Memory
- `/skills` -> Skills
- `/profiles` -> Profiles
- `/config` -> Runtime
- `/context-files` -> Context Files
- `/extensions` -> Extensions
- `/delegation` -> Delegation
- `/platforms` -> Platforms
- redirects: `/memory -> /identity`, `/gateway -> /config`, `/providers -> /config`, `/plugins -> /extensions`, `/hooks -> /extensions`

`src/hooks/useNavigation.ts` est la source unique de navigation. C’est sain.

## Matrice pages -> API -> source WSL/gateway

Home
- APIs: `api.cronjobs.list`, `api.memory.get`; lit aussi l’état gateway via contexte.
- Source WSL: oui, mémoire + cron.
- Gateway: indirect pour status runtime.
- Évaluation: bonne page cockpit. Rôle clair comme entrée produit.

Chat
- APIs via `useChat`: `sessions.create`, `sessions.transcript`, `sessions.appendMessages`, `gateway.streamChat`, fallback `gateway.chat`, `voice.respond`, images/context refs selon usage.
- Source WSL: oui, sessions, images, voice temp, config.
- Gateway: oui, `/api/gateway/chat/stream` et fallback non-stream.
- Évaluation: bien câblé. Session active persistée par profil. Le streaming route ne persiste pas directement côté gateway route, mais le hook frontend crée la session et appelle `sessions.appendMessages` en fin de stream; acceptable. À surveiller: messages voix (`voice.respond`) sont affichés mais leur persistance session n’est pas évidente dans le hook.

Sessions
- APIs: list/stats/resume/create/delete/rename/prune/export.
- Source WSL: oui, sessions SQLite/files.
- Gateway: non direct.
- Évaluation: bon centre mémoire conversationnelle. Ouverture vers Chat câblée via `onOpenSessionInChat`.

Automations
- APIs: cronjobs list/create/update/action/outputs.
- Source WSL: oui, cron jobs et outputs.
- Gateway: non direct.
- Évaluation: UI propre, split list/detail, menus actions. Bien placée dans Automation.

Agent Studio (`/identity`)
- APIs: soul get/save, memory get/save/search, agents list/save/apply.
- Source WSL: oui, SOUL/memory/config agents.
- Gateway: non direct.
- Évaluation: page riche et logique pour identité durable. Attention à ne pas surcharger; mais c’est mieux que pages Soul/Memory séparées.

Skills
- APIs: skills list/create/getContent/save/delete.
- Source WSL: oui, skills locales + externes.
- Gateway: non direct.
- Évaluation: utile et bien reliée au système réel. Suppression passe par confirm in-app, pas raw browser dialog.

Profiles
- APIs: profiles metadata via API + ProfileContext pour create/delete/start/stop.
- Source WSL: oui, `profiles/<name>` sous home WSL.
- Gateway: oui pour status/start/stop.
- Évaluation: bonne page identité/runtime. À garder; elle est centrale pour multi-profils.

Runtime (`/config`)
- APIs: config get/save.
- Source WSL: oui, écrit `config.yaml` actif selon profil.
- Gateway: status via contexte.
- Évaluation: critique et bien câblée. Les champs `Default model`, `Provider`, `Base URL`, `Context window` permettent bien de basculer Qwen/local provider. UX encore un peu admin, mais pertinente.

Context Files
- APIs: contextFiles get/save.
- Source WSL: oui, fichiers de contexte startup/nested/cursor.
- Gateway: non direct.
- Évaluation: bonne page expert. Indicateurs modified et filtre unifié OK.

Extensions
- APIs: plugins list, hooks list.
- Source WSL: oui, plugins/hooks.
- Gateway: non direct.
- Évaluation: fusion Plugins/Hooks saine. Les anciennes routes redirigent.

Delegation
- APIs: config save pour defaults; action de délégation probablement via config/page state selon code.
- Source WSL: oui pour config.
- Gateway: dépendra du runtime pour exécution réelle si action ajoutée.
- Évaluation: page expert utile, à garder dans Automation. Vérifier ultérieurement le chemin d’exécution des tâches si Nabs veut l’utiliser intensivement.

Platforms
- APIs: aucune détectée.
- Source WSL: non.
- Gateway: non.
- Évaluation: page placeholder/catalogue. Faible valeur actuelle, mais acceptable si destinée à connecter Telegram/Discord/etc. À déprioriser dans Electron.

Docs
- Ouvre `https://hermes-agent.nousresearch.com/docs/` via `window.open`.
- En Electron, `setWindowOpenHandler` l’envoie vers navigateur externe.
- Évaluation: OK.

Routes legacy
- `/memory`, `/gateway`, `/providers`, `/plugins`, `/hooks` servent bien l’index SPA puis React redirige.
- Évaluation: OK pour compat.

## Qualité frontend

Points solides:

- React Router en place.
- Navigation centralisée dans `useNavigation.ts`.
- Home + Chat en Core, bon positionnement produit.
- ProfileProvider ne fait plus de full reload sur switch profil.
- Status runtime unifié via `useRuntimeStatus`.
- Raw `window.alert/confirm/prompt/location.reload` non détectés dans `src/**/*.tsx`; confirmations/prompts passent par FeedbackContext.
- Branding Hermes présent: wordmark, anime art, icons.

Points à surveiller:

- Certaines pages restent très longues (`ConfigPage.tsx` 567 lignes, `SoulPage.tsx` 466, `AutomationsPage.tsx` 481, `ExtensionsPage.tsx` 442). Pas urgent, mais à refactorer si évolution lourde.
- Chat montre d’abord un fallback `qwen3.5:27b` pendant l’hydratation, puis affiche la config réelle. Pas bloquant, mais peut créer une impression de mismatch au premier rendu.
- `PlatformsPage` est quasi statique: le garder bas dans la hiérarchie.
- Le champ `custom_providers` est présent dans config mais la page Runtime expose surtout `model.default/provider/base_url`; OK pour bascule manuelle, mais pas encore un sélecteur provider local premium.

## État Git / modifications Windows

Dans le dossier Windows, Git existe et `git status --short` indique des modifications non commitées:

- `package-lock.json`
- `run-gateway-wsl.cmd`
- `server/index.mjs`
- `server/package-lock.json`
- `server/routes/gateway.mjs`
- `server/tests/agents-config.test.mjs`
- `server/voice_tools.py`
- `src/api.ts`
- `src/components/chat/ChatMessages.tsx`
- `src/contexts/ProfileProvider.tsx`
- `src/hooks/useChat.ts`
- `src/hooks/useGateway.ts`
- `src/pages/ChatPage.tsx`
- `src/pages/ConfigPage.tsx`
- `src/types.ts`
- `start-hermes-desktop-dev.bat`
- `start-hermes-desktop.bat`
- nouveaux: `server/services/kokoro-tts.mjs`, `server/tests/kokoro-tts.test.mjs`

Ne pas reset, ne pas checkout, ne pas synchroniser sans décision de Nabs.

## Consignes impératives pour reprise par Qwen local

Quand Hermes redémarre avec Qwen3.6-27B-Q3_K_M, reprendre ici:

1. Lire ce fichier en premier:
   - `C:\Users\GAMER PC\.hermes\hermes-builder\docs\electron-audit-reprise-qwen-2026-04-26.md`
   - WSL: `/mnt/c/Users/GAMER PC/.hermes/hermes-builder/docs/electron-audit-reprise-qwen-2026-04-26.md`

2. Ne pas lancer le script suivant tant que l’arbre WSL n’a pas été réaligné:
   - `/home/nabs/.hermes/scripts/sync-hermes-builder-to-windows.sh`
   - Raison: `/home/nabs/.hermes/hermes-builder` est stale et écraserait le Windows builder avancé.

3. Si Nabs demande de rétablir WSL comme source de vérité code:
   - Faire d’abord un backup ou au minimum un dry-run comparatif.
   - Copier `Windows -> WSL` avec exclusions (`node_modules`, `dist`, `release`, `.git` à décider, logs, `.vscode`).
   - Ensuite seulement recréer un flux `WSL -> Windows`.
   - Ne jamais faire `WSL -> Windows` depuis l’état actuel.

4. Pour validation Windows/Electron, toujours utiliser Windows CMD/PowerShell:

```cmd
cd /d C:\Users\GAMER PC\.hermes\hermes-builder
npm run build
npm test
```

5. Pour tester backend sans toucher le port standard:

```bash
cd '/mnt/c/Users/GAMER PC/.hermes/hermes-builder'
PORT=3130 HERMES_BUILDER_PORT=3130 node server/index.mjs
curl http://127.0.0.1:3130/api/desktop/health
curl http://127.0.0.1:3130/api/gateway/process-status
```

6. Pour Electron packaging, le prochain vrai blocage à résoudre est Windows symlink privilege:
   - Activer Windows Developer Mode OU lancer terminal en administrateur.
   - Relancer:

```cmd
cd /d C:\Users\GAMER PC\.hermes\hermes-builder
npm run desktop:pack
```

7. Vérifier la config Qwen locale avant de tester Chat:
   - API: `http://127.0.0.1:3130/api/config`
   - fichier: `/home/nabs/.hermes/config.yaml`
   - attendu si Qwen local est voulu:

```yaml
model:
  default: Qwen3.6-27B-Q3_K_M
  provider: custom
  base_url: http://127.0.0.1:8081/v1
```

8. Ne pas faire de test Chat intrusif sans accord si cela crée une session dans `/home/nabs/.hermes/sessions`.

## Backlog priorisé

P0 — cohérence et sécurité de reprise

- Décider officiellement quelle source code est canonique.
- Recommandation: prendre le dossier Windows actuel comme base réelle, puis migrer vers WSL si Nabs veut WSL comme source de vérité.
- Bloquer/renommer temporairement le sync script WSL->Windows ou ajouter un garde-fou tant que WSL est stale.
- Corriger packaging Electron: symlink privilege winCodeSign.

P1 — desktop readiness

- Tester `start-hermes-desktop.bat` en GUI Windows après correction packaging/symlink.
- Ajouter `author` dans `package.json`.
- Décider `asar: false` vs `asar + asarUnpack`.
- Nettoyer duplicates dependency warnings si nécessaire.
- Ajouter un check launcher qui affiche clairement si la config runtime pointe vers OpenAI/Codex ou Qwen local.

P2 — produit/UI

- Améliorer Runtime avec un vrai selector provider local (`custom_providers`) au lieu de champs texte seulement.
- Supprimer le fallback visuel `qwen3.5:27b` au premier rendu Chat; afficher `loading config…` jusqu’à hydratation.
- Clarifier persistance des messages voix dans sessions.
- Réduire ou refactorer les très grosses pages si nouvelle évolution.
- Déprioriser Platforms tant qu’il n’y a pas d’intégrations actives.

## Conclusion

L’app Electron est bien orientée: shell desktop autour du Builder existant, backend Express unique, runtime WSL réel, React Router, Home/Chat/Sessions solides. Le problème principal n’est pas le câblage Electron; c’est la dérive de source code entre Windows et WSL, plus le packaging Windows bloqué par les symlinks electron-builder.
