# Spritebot Player Instructions

This guide explains how to use Spritebot inside Discord. It is written for players and GMs, not for developers running the bot.

## Quick Start For Players

Run `/help` at any time for a private, interactive guide tailored to players or GMs and the
features available in your server.

1. Join a game with `/join-game`.
2. Pick the game you want from the menu.
3. Create a character with `/create-character`.
4. Fill in the character fields from the dropdowns.
5. Submit the character when the required fields are complete.
6. Use `/switch-character` if you have more than one character.
7. Use `/ic` in a roleplay channel when you want your messages there to post as your active character.
8. Use `/ooc` in that same channel when you want to stop proxying messages.

## Games

Use `/join-game` to join a public game in the server.

Use `/switch-game` if you are in more than one game and need to change your active game.

Use `/view-game` to see your currently active game.

Your active game controls which characters and character fields Spritebot uses for you.

GMs can delete their own game from the `/view-game` controls. This removes the game from players'
active selections and temporarily deletes its characters. Use `/restore-game` within 30 days to
restore the game and those game-deleted characters. Players must rejoin or switch back afterward.

## Characters

Use `/create-character` after joining a game. Spritebot will show an interactive character draft.

Character creation usually includes:

- Name
- Bio
- Avatar URL
- RP Display Name
- RP Display Avatar URL
- Game-specific fields chosen by the GM, such as HP, Strength, Class, Skills, or Notes

Select a field from the dropdown, fill in the modal, and continue until your character is ready. Then submit the character.

Use `/view-character` to view your active character sheet.

Use `/switch-character` to choose a different active character.

Use `/list-characters` to browse public characters in the current game.

If you delete a character by mistake, use `/restore-character` within 30 days to restore one of
your soft-deleted characters in your current game. Restored characters come back as private, so you
can review them before making them public again.

## RP Display Fields

The RP display fields control how your proxied roleplay posts appear.

`RP Display Name` is the name Spritebot uses for webhook roleplay posts.

`RP Display Avatar URL` is the image URL Spritebot uses for webhook roleplay posts.

These are separate from your normal character name and avatar. That means your full character sheet can have one name while your RP posts use a shorter display name, nickname, title, or disguise.

If you leave the RP display fields blank, Spritebot falls back to your normal character name and normal character avatar URL.

To edit these later:

1. Run `/view-character`.
2. Use the edit button on your character card.
3. Pick `RP Display Name` or `RP Display Avatar URL`.
4. Submit the new value.

## Roleplay Proxy

Use `/ic` in a channel to turn on in-character proxy mode for yourself in that channel.

Use `/ooc` in that same channel to turn it off.

This setting is per player and per channel. Your `/ic` setting does not affect anyone else.

When you are IC in a channel:

- Spritebot reads your normal message.
- Spritebot reposts it through a webhook using your active character's RP display name and avatar.
- Spritebot deletes your original message after the webhook post succeeds.

When you are OOC in a channel, your messages post normally as you.

You must have an active character selected for RP proxying to work. Use `/switch-character` if Spritebot says you do not have one selected.

## Long RP Posts

Spritebot supports RP posts up to 4000 characters.

If your post is longer than a normal Discord message, Spritebot splits it into multiple proxied messages.

If your message is sent as a text attachment named `message.txt`, Spritebot can read that attachment and proxy the contents.

If the attached text is over the supported limit, Spritebot will not delete your original message. That lets you keep the attachment, edit it, and try again.

## Editing Proxied RP Posts

Use `/ic-edit` to edit one of your own proxied RP messages.

Example:

```text
/ic-edit message:<message id or message link>
```

You can provide either:

- The message ID
- A Discord message link

Spritebot opens a text editor for the complete replacement message. The editor starts blank and
supports multiple lines and paragraph spacing. Enter the full message you want to keep; Spritebot
validates ownership when you submit it.

You can also right-click one of your proxied messages and choose
`Apps` → `Edit IC Message` to open the same editor.

Spritebot only lets you edit messages that were proxied by your own Discord account.

For split RP posts, each chunk is its own Discord message. Edit the specific chunk by using that chunk's message ID or link.

## Deleting Proxied RP Posts

Use `/ic-delete` to delete one of your own proxied RP messages.

Example:

```text
/ic-delete message:<message id or message link>
```

You can provide either:

- The message ID
- A Discord message link

Spritebot only lets you delete messages that were proxied by your own Discord account.

You can also right-click one of your proxied messages and choose
`Apps` → `Delete IC Message` to delete it without copying a message link.

For split RP posts, delete each chunk separately.

## How To Copy A Message ID Or Link

On desktop Discord:

1. Right-click the proxied message.
2. Choose `Copy Message Link` if available.
3. Paste that link into `/ic-edit` or `/ic-delete`.

If you need to copy a raw message ID, enable Developer Mode in Discord:

1. Open User Settings.
2. Go to Advanced.
3. Turn on Developer Mode.
4. Right-click the message.
5. Choose `Copy Message ID`.

## Inventory

Use `/inventory` to view and manage your active character's inventory.

Inventory is tied to your active character, so switch characters first if you are managing items for someone else.

Items have a text name, optional type/category, optional description, and quantity. Large inventories are shown as separate paginated views from the main character sheet.

