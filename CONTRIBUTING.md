# Contributing to Hermes Desktop

Thank you for your interest in improving Hermes Desktop.

## Before You Start

This project is Windows-first at the desktop layer and WSL-first at the Hermes runtime layer.

Please keep these constraints in mind:

- Hermes Desktop is the public product name.
- Some internal `builder` names remain in place for backward compatibility.
- Do not rename compatibility-sensitive identifiers casually.
- Avoid changes that break the Windows + WSL launch flow unless they are part of an explicit migration.

## Local Setup

For a fresh clone on Windows:

```powershell
npm run setup
Copy-Item hermes-desktop.local.cmd.example hermes-desktop.local.cmd
```

Then adjust `hermes-desktop.local.cmd` for your machine.

If you work from a canonical WSL repository and sync into Windows, reinstall Windows dependencies in the Windows mirror before testing Electron.

## Development Workflow

Recommended flow:

1. make focused changes
2. keep documentation in sync when behavior or onboarding changes
3. run quality checks before opening a pull request

Useful commands:

```powershell
npm run install:server
npm run lint
npm run build
npm run check
```

## Pull Requests

Please keep pull requests:

- focused on one change or one clearly related set of changes
- explicit about Windows and WSL impact
- clear about whether a change affects compatibility with older `builder` names

When relevant, include:

- reproduction steps
- validation steps
- screenshots for UI changes
- notes about new environment variables or launcher behavior

## Documentation and Naming

Prefer `Hermes Desktop` in public-facing documentation.

If you must reference a legacy `builder` name:

- explain why it still exists
- keep the explanation short
- avoid presenting it as a separate product

## Reporting Bugs

Use GitHub Issues for normal bugs and usability problems.

For security issues, follow `SECURITY.md` instead of opening a public issue.
