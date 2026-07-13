# Support Server Verification — Role Assignment Plan

> **Status:** Draft — awaiting review
> **Server:** SPRITEbot Support (`1526058725587292160`)
> **Vestibule channel:** `#vestibule` — where unverified members land
> **Target:** SPRITEbot codebase (spritebot repo)

---

## Goal

When users join the SPRITEbot support server, they start in `#vestibule` with no roles and
limited channel access. A `/verify` command lets them prove their relationship to SPRITEbot
(subscriber or player), which grants them a role and unlocks the rest of the server.

---

## Roles

Two new roles to be created in the support server:

| Role           | Who gets it                                                              | How it's determined                                                            |
| -------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| **Subscriber** | Users who own an active SPRITEbot Premium subscription on any server     | User ID matches an active Discord entitlement owner                            |
| **Player**     | Users who are registered as a player in any game on a subscribing server | User ID exists as a player in a game where the guild has an active entitlement |

A user can have both roles (e.g. they subscribe on their own server and play in someone else's).

Users with neither status remain unverified in `#vestibule`.

---

## Phase 1: `/verify` Command + On-Join Check

### `/verify` slash command

- **Registered in:** Support server only (guild-specific command, not global)
- **Permission:** Anyone can use it
- **Behavior:**
  1. Look up the invoking user's Discord ID in the SPRITEbot database
  2. Check for active entitlements where this user is the subscription owner → **Subscriber**
  3. Check for player records in any game belonging to a guild with an active entitlement → **Player**
  4. Assign matching role(s) in the support server
  5. Respond with an ephemeral message confirming what was found:
     - ✅ "Verified as **Subscriber** — you have an active subscription on [server name]"
     - ✅ "Verified as **Player** — you're in a game on [server name]"
     - ✅ Both, if both apply
     - ❌ "No active subscription or game membership found. If you just subscribed, try again in a few minutes."
  6. Response is ephemeral — no public spam in `#vestibule`

### On-join auto-check (`guildMemberAdd`)

- When a new member joins the support server, automatically run the same lookup
- If they match, assign roles silently (no DM, no channel message)
- If they don't match, do nothing — they land in `#vestibule` naturally

### `/support` slash command (global)

- **Registered in:** All servers (global command)
- **Permission:** Anyone can use it
- **Behavior:**
  1. Reply with an ephemeral message containing the support server invite link
  2. Example response: "Need help or want to report a bug? Join the SPRITEbot support server: https://discord.gg/eXktxzKxze"
  3. Ephemeral so it doesn't clutter the channel
- **Note:** This is a simple static response — no DB lookups, no logic. Just returns the invite URL.

### `#vestibule` channel setup

- Visible to `@everyone` (no role required)
- All other channels require **Subscriber** or **Player** role to view
- `#vestibule` should contain a pinned message or embed explaining:
  - What the server is for
  - How to run `/verify`
  - That they need an active subscription or game membership to access the rest of the server
- Consider a channel topic like: "New here? Run `/verify` to unlock the server."

---

## Implementation Details

### Database queries needed

```
-- Is this user a subscriber?
-- Check active entitlements by user ID
SELECT * FROM entitlements
WHERE user_id = $1
  AND is_active = true;

-- Is this user a player in a subscribing guild's game?
-- Check player records joined with guild entitlement status
SELECT p.*, g.guild_id FROM players p
JOIN games g ON p.game_id = g.id
JOIN entitlements e ON g.guild_id = e.guild_id
WHERE p.user_id = $1
  AND e.is_active = true;
```

> **Note:** Actual table/column names should match the SPRITEbot schema. These are
> illustrative. The implementer should check the current schema and adapt.

### Support server config

SPRITEbot needs to know the support server ID and role IDs. Options:

1. **Environment variables** (preferred, keeps it in Infisical):
   - `SUPPORT_GUILD_ID=1526058725587292160`
   - `SUBSCRIBER_ROLE_ID=<role id once created>`
   - `PLAYER_ROLE_ID=<role id once created>`

2. Or a config entry in the existing bot config structure — implementer's call.

### Bot permissions in support server

SPRITEbot needs these permissions in the support server:

- **Manage Roles** — to assign Subscriber/Player roles
- **View Channels** — to see `#vestibule`
- **Send Messages** — to respond to `/verify` (ephemeral responses still need this)
- The Subscriber and Player roles must be **below** SPRITEbot's highest role in the hierarchy

### Slash command registration

- Register `/verify` as a guild-specific command on the support server only
- No global registration needed — this command has no purpose outside the support server
- If SPRITEbot already has a command registration pattern (e.g. `deployCommands.js` or similar), follow it

---

## Channel structure recommendation

```
SPRITEbot Support Server
├── #vestibule          (visible to @everyone, /verify prompt)
├── #announcements      (Subscriber + Player, read-only)
├── #general            (Subscriber + Player)
├── #bug-reports        (Subscriber + Player)
├── #feature-requests   (Subscriber + Player)
└── #gm-help            (Subscriber + Player)
```

Channel creation is mads's domain — this is just a suggestion for context.

---

## Phase 2: Role Sync (deferred)

Not in scope for Phase 1. For later consideration:

- **Periodic sync job** (daily cron) that iterates all support server members, re-checks
  entitlement/player status, and removes roles from users who no longer qualify
- **Entitlement webhook listener** — Discord sends `ENTITLEMENT_CREATE`, `ENTITLEMENT_UPDATE`,
  and `ENTITLEMENT_DELETE` events. SPRITEbot could listen for these and update roles in
  real-time when subscriptions change
- **Grace period** — consider keeping roles for N days after subscription lapses to avoid
  churn noise

---

## Open questions

- [ ] Role names — "Subscriber" and "Player" good, or prefer something else?
- [ ] Role colors — match site branding? (cyan for subscriber, green for player?)
- [ ] Should the vestibule have a bot-generated welcome embed, or just a manual pinned message?
- [ ] Should `/verify` be re-runnable? (Yes — useful if someone subscribes after joining)
- [ ] Any additional roles? (e.g. "GM" for users who own games, distinct from players)