You can also open inventory from your character sheet:

1. Run `/view-character`.
2. Click `🎒 Inventory`.

### Adding Items

1. Open your inventory.
2. Click `➕ Add Item`.
3. Enter the item name.
4. Optionally enter an item type/category, quantity, and description.
5. Submit the modal.

The inventory message updates in place after the item is added.

### Viewing Or Editing Item Details

The main inventory list is intentionally compact. It shows item name, quantity, type/category, and whether the item is equipped. Long descriptions are not shown in the list.

To view or edit item details:

1. Open your inventory.
2. Use the `View/Edit an inventory item` dropdown.
3. Pick the item.
4. Click `View/Edit Item`.
5. Update the fields in the modal, or read the existing details.
6. Submit the modal if you made changes.

### Equipping Items

Equipped items are marked with `✅`.

To equip or unequip an item:

1. Open your inventory.
2. Use the `View/Edit an inventory item` dropdown.
3. Pick the item.
4. Click `Equip Item` or `Unequip Item`.

### Deleting Items

To delete one item:

1. Open your inventory.
2. Use the `View/Edit an inventory item` dropdown.
3. Pick the item.
4. Click `Delete Item`.
5. Confirm the deletion.

To delete everything in your active character's inventory, click `🗑️ Delete All` and confirm.

Use `↩️ Go Back` to return to the inventory list without changing the selected item.

## Dice Rolling

Use `/roll` when you need a quick dice result in Discord.

Example:

```text
/roll dice:3d6
```

Spritebot supports rolls from `1d2` through `15d999`. Use strict dice notation like `2d20` or
`2D20`.

The result uses your active character name when you have one selected in the server. If you do not,
Spritebot uses your server profile name, then falls back to your account display name.

Results include the normalized dice expression, each die result, and the total.

Example result:

```text
🎲 **Robin Sage** rolled `4d20`: `[14, 14, 13, 1]` = **42**
```

Spritebot uses cryptographic local randomness for dice rolls. That is appropriate for normal table
play, but it is not publicly verifiable like a commit-reveal or shared-seed system.

## Troubleshooting

If you are not sure which command to use, run `/help` and choose your role and topic.

If `/create-character` says you have not joined a game, use `/join-game` first.

If `/create-character` says the game has no stat fields, ask the GM to finish setting up the game fields.

If RP proxying does not happen after `/ic`, check that you are typing in the same channel where you used `/ic`.

If RP proxying says you have no active character, use `/switch-character`.

If your proxied post has the wrong name or avatar, update `RP Display Name` and `RP Display Avatar URL` on your character. If those are blank, Spritebot uses your normal character name and avatar.

If `/ic-edit` or `/ic-delete` says it cannot find the message, make sure you copied the webhook message that Spritebot posted, not your original message.

If `/ic-edit` or `/ic-delete` says the message is not yours, that message was proxied by a different Discord account.

If `/restore-character` does not list the character you expected, make sure you are in the same server
and active game where the character was created. Player self-restore is available for 30 days after
deletion.

## GM Quick Start

Use `/create-game name:<name> description:<description>` to create a game.

After creating the game:

1. Define the game-specific character fields using the buttons Spritebot shows.
2. Add fields players should fill in, such as HP, Class, Strength, Skills, or Notes.
3. Publish the game when players should be able to join it.

Use `/view-game` later to manage the game fields or publish status.

Players cannot join a game until it is public.

## Voice Transcription

GMs can use `/transcribe` to record a voice-channel transcript for a session.

Spritebot does not post live transcription messages while people are talking. Instead, it listens during the session, collects transcript entries, and posts one raw `.txt` transcript file when transcription stops.

### Starting Transcription

Use:

```text
/transcribe start voice-channel:<voice channel> text-channel:<text channel>
```

Spritebot joins the selected voice channel and records speech from the people in that channel.

The selected text channel is where Spritebot posts the transcript file when the session ends.

Only GMs can manage transcription sessions. If Spritebot says you are not a GM, make sure you have created or are assigned to the game as a GM in this server.

### Checking Status

Use:

```text
/transcribe status
```

This shows the active voice channel, output text channel, participant count, and how many speech segments have been transcribed so far.

### Stopping Transcription

Use:

```text
/transcribe stop
```

Spritebot leaves the voice channel, finishes any in-progress transcription work, and posts a `.txt` transcript attachment in the configured text channel.

The transcript file includes:

- Session metadata
- Start and end time
- Duration
- Participant count
- Segment count
- Raw transcript lines in this format: `[HH:MM:SS] DisplayName: transcribed text`

If everyone leaves the voice channel, Spritebot automatically stops transcription and posts the same transcript dump.

### Transcription Notes

Transcription is best-effort. It may mishear names, accents, background noise, overlapping speakers, or Discord audio glitches.

The transcript is intentionally raw. Spritebot does not summarize it, clean up wording, or rewrite it.

## Thread Bumps

If Spritebot is configured for thread bumping, use `/bump-thread` to manage auto-bumped threads.

Common actions include:

- `/bump-thread add`
- `/bump-thread remove`
- `/bump-thread list`
- `/bump-thread bump-now`
- `/bump-thread set-note`
- `/bump-thread set-interval`

Thread bumping is mainly for server staff or GMs who need important threads to stay active.
