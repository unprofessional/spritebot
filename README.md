# Spritebot

`Spritebot` is a Discord bot for running lightweight RPG campaigns inside a server. It combines campaign setup, character management, inventory tracking, and Discord-native interaction flows with a PostgreSQL backend.

The project also includes platform-style features beyond the RPG core:

- Discord entitlement-based feature gating for premium capabilities
- Automatic thread bumping to keep selected threads alive before they archive
- Admin housekeeping tools and automated stale-row cleanup

## What It Does

At a high level, the bot supports:

- Creating a game/campaign per Discord server
- Defining game-specific stat templates such as `HP`, `Strength`, or `Skills`
- Letting players join a game and switch their active game context
- Creating and editing characters through Discord components and modals
- Viewing character sheets and public characters
- Managing character inventory
- Letting players proxy in-character posts through webhooks with `/ic` and `/ooc`
- Auto-bumping registered Discord threads on a schedule
- Cleaning up stale operational data through reviewed admin tools and a background scheduler
- Restricting certain commands behind subscription/entitlement checks

## Command Overview

The repo currently defines these slash and context-menu commands:

- `/create-game` - Create a campaign for the current server
- `/view-game` - View the current active game
- `/list-games` - Show game information for the server
- `/join-game` - Join a public game in the current server
- `/switch-game` - Switch your active game
- `/create-character` - Start a new character draft for your active game
- `/view-character` - View your active character
- `/list-characters` - List public characters in the active game
- `/switch-character` - Switch your active character
- `/restore-character` - Restore one of your recently deleted characters in your current game
- `/roll` - Roll dice from `1d2` through `15d999`
- `/ic` - Set your messages in the current channel to in-character proxy mode
- `/ooc` - Set your messages in the current channel to out-of-character mode
- `/ic-edit` - Edit one of your tracked proxied in-character messages
- `Edit IC Message` - Right-click a proxied message to edit it
- `/ic-delete` - Delete one of your tracked proxied in-character messages
- `Delete IC Message` - Right-click a proxied message to delete it
- `/inventory` - View and manage inventory for your active character
- `/bump-thread` - Register and manage auto-bumped threads
- `/bot-announcements` - Configure lifecycle announcement channels for this server
- `/subscribe` - View or manage the server's Discord Premium App subscription
- `/support` - Get an invite to the SPRITEbot support server
- `/verify` - Verify subscriber/player status in the support server
- `/verify-greeting` - Owner-only support server setup command for posting the Verify button
- `/admin` - Admin and GM housekeeping audits, purge previews, and restore tools
- `/gift` - Owner-only gifted access management in the ops and support servers
- `/toggle-bypass` - Ops-only entitlement bypass toggle

Some commands are available to everyone, while others are gated by feature access. The mapping currently lives in [src/access/features.ts](/Users/power/dev/devcru/spritebot/src/access/features.ts).

For a player- and GM-facing usage guide, see [INSTRUCTIONS.md](/Users/power/dev/devcru/spritebot/INSTRUCTIONS.md).

## Core Concepts

### Games

A `game` is the campaign container for a server. It stores:

- Name
- Description
- GM/creator
- Whether the game is public

Games can define their own stat templates so each campaign can decide what a character sheet should look like.

### Characters

A `character` belongs to:

- A user
- A game

Characters include built-in fields like:

- Name
- Bio
- Avatar URL
- Visibility

They also include game-defined stat fields and optional custom fields.

Character deletion is a soft-delete. Players have 30 days to restore their own deleted characters
with `/restore-character`; restored characters return as private. The bot owner can use
`/admin restore-character` to restore a soft-deleted character by ID while the row still exists.

### Inventory

Each character can have inventory entries with a text name, optional type/category, optional
description, quantity, equipped state, and per-item custom fields stored separately in the database.
The character card opens inventory in a separate paginated view so large item lists do not crowd the
main character sheet.

### Dice Roller

Players can use `/roll dice:<expression>` for quick table rolls. The command accepts strict dice
notation like `2d20` or `2D20`. Supported rolls range from `1d2` through `15d999`, and the roller
uses Node's cryptographic random integer generator instead of `Math.random`.

### Roleplay Proxy

Players can use `/ic` and `/ooc` to toggle whether their own messages in the current channel should be proxied through a Discord webhook as their active character.

This state is scoped per player and per channel. One player can be IC in a channel while another remains OOC.

When proxying, the bot uses the character's optional RP display fields first:

- RP Display Name
- RP Display Avatar URL

