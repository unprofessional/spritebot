# Plan: LFG Board — Player & GM Matchmaking

> **Status:** Future — long-term horizon
> **Priority:** Low (needs critical mass of games/GMs first)

## Vision

Discord's server discovery is built around groups, not people. It's impersonal — you join a server and hope you click with someone. SPRITE can do better because we already know who the GMs are, what games they run, and who's playing in them.

The LFG (Looking For Group) board lets GMs and players find each other across the SPRITE ecosystem, not just within one server. It's people-first discovery: show the GM, their game style, what they're looking for — not just a server invite link.

## Use Cases

### GM Looking for Players

- GM posts a listing: game name, description, schedule, number of open slots
- Players browse listings and express interest
- GM reviews interested players and accepts/declines
- Accepted players get a friend request or server invite to join

### GM Looking for a Co-GM

- Similar to player listings but flagged as a co-GM search
- Can describe what they need: "someone to run combat encounters" / "need a lore builder" / "looking for someone to alternate sessions with"
- Matched by game style, not just availability

### Player Looking for a Game

- Player posts availability, preferred game style, experience level
- GMs can browse player listings alongside their own recruitment
- Two-way discovery: players find games, GMs find players

## Design Principles

- **People, not servers.** Show the GM's profile, their game history, player count, session frequency. Make it feel like meeting someone, not joining a queue.
- **Cross-server.** Listings are visible across all SPRITE-connected servers. The board is the network, not any single server.
- **Opt-in and low-friction.** Creating a listing should take 30 seconds. No forms with 20 fields.
- **Trust signals.** Show how long someone has been running games on SPRITE, how many sessions they've hosted, player retention. Let reputation emerge from usage data we already have.
- **Privacy-respecting.** Players and GMs control what's visible. No exposing server membership lists or DM history.

## Potential Features

- Listing board as a Discord embed flow (browse/filter/express interest)
- Persistent listings with expiry (auto-archive after X days of inactivity)
- Interest/application system (player applies → GM reviews → accept/decline)
- Friend request integration (accepted connections can send Discord friend requests)
- Game style tags (homebrew, published module, heavy RP, combat-focused, casual, etc.)
- Schedule matching (timezone + availability overlap)
- "Similar games" suggestions based on stat templates and game descriptions
- Support server as the central hub for cross-server listings

## Why This Matters Later

This only works with critical mass. We need:

- Enough GMs running games across multiple servers
- Enough players who've used SPRITE and want to find more games
- Trust/reputation data from actual game history

Building it too early means empty boards and a bad first impression. Building it at the right time turns SPRITE from a per-server tool into a network.

## Open Questions

- [ ] Where do listings live? Support server channel? Dedicated bot command flow? Web UI?
- [ ] How to handle cross-server trust (a GM's reputation in server A should carry to server B)
- [ ] Monetization angle? Premium listing placement, or purely free?
- [ ] Moderation strategy for listings (spam, bad actors, ghost listings)
- [ ] Integration with Discord's native server discovery vs. staying independent
- [ ] Should players be able to rate/review GMs (and vice versa)? Risky but high-value if done right.
