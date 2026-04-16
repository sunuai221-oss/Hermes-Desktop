# WSL and Windows Workflow

## Recommended source-of-truth model

Hermes Desktop works best with a split workflow:

- WSL is the canonical development and git environment
- Windows is a mirror used for Electron packaging and one-click launcher validation

## Why this model is preferred

- Linux and Windows `node_modules` should not be shared
- Hermes itself lives closer to the WSL runtime
- Electron Windows binaries should be installed only on Windows
- Git behavior is more predictable on the canonical WSL worktree

## Practical workflow

1. edit and test in WSL
2. run `npm run build` and `npm run lint`
3. commit and push from WSL
4. sync into a Windows mirror with `scripts/sync-to-windows.sh`
5. on Windows, run `npm install` if the Electron binaries need to be refreshed
6. validate `start-hermes-desktop.bat`
7. build a Windows package with `npm run desktop:build` when needed

## Sync rules

The Windows mirror should include source and docs, but not generated output:

- include `src/`, `server/`, `electron/`, `public/`, `docs/`, and config files
- exclude `node_modules/`, `dist/`, `release/`, and transient logs

Use filtered sync tools such as `rsync` rather than manual drag-and-drop copies.

## Important constraints

- do not edit the WSL and Windows trees independently
- do not commit generated artifacts from the Windows mirror
- do not assume native Linux desktop packaging is available yet
