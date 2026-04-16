# Hermes Builder -> WSL Source of Truth Migration Plan

> For Hermes: migrate the primary Hermes Builder source tree into WSL, keep Windows as a mirror/build target, and avoid breaking the current Windows + WSL operator flow.

Goal: make `/home/nabs/.hermes/hermes-builder` the canonical development worktree while preserving `C:\Users\GAMER PC\.hermes\hermes-builder` for Windows launchers, Electron packaging, and release artifacts.

Architecture:
- canonical source lives in WSL ext4: `/home/nabs/.hermes/hermes-builder`
- Windows mirror remains at `C:\Users\GAMER PC\.hermes\hermes-builder`
- development, edits, installs, and runtime verification happen primarily in WSL
- Windows side is used for desktop integration, `.bat/.cmd` launchers, and Windows packaging validation

Tech stack:
- existing React + TypeScript + Vite frontend
- existing Express backend in `server/index.mjs`
- Electron shell in `electron/*.mjs`
- sync/mirror workflow to be defined after migration

---

## Verified baseline before migration

Current facts verified locally:
- `/home/nabs/.hermes/hermes-builder` does not exist yet
- `/mnt/c/Users/GAMER PC/.hermes/hermes-builder` is the only current Hermes Builder worktree
- current Windows-side builder builds successfully with `npm run build`
- current Windows-side desktop packaging works with `npm run desktop:pack`
- current project is not a git repository yet

---

## Migration strategy

### Phase 0: Freeze and inventory

Objective: capture the current Windows-side state before copying anything.

Files/areas:
- Source: `/mnt/c/Users/GAMER PC/.hermes/hermes-builder`
- Plan doc: `docs/plans/2026-04-12-wsl-source-of-truth-migration.md`

Steps:
1. Verify build on the Windows-side worktree:
   - `npm run build`
2. Verify Electron packaging baseline:
   - `npm run desktop:pack`
3. Record key top-level directories to preserve:
   - `src/`
   - `server/`
   - `electron/`
   - `public/`
   - `docs/`
   - config files like `package.json`, `vite.config.ts`, `tsconfig*.json`
4. Identify non-source directories that should not become canonical source history:
   - `node_modules/`
   - `dist/`
   - `release/`
   - log files like `.dev-out.log`, `.dev-err.log`

Verification:
- build passes before migration
- list of copy/include vs regenerate/exclude is explicit

### Phase 1: Create the WSL canonical worktree

Objective: create `/home/nabs/.hermes/hermes-builder` as the new primary source tree.

Create:
- `/home/nabs/.hermes/hermes-builder`

Copy/include from Windows source:
- `src/`
- `server/`
- `electron/`
- `public/`
- `docs/`
- `.gitignore`
- `README.md`
- `package.json`
- `package-lock.json`
- `vite.config.ts`
- `eslint.config.js`
- `index.html`
- `tsconfig.json`
- `tsconfig.app.json`
- `tsconfig.node.json`
- launcher scripts if we explicitly want to keep them versioned there

Exclude from canonical copy:
- `node_modules/`
- `dist/`
- `release/`
- `server/node_modules/` if present separately
- transient logs
- editor-local junk

Recommended copy command shape:
- use `rsync -a --delete` or an equivalent filtered copy
- do not manually drag-and-drop or use an unfiltered recursive copy

Verification:
- `/home/nabs/.hermes/hermes-builder/package.json` exists
- `/home/nabs/.hermes/hermes-builder/src/App.tsx` exists
- no copied `node_modules/`, `dist/`, or `release/` in canonical source

### Phase 2: Reinstall and validate inside WSL

Objective: prove the WSL tree is independently healthy.

Workdir:
- `/home/nabs/.hermes/hermes-builder`

Steps:
1. Install root dependencies:
   - `npm install`
2. If the backend has a separate package area that must be installed independently, verify and install there too.
3. Run syntax/build validation:
   - `npm run build`
4. Run local backend/dev startup:
   - `npm run dev`
5. Verify Builder health:
   - `http://127.0.0.1:3020/api/builder/health`
6. Verify the UI opens and the refonte is intact.

Verification:
- WSL build passes
- health endpoint returns 200
- Home/Chat/Sessions routes still load
- Electron entry files still parse cleanly from the WSL source tree

### Phase 3: Define Windows as mirror/build target only

Objective: stop treating the Windows folder as the edit-first source of truth.

Windows role after migration:
- `.bat/.cmd` launchers
- Windows desktop launch testing
- NSIS/Electron Windows packaging
- optional release staging

Practical rule:
- all code edits happen in `/home/nabs/.hermes/hermes-builder`
- Windows copy is refreshed from WSL when needed for packaging or Windows-native testing

Recommended mirror directions:
- preferred: WSL -> Windows one-way mirror
- avoid: editing both trees independently

Verification:
- team/operator rule is explicit: one canonical source, one mirror
- no ambiguous dual-edit workflow remains

### Phase 4: Add a repeatable sync command

Objective: make the mirror update cheap and deterministic.

Recommended script location:
- `/home/nabs/.hermes/scripts/sync-hermes-builder-to-windows.sh`

Suggested behavior:
- source: `/home/nabs/.hermes/hermes-builder/`
- target: `/mnt/c/Users/GAMER PC/.hermes/hermes-builder/`
- include source/config/docs/scripts
- exclude generated dirs:
  - `node_modules/`
  - `dist/`
  - `release/`
  - `.dev-*.log`
  - `server/.builder-*.log`

Recommended command pattern:
- `rsync -a --delete --exclude ... SOURCE/ TARGET/`

Verification:
- sync updates changed source files only
- target mirror remains lean
- generated assets are rebuilt on the side where they are needed

### Phase 5: Optional repo initialization

Objective: stop doing migration work without version control.

Workdir:
- `/home/nabs/.hermes/hermes-builder`

Steps:
1. Decide whether this should become its own git repo.
2. If yes:
   - `git init`
   - verify `.gitignore`
   - initial commit after WSL validation
3. If no:
   - at minimum keep the sync script and plan docs current

Verification:
- source of truth is trackable and recoverable

---

## Recommended execution order

1. Copy Windows source -> WSL with exclusions
2. Install dependencies fresh in WSL
3. Validate `npm run build` in WSL
4. Validate `npm run dev` and health endpoint in WSL
5. Add sync script WSL -> Windows
6. Use Windows mirror only for Electron/NSIS validation
7. Optionally initialize git in the WSL canonical tree

---

## Risks and pitfalls

- Do not copy `node_modules/` across filesystems as canonical project content
- Do not keep editing both WSL and Windows trees in parallel
- Do not let `release/` artifacts become part of source-of-truth synchronization
- Do not assume the Windows launcher scripts should remain the primary runtime entrypoint for development
- Verify backend path assumptions after migration if any code hardcodes the Windows path as the builder home

---

## Acceptance criteria

Migration is successful when:
- `/home/nabs/.hermes/hermes-builder` exists and builds successfully
- this WSL tree is the only edit-first source tree
- `/mnt/c/Users/GAMER PC/.hermes/hermes-builder` is refreshed from WSL, not edited independently
- Builder web app still runs on `3020`
- Electron shell files remain intact and package from the mirrored Windows side when needed