If those fields are blank, it falls back to the character's normal name and avatar URL.

Spritebot tracks the ownership of every proxied webhook message. Players can pass a proxied message
ID or Discord message link to `/ic-edit`, which opens a multi-line editor pre-filled from the
current Discord message. They can also right-click a message and choose `Apps` →
`Edit IC Message`. `/ic-delete` accepts the same ID or link format, and players can also
right-click a message and choose `Apps` → `Delete IC Message`. The bot only updates or deletes
messages originally proxied by that same Discord user.

For split RP posts, each chunk is a separate proxied Discord message and can be edited or deleted by its own message ID/link.

### Thread Bumps

The bot can register a Discord thread and periodically post a bump message to prevent it from auto-archiving. The scheduler is archive-aware and tries to bump before Discord’s archive threshold is reached.

### Admin Housekeeping

The `/admin` command provides read-only audits and carefully gated cleanup tools:

- `/admin orphans` - owner-only, ops-guild report of stale or orphaned rows
- `/admin orphans-purge` - owner-only preview and confirmation flow for safe hard deletes
- `/admin global-stats` - owner-only global usage snapshot for bot/server health
- `/admin games` - game audit for the bot owner or a GM in the current server
- `/admin characters` - private-character audit for the bot owner or a GM-scoped game
- `/admin restore-character` - owner-only restore of a soft-deleted character by ID

`/admin global-stats` reports an ephemeral embed with the bot's current Discord guild count,
active paid subscriber guilds, active gifted guilds, distinct active access guilds, public/total
games, public/active characters, and linked player count. The access-guild count is distinct across
paid entitlements and gifts, so a guild with both is counted once.

Automated cleanup runs on startup and then on a configurable interval. It reuses the same safe
purge logic as `/admin orphans-purge` and does not touch games, private non-deleted characters,
player links, thread bump rows, or SPRITE-Integrations-owned tables.

### Entitlements and Feature Gates

The codebase supports guild-scoped premium access. Features are granted by Discord entitlements and cached in Postgres for quicker checks. If no premium entitlements are active, the bot still grants the baseline `core` feature set. `/subscribe` exposes Discord Premium App subscription status and upgrade UI in Discord.

## Project Structure

The code follows a fairly clean layered structure:

- `src/index.ts` - app startup
- `src/client/` - command loading and Discord interaction wiring
- `src/commands/` - slash command entry points
- `src/handlers/` - button, modal, and select menu handlers
- `src/components/` - Discord embeds, buttons, selectors, and UI response builders
- `src/services/` - business logic
- `src/dao/` - PostgreSQL data access objects
- `src/db/` - DB bootstrap and SQL loader
- `src/access/` - feature gating and authorization logic
- `src/schedulers/` - background scheduling for thread bumping and housekeeping cleanup
- `src/config/` - environment and feature config
- `src/types/` - shared TypeScript types
- `docs/` - privacy policy and terms of service pages

The main request flow is usually:

`Discord interaction -> command/handler -> service -> DAO -> PostgreSQL`

## Database Model

The schema is currently defined in [src/db/tables/tables.sql](/Users/power/dev/devcru/spritebot/src/db/tables/tables.sql).

Primary tables include:

- `game`
- `stat_template`
- `character`
- `player`
- `player_server_link`
- `character_stat_field`
- `character_custom_field`
- `character_inventory`
- `character_inventory_field`
- `rp_channel_mode`
- `rp_proxy_message`
- `thread_bumps`
- `entitlements_cache`
- `gifted_guilds`
- `lifecycle_notification_channel`

The app can initialize its schema automatically on startup in non-production environments if the tracked tables do not already exist.

## Tech Stack

