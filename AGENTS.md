# Codex Conventions — SPRITEbot

Read this before writing code. It describes the architecture, required
patterns, and conventions for this project.

For implementation plans, see `plans/`.

---

## Architecture

### Stack

- **Runtime:** Node.js 22 (TypeScript, ES2022 target, `node16` module resolution)
- **Discord library:** discord.js v14
- **Database:** PostgreSQL 18 (`pg` driver with connection pool)
- **Testing:** Jest (PGlite for DB tests)
- **Deployment:** Docker + Docker Compose, Jenkins CI/CD

### Layering

```
Discord Commands → Handlers → Services → DAOs
Components (buttons/selects/modals) → Services → DAOs
Schedulers → Services → DAOs
```

- **DAOs** (`src/dao/*.dao.ts`) — pure data access. Execute SQL queries via
  `pg`, return typed results. No business logic, no Discord awareness.
- **Services** (`src/services/*.service.ts`) — orchestrate business logic.
  Call DAOs, apply rules, return results. No Discord awareness.
- **Commands** (`src/commands/*.ts`) — slash command definitions. Parse
  interaction options, call services, format replies.
- **Components** (`src/components/*.ts`) — interactive UI (buttons, select
  menus, modals). Each exports `id`, `build()`, and `handle()`.
- **Handlers** (`src/handlers/`) — route button/select/modal interactions
  to the correct component handler via customId matching.
- **Access** (`src/access/`) — entitlements, feature gating, guards, and
  bypass logic.
- **Utils** (`src/utils/`) — shared pure utilities (dice roller, response
  builders, validation helpers).
- **Schedulers** (`src/schedulers/`) — timed background tasks (thread bumps).
- **Voice** (`src/voice/`) — voice channel audio receive/transcription pipeline.

### Directory structure

```
src/
  index.ts              — entry point (boot Discord client)
  access/               — entitlements, feature gates, guards, bypass
  client/
    initial_commands.ts — slash command registration
  commands/             — slash command definitions (one file per command)
  components/           — interactive components (buttons, selects, modals)
  config/
    env_config.ts       — environment variable loading and validation
    bump_config.ts      — thread bump configuration
    system_constants.ts — shared constants
  dao/                  — database access objects
  db/
    client.ts           — pg Pool wrapper (PGlite in tests)
    db.ts               — connection test + schema initialization
    sql-loader.ts       — SQL file reader
    tables/
      tables.sql        — schema DDL
  handlers/             — interaction routing (buttons, selects, modals)
  schedulers/           — timed background tasks
  services/             — business logic
  types/                — shared TypeScript types
  utils/                — shared utilities
  voice/                — voice receive + transcription
```

---

## Database

### Connection

Uses the `pg` Pool pattern in `src/db/client.ts`:

- Production: `pg.Pool` connecting via env vars
- Tests: PGlite in-memory database with schema applied from `tables.sql`

Export a `query<T>()` function and an `initDb()` function.

### SQL files

Schema DDL lives in `src/db/tables/tables.sql`. Use the SQL loader pattern
to read SQL files at runtime. The `copy-sql` build script copies SQL files
to `dist/`.

### Naming

- Table names: `snake_case`, plural (`games`, `characters`, `players`,
  `stat_templates`)
- Column names: `snake_case`
- Primary keys: `id` (use `gen_random_uuid()` via pgcrypto)
- Foreign keys: `<entity>_id` (e.g., `game_id`, `character_id`)
- Timestamps: `created_at`, `updated_at`

### DAO functions

| Operation | Naming pattern      | Example                |
| --------- | ------------------- | ---------------------- |
| Read one  | `get*`              | `getGame`              |
| List      | `get*s` / `get*By*` | `getGamesByGuild`      |
| Create    | `create*`           | `createGame`           |
| Update    | `update*`           | `updateCharacterStats` |
| Upsert    | `upsert*`           | `upsertStatTemplate`   |
| Delete    | `delete*`           | `deleteStatTemplate`   |

