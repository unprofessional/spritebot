# Spritebot

`Spritebot` is a Discord bot for running lightweight RPG campaigns inside a server. It combines campaign setup, character management, inventory tracking, and Discord-native interaction flows with a PostgreSQL backend.

The project also includes two platform-style features beyond the RPG core:

- Discord entitlement-based feature gating for premium capabilities
- Automatic thread bumping to keep selected threads alive before they archive

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
- Restricting certain commands behind subscription/entitlement checks

## Command Overview

The repo currently defines these slash commands:

- `/create-game` - Create a campaign for the current server
- `/view-game` - View the current active game
- `/list-games` - Show game information for the server
- `/join-game` - Join a public game in the current server
- `/switch-game` - Switch your active game
- `/create-character` - Start a new character draft for your active game
- `/view-character` - View your active character
- `/list-characters` - List public characters in the active game
- `/switch-character` - Switch your active character
- `/ic` - Set your messages in the current channel to in-character proxy mode
- `/ooc` - Set your messages in the current channel to out-of-character mode
- `/ic-edit` - Edit one of your tracked proxied in-character messages
- `/ic-delete` - Delete one of your tracked proxied in-character messages
- `/inventory` - View and manage inventory for your active character
- `/bump-thread` - Register and manage auto-bumped threads
- `/gift` - Ops-only gifted access management
- `/toggle-bypass` - Ops-only entitlement bypass toggle

Some commands are available to everyone, while others are gated by feature access. The mapping currently lives in [src/access/features.ts](/Users/power/dev/devcru/spritebot/src/access/features.ts).

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

### Inventory

Each character can have inventory entries, along with per-item custom fields stored separately in the database.

### Roleplay Proxy

Players can use `/ic` and `/ooc` to toggle whether their own messages in the current channel should be proxied through a Discord webhook as their active character.

This state is scoped per player and per channel. One player can be IC in a channel while another remains OOC.

When proxying, the bot uses the character's optional RP display fields first:

- RP Display Name
- RP Display Avatar URL

If those fields are blank, it falls back to the character's normal name and avatar URL.

Spritebot tracks the ownership of every proxied webhook message. Players can pass a proxied message ID or Discord message link to `/ic-edit` or `/ic-delete`, and the bot will only update/delete the message if it was originally proxied by that same Discord user.

For split RP posts, each chunk is a separate proxied Discord message and can be edited or deleted by its own message ID/link.

### Thread Bumps

The bot can register a Discord thread and periodically post a bump message to prevent it from auto-archiving. The scheduler is archive-aware and tries to bump before Discord’s archive threshold is reached.

### Entitlements and Feature Gates

The codebase supports guild-scoped premium access. Features are granted by Discord entitlements and cached in Postgres for quicker checks. If no premium entitlements are active, the bot still grants the baseline `core` feature set.

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
- `src/schedulers/` - background scheduling for thread bumping
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

The app can initialize its schema automatically on startup in non-production environments if the tracked tables do not already exist.

## Tech Stack

- TypeScript
- Node.js
- [discord.js](https://discord.js.org/)
- PostgreSQL
- Docker
- ESLint
- Jest (script exists, but the repo currently appears to have little or no test coverage)

## Local Development

### Requirements

- Node.js 22.22.0
- npm
- PostgreSQL 16 recommended
- A Discord application and bot token

### 1. Install dependencies

```bash
npm ci
```

### 2. Create your environment file

Copy `.env.example` to `.env` and fill in the required values.

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

# Lifecycle status notifications
LIFECYCLE_NOTIFY_GUILD_ID=1170400834270548009
LIFECYCLE_NOTIFY_CHANNEL_ID=1522327870221975674

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
```

Notes:

- `DEV_GUILD_ID` is used for registering ops-only commands
- `OWNER_DISCORD_ID` is used by `/gift` and `/toggle-bypass`
- `LIFECYCLE_NOTIFY_GUILD_ID` and `LIFECYCLE_NOTIFY_CHANNEL_ID` control where startup/shutdown status messages are posted
- production DB auto-init is disabled unless `ALLOW_DB_INIT=true`

### 3. Discord application setup

Invite the bot with these OAuth2 scopes:

- `bot`
- `applications.commands`

Enable these gateway intents in code and in the Discord Developer Portal:

- `Guilds`
- `Guild Messages`
- `Message Content`

`Message Content` is required for the RP proxy feature because the bot must read a player's message before reposting it through the character webhook.

### 4. Discord server permissions

At minimum, Spritebot needs these permissions in any channel where slash-command UI should work:

- View Channel
- Use Application Commands
- Send Messages
- Embed Links
- Read Message History

For character sheets, game setup, inventory, buttons, selects, and modals, no elevated server permissions are expected beyond normal interaction access.

Lifecycle notification channels need the baseline channel permissions so Spritebot can announce when it comes online or is shutting down/restarting:

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

- `/gift` and `/toggle-bypass` are registered only in `DEV_GUILD_ID`.
- They are Discord administrator commands and also check `OWNER_DISCORD_ID`.

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

### 6. Build for production

```bash
npm run build
npm start
```

## Docker

The repo includes a multistage [Dockerfile](/Users/power/dev/devcru/spritebot/Dockerfile) and a simple [docker-compose.yml](/Users/power/dev/devcru/spritebot/docker-compose.yml).

To build and run:

```bash
docker compose up --build
```

The container expects a `.env` file to be present and does not currently provision PostgreSQL for you, so you will still need a reachable database.

TODO: Add production restart/deploy steps for draining active Discord and database work before stopping the container, so shutdown notifications and in-flight operations have time to finish cleanly.

## Feature Access Model

Feature gating is organized around stable feature keys:

- `core`
- `rpg:characters`
- `rpg:inventory`
- `rpg:game-admin`
- `automation:thread-bump`

Command-to-feature mapping is defined in [src/access/features.ts](/Users/power/dev/devcru/spritebot/src/access/features.ts), and entitlement resolution happens in [src/services/entitlements.service.ts](/Users/power/dev/devcru/spritebot/src/services/entitlements.service.ts).

The SKU-to-feature mapping file is present in [src/services/plans.ts](/Users/power/dev/devcru/spritebot/src/services/plans.ts), but it is currently a stub and still needs real Discord SKU IDs configured.

## Notable Implementation Details

- Commands are discovered dynamically by scanning `src/commands`
- Discord UI is built heavily with ephemeral responses, embeds, buttons, modals, and select menus
- Character creation uses an in-memory draft system before final persistence
- Thread bump scheduling has both a per-thread scheduler and a polling backstop
- The bot separates read/view flows from create/edit/admin flows for premium gating

## Current Caveats

Based on the current codebase:

- The README was previously empty, so some operational knowledge is only encoded in source
- Tests do not appear to be fleshed out yet
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