- TypeScript
- Node.js
- [discord.js](https://discord.js.org/)
- PostgreSQL
- Docker
- ESLint
- Jest with pgLite-backed integration tests

## Local Development

### Requirements

- Node.js 22.22.0
- npm
- PostgreSQL 18 recommended
- A Discord application and bot token

### 1. Install dependencies

```bash
npm ci
```

### 2. Configure secrets

**For production/Docker:** See the [Docker / Infisical](#secret-management-infisical) section. Secrets are managed centrally in Infisical.

**For local development:** Copy `.env.example` to `.env` and fill in the required values.

Current environment variables referenced by the code include:

```env
DISCORD_BOT_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_application_id
DEV_GUILD_ID=your_dev_guild_id
OPS_GUILD_ID=your_ops_guild_id
OWNER_DISCORD_ID=your_discord_user_id

PG_HOST=localhost
PG_PORT=5432
PG_USER=postgres
PG_PASS=your_password
PG_DB=spritebot

# Optional fallback lifecycle status notification channel
LIFECYCLE_NOTIFY_GUILD_ID=
LIFECYCLE_NOTIFY_CHANNEL_ID=

# Support server verification
SUPPORT_GUILD_ID=1526058725587292160
SUBSCRIBER_ROLE_ID=your_support_subscriber_role_id
PLAYER_ROLE_ID=your_support_player_role_id
SUPPORT_INVITE_URL=https://discord.gg/eXktxzKxze

# Thread bump tuning
BUMP_DEFAULT_MINUTES=10050
BUMP_BUFFER_MINUTES=30
BUMP_MIN_MINUTES=10
BUMP_ARCHIVE_AWARE_DEFAULT=true
BUMP_MIN_DELAY_MS=30000
BUMP_MAX_RETRY_DELAY_MS=900000
BUMP_JITTER_MS=15000
BUMP_POLLER_INTERVAL_MS=30000
BUMP_POLLER_COOLDOWN_MS=300000
BUMP_MAX_CONCURRENCY=3

# Housekeeping cleanup tuning
CLEANUP_INTERVAL_HOURS=24
```

Notes:

- `DEV_GUILD_ID` is used for registering ops-only commands
- `SUPPORT_GUILD_ID` is used for registering `/verify` and owner-only `/gift` in the support server
- `SUBSCRIBER_ROLE_ID` and `PLAYER_ROLE_ID` are assigned by `/verify` and the support-server join check
- `OWNER_DISCORD_ID` is used by `/gift`, `/toggle-bypass`, and owner-only `/admin` subcommands
- `/bot-announcements set` controls where startup/shutdown status messages are posted per server
- `LIFECYCLE_NOTIFY_GUILD_ID` and `LIFECYCLE_NOTIFY_CHANNEL_ID` can provide one optional fallback startup/shutdown status channel
- `CLEANUP_INTERVAL_HOURS` controls how often the housekeeping scheduler runs after startup
- production DB auto-init is disabled unless `ALLOW_DB_INIT=true`

### 3. Discord application setup

Invite the bot with these OAuth2 scopes:

- `bot`
- `applications.commands`

Enable these gateway intents in code and in the Discord Developer Portal:

- `Guilds`
- `Guild Members`
- `Guild Messages`
- `Message Content`

`Message Content` is required for the RP proxy feature because the bot must read a player's message before reposting it through the character webhook.
`Guild Members` is required for the support-server join verification check.

### 4. Discord server permissions

At minimum, Spritebot needs these permissions in any channel where slash-command UI should work:

- View Channel
- Use Application Commands
- Send Messages
- Embed Links
- Read Message History

For character sheets, game setup, inventory, buttons, selects, and modals, no elevated server permissions are expected beyond normal interaction access.

Lifecycle notification channels can be configured per server with `/bot-announcements set`.
`LIFECYCLE_NOTIFY_GUILD_ID` and `LIFECYCLE_NOTIFY_CHANNEL_ID` remain as an optional fallback channel.
Configured channels need the baseline channel permissions so Spritebot can announce when it comes online or is shutting down/restarting:

- View Channel
- Send Messages
- Read Message History

RP proxy channels need additional permissions:

- Manage Webhooks
- Manage Messages
- Attach Files

Why:

- Manage Webhooks lets Spritebot fetch or create the channel webhook used to post as a character.
- Manage Messages lets Spritebot delete the original user message after the webhook post succeeds.
- Attach Files lets Spritebot forward non-`message.txt` attachments with the first proxied message.

Thread bump channels need thread-specific permissions:

- Send Messages in Threads
- Manage Threads
- Read Message History

Why:

- Send Messages in Threads lets Spritebot post bump messages.
- Manage Threads lets Spritebot unarchive locked/archived threads before bumping.
- Read Message History lets the archive-aware scheduler inspect recent thread activity.

Ops-only commands:

- `/toggle-bypass` is registered only in `DEV_GUILD_ID`; `/gift` is registered in both `DEV_GUILD_ID` and `SUPPORT_GUILD_ID`.
- `/verify` and `/verify-greeting` are registered only in `SUPPORT_GUILD_ID`.
- `/gift`, `/toggle-bypass`, and `/verify-greeting` are Discord administrator commands and also check `OWNER_DISCORD_ID`; `/verify` is available to support server members.

Recommended setup:

- Grant the baseline permissions server-wide or at the category level where Spritebot is used.
- Grant RP proxy permissions only in channels/categories where players should use `/ic`.
- Grant thread permissions only in categories containing threads that Spritebot should auto-bump.

### 5. Run the bot in development

```bash
npm run start:dev
```

On startup, the app will:

- load and register commands with Discord
- test the PostgreSQL connection
- initialize the schema if needed
- log in the bot client
- start the thread bump scheduler
- run and schedule housekeeping cleanup

### 6. Build for production

```bash
npm run build
npm start
```

## Docker

The repo includes a multistage [Dockerfile](Dockerfile) and a [docker-compose.yml](docker-compose.yml).

## Jenkins Pipeline Deployment

Pull requests are checked by [GitHub Actions](.github/workflows/pr-checks.yml). The PR-only workflow
classifies changed files before running checks: docs and immaterial config changes run dependency
install plus Prettier, while source-impacting changes selectively add ESLint, Jest, TypeScript
build, and Docker smoke build steps. Unknown paths fall back to the full profile. Push-triggered
CI/CD is handled by Jenkins so a `develop` -> `master` PR does not run the same Actions suite twice.

The repo includes a [Jenkinsfile](Jenkinsfile) for a pipeline-style Jenkins job. This replaces manual
click-created Jenkins job config with source-controlled build and deploy behavior.

The pipeline:

- reports pending/success/failure status back to GitHub under `ci/jenkins/spritebot`
- classifies changed files so docs and immaterial config changes run only dependency install plus Prettier
- runs source-impacting checks selectively: ESLint, Jest, TypeScript build, Docker smoke build, and deploy packaging only when relevant paths changed
- runs `npm ci`
- runs Prettier for every change
- builds the Docker image as an optional CI smoke check when Docker is available on the Jenkins agent
- packages the repo into `spritebot-deploy.tar.gz`
- deploys from `main` or `master` to `shinralabs`
- preserves remote `.env.infisical`
- stops the existing `spritebot` container with the configured 90 second grace period before replacing it
- prints recent lifecycle shutdown logs so Jenkins shows whether the app drained through `database close`
- rebuilds/restarts with `docker compose up -d --build --remove-orphans`

Jenkins assumptions:

- Node tool name: `NodeJS 22.22`
- GitHub status credential id: `github_username_plus_personal_token`
- SSH Publisher host config name: `shinralabs`
- Remote deploy directory: `~/dev/spritebot`
- Remote `.env.infisical` already exists and contains the Infisical machine identity settings
- Docker is available on the remote host; local Jenkins-agent Docker is optional

If this job should deploy from `develop` instead of `main`/`master`, update `isDeployBranch()` in
the Jenkinsfile.

### Deployment Drain Verification

Deploys are still single-container replacements, but Jenkins now makes the stop step explicit before
extracting the new archive. The old container receives `SIGTERM` through Docker Compose, has up to the
Compose `stop_grace_period` to drain, and Jenkins prints recent lifecycle lines from `docker compose logs`.

Expected shutdown signs in Jenkins:

- `[lifecycle] drain started: SIGTERM`
- `[lifecycle] in-flight operations drained.` or a warning naming timed-out operations
- `[lifecycle] voice shutdown...`
- `[lifecycle] shutdown notification...`
- `[lifecycle] discord client destroy...`
- `[lifecycle] database close...`
- `[deploy] Observed graceful shutdown through database close.`

If Jenkins prints a warning that `database close` was not observed, treat the deploy as potentially forced
or incomplete. Check the remote host before retrying:

```bash
ssh shinralabs
cd ~/dev/spritebot
docker compose ps
docker compose logs --tail=200 spritebot
```

### Manual Rollback

The safest rollback is to revert or reset the deploy branch to the previous known-good commit and rerun the
Jenkins deploy. If the remote host needs immediate manual intervention:

```bash
ssh shinralabs
cd ~/dev/spritebot
docker compose ps
docker compose logs --tail=200 spritebot
docker compose up -d --build --remove-orphans
```

If a bad container is still running and Jenkins is unavailable, stop it with the same grace contract:

```bash
docker compose stop -t 90 spritebot
```

### Active Instance Lease

SPRITEbot has a Postgres-backed runtime lease so future blue-green deployments can run a standby
container without duplicate Discord gateway processing. Only the lease owner registers commands,
logs into Discord, and starts schedulers.

Runtime variables:

- `SPRITEBOT_INSTANCE_MODE=active` starts normally and fails fast if another live instance owns the lease.
- `SPRITEBOT_INSTANCE_MODE=standby` waits without connecting to Discord until the active lease expires
  or is released, then promotes itself by acquiring the lease and logging in.
- `SPRITEBOT_INSTANCE_ID` optionally sets a stable human-readable instance id; otherwise one is generated
  from host, process id, and a random suffix.
- `SPRITEBOT_LEASE_TTL_MS` defaults to `30000`.
- `SPRITEBOT_LEASE_HEARTBEAT_MS` defaults to `10000`.
- `SPRITEBOT_STANDBY_POLL_MS` defaults to `5000`.

The active instance releases the lease after Discord client teardown and before DB pool close during
graceful shutdown. If an active process dies without cleanup, standby promotion waits for the lease TTL.

### Secret Management (Infisical)

Spritebot uses [Infisical](https://infisical.com/) for secret management. Application secrets (bot token, DB credentials, etc.) are stored in Infisical and injected at container startup via the Infisical CLI. No application secrets are stored in local files.

**Setup:**

1. Create a `.env.infisical` file (gitignored) with your Infisical machine identity credentials:

   ```env
   INFISICAL_CLIENT_ID=your-machine-identity-client-id
   INFISICAL_CLIENT_SECRET=your-machine-identity-client-secret
   INFISICAL_API_URL=http://your-infisical-instance
   INFISICAL_PROJECT_ID=your-project-id
   INFISICAL_ENV=prod
   ```

2. Ensure all application secrets are stored in the corresponding Infisical project and environment.

3. Build and run:

   ```bash
   docker compose up --build
   ```

The entrypoint script (`entrypoint.sh`) authenticates with Infisical using Universal Auth, fetches secrets, and injects them as environment variables before starting the bot. The application code reads `process.env` as usual — no SDK or code changes required.

**Fallback:** If you need to run without Infisical, you can override the container command to `node dist/index.js` and provide a traditional `.env` file with all application secrets.

The container does not provision PostgreSQL — you still need a reachable database.

## Feature Access Model

Feature gating is organized around stable feature keys:

- `core`
- `rpg:characters`
- `rpg:inventory`
- `rpg:game-admin`
- `automation:thread-bump`
- `pro:transcription`

Command-to-feature mapping is defined in [src/access/features.ts](/Users/power/dev/devcru/spritebot/src/access/features.ts), and entitlement resolution happens in [src/services/entitlements.service.ts](/Users/power/dev/devcru/spritebot/src/services/entitlements.service.ts).

The SKU-to-feature mapping file is present in [src/services/plans.ts](/Users/power/dev/devcru/spritebot/src/services/plans.ts), but it is currently a stub and still needs real Discord SKU IDs configured.

## Notable Implementation Details

- Commands are discovered dynamically by scanning `src/commands`
- Discord UI is built heavily with ephemeral responses, embeds, buttons, modals, and select menus
- Character creation uses an in-memory draft system before final persistence
- Thread bump scheduling has both a per-thread scheduler and a polling backstop
- Housekeeping cleanup runs through `src/schedulers/cleanup_scheduler.ts` and reuses the reviewed safe purge service
- The bot separates read/view flows from create/edit/admin flows for premium gating

## Current Caveats

Based on the current codebase:

- Character drafts are stored in memory, so they will not survive a process restart
- Some implementation areas still look mid-iteration, including plan mapping and a few rough TODO/FIXME comments
- The app appears to assume a small-scale, single-process deployment model in several places

## Useful Files to Read First

- [src/index.ts](/Users/power/dev/devcru/spritebot/src/index.ts)
- [src/client/initial_commands.ts](/Users/power/dev/devcru/spritebot/src/client/initial_commands.ts)
- [src/db/tables/tables.sql](/Users/power/dev/devcru/spritebot/src/db/tables/tables.sql)
- [src/services/game.service.ts](/Users/power/dev/devcru/spritebot/src/services/game.service.ts)
- [src/services/character.service.ts](/Users/power/dev/devcru/spritebot/src/services/character.service.ts)
- [src/services/thread_bump.service.ts](/Users/power/dev/devcru/spritebot/src/services/thread_bump.service.ts)
- [src/access/guards.ts](/Users/power/dev/devcru/spritebot/src/access/guards.ts)

## Scripts

Defined in [package.json](/Users/power/dev/devcru/spritebot/package.json):

- `npm run start:dev` - run with `ts-node`
- `npm run build` - compile TypeScript and copy SQL assets
- `npm start` - run the compiled bot
- `npm run lint` - run ESLint
- `npm test` - run Jest

## License

The package metadata currently marks this project as `ISC`.
