# Repository Notes

## Current validation

The current repository baseline is green:

- `npm run lint`: passes
- `npm run build`: passes

## Public naming versus internal compatibility

The public product name is `Hermes Desktop`.

Some internals still keep historical `builder` names:

- environment variables such as `HERMES_BUILDER_PORT`
- the local state folder `.hermes-builder/`
- a backward-compatible health route alias
- fallback support for `hermes-builder.local.cmd`

These are compatibility details, not product branding requirements.

## Recommended repository model

Use a split workflow:

1. canonical source and git history live in WSL
2. commits and pushes happen from WSL
3. Windows is a mirror for Electron packaging and launcher validation

This avoids cross-platform `node_modules` conflicts and keeps the runtime environment close to Hermes itself.

## One-click launch model

The recommended operator entrypoint is:

- `start-hermes-desktop.bat`

The launcher should stay generic and:

1. load only ignored local overrides
2. start the WSL gateway only when health checks fail
3. start Electron only after the gateway is reachable

## Remaining technical risks

- `server/index.mjs` is still large and would benefit from modularization
- the desktop flow still depends on `wsl.exe` and a working Hermes CLI inside the configured distro
- native Linux packaging is not implemented yet

## Recommended next steps

- choose and add a license file
- commit a clean screenshot for the README
- add a first Windows installer release from `npm run desktop:build`