---

## Discord Commands

### Registration

Slash commands are defined in `src/commands/` and registered in
`src/client/initial_commands.ts` using discord.js `SlashCommandBuilder`.

### Command pattern

Each command file exports `data` (SlashCommandBuilder) and `execute`
(interaction handler). Commands:

1. Extract options from the interaction
2. Call the appropriate service function(s)
3. Reply to the interaction with formatted output

Commands should not contain business logic or direct database calls.

### Component pattern

Each component file (`src/components/*.ts`) exports:

- `id` — the customId prefix (used for interaction routing)
- `build(...)` — constructs the Discord component (button, select menu, etc.)
- `handle(interaction)` — processes the interaction when triggered

Components are routed via the handler files in `src/handlers/`.

---

## Access Control & Entitlements

The `src/access/` module gates commands by feature key:

- **`features.ts`** — defines feature keys and their requirements
- **`authorize.ts`** — checks if a guild/user has access to a feature
- **`guards.ts`** — middleware-style guards for commands
- **`components_policy.ts`** — gates component interactions
- **`bypass.ts`** — owner bypass for development/testing

---

## Environment

### Variables

| Variable            | Required | Description                   |
| ------------------- | -------- | ----------------------------- |
| `DISCORD_TOKEN`     | Yes      | Discord bot token             |
| `DISCORD_CLIENT_ID` | Yes      | Discord application client ID |
| `DATABASE_URL`      | Yes      | PostgreSQL connection string  |
| `OWNER_DISCORD_ID`  | Yes      | Bot owner's Discord user ID   |
| `DEV_GUILD_ID`      | Yes      | Ops/dev guild for admin cmds  |

### Config module

`src/config/env_config.ts` exports typed constants for all env vars.
Validate required vars on import.

---

## Testing

### Structure

```
tests/
  unit/          — service and utility tests
  integration/   — DAO and component tests against PGlite
  e2e/           — full command flow tests
  jest.setup.cjs
  jest.globalSetup.cjs
  jest.globalTeardown.cjs
  README.md
```

### Database tests

Use PGlite (in-memory PostgreSQL). Schema is applied from `tables.sql`
with pgcrypto extensions stripped. Export `resetDb()` to truncate between
tests.

### Running tests

```bash
npm test           # all tests
npm run test:unit  # unit only (if configured)
```

---

## Deployment

### Docker

Multi-stage Dockerfile:

1. **Builder** — install all deps, compile TypeScript, copy SQL
2. **Runtime** — production deps only, install Infisical CLI, copy dist

### Infisical

`entrypoint.sh` authenticates via Universal Auth and runs the app through
`infisical run` to inject secrets. Requires `.env.infisical` on the deploy
host with `INFISICAL_CLIENT_ID`, `INFISICAL_CLIENT_SECRET`,
`INFISICAL_API_URL`, `INFISICAL_PROJECT_ID`, and `INFISICAL_ENV`.

### Jenkins

Jenkinsfile pipeline:

1. Install → Lint → Test → Build → Docker build → Package → Deploy
2. Deploy target: `shinralabs` via SSH
3. GitHub commit status reporting

---

## Code Style

### Linting

- ESLint with `@typescript-eslint`, `eslint-plugin-import`,
  `eslint-plugin-jsdoc`, and Prettier integration
- Config in `eslint.config.js` (CommonJS)

### Prettier

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100
}
```

**Always run `npx prettier --write .` before committing.**

### Git

- Branch from `develop`: `feature/<short-name>`
- Commits: imperative present tense ("Add onboarding nudge utility")
- Deploy branch: `main` or `master` (triggers Jenkins deploy)
- Pre-commit hook: lint + test via Husky

### Imports

Use `module.exports = { data, execute }` pattern for commands (matches
discord.js collection loader). Components use named exports
(`export { id, build, handle }`).
