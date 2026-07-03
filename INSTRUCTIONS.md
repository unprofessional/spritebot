# Spritebot Player Instructions

This guide explains how to use Spritebot inside Discord. It is written for players and GMs, not for developers running the bot.

## Quick Start For Players

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
/ic-edit message:<message id or message link> content:<new message text>
```

You can provide either:

- The message ID
- A Discord message link

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

## Troubleshooting

If `/create-character` says you have not joined a game, use `/join-game` first.

If `/create-character` says the game has no stat fields, ask the GM to finish setting up the game fields.

If RP proxying does not happen after `/ic`, check that you are typing in the same channel where you used `/ic`.

If RP proxying says you have no active character, use `/switch-character`.

If your proxied post has the wrong name or avatar, update `RP Display Name` and `RP Display Avatar URL` on your character. If those are blank, Spritebot uses your normal character name and avatar.

If `/ic-edit` or `/ic-delete` says it cannot find the message, make sure you copied the webhook message that Spritebot posted, not your original message.

If `/ic-edit` or `/ic-delete` says the message is not yours, that message was proxied by a different Discord account.

## GM Quick Start

Use `/create-game name:<name> description:<description>` to create a game.

After creating the game:

1. Define the game-specific character fields using the buttons Spritebot shows.
2. Add fields players should fill in, such as HP, Class, Strength, Skills, or Notes.
3. Publish the game when players should be able to join it.

Use `/view-game` later to manage the game fields or publish status.

Players cannot join a game until it is public.

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
