# Product Roadmap

## Current direction

Hermes Desktop is moving toward a desktop-first operator experience built around:

1. chat as the primary surface
2. persistent session continuity
3. honest runtime visibility
4. profile-aware editing of Hermes files and settings

## Already delivered

- chat is the main entry point
- the app keeps the runtime bridge between Windows and WSL
- frontend lint and production build are both clean
- Electron can auto-start the local backend when needed

## Near-term roadmap

### 1. Better desktop polish

- keep README screenshots current when major UI changes land
- publish the first Windows installer release
- add release notes for each packaged build

### 2. Runtime transparency

- improve diagnostics when the backend is online but the gateway is degraded
- expose more actionable status details in the dashboard
- add smoke tests for launch preconditions

### 3. Content management

- expand CRUD coverage for hooks and plugins
- improve config editing validation
- keep profile and workspace files easier to inspect and edit

### 4. Backend maintainability

- split `server/index.mjs` into smaller modules
- isolate runtime, file, session, and gateway responsibilities
- make launcher logic easier to test
