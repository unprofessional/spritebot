# Plan: UX BDD Story Doc

> **Status:** TODO

## Goal

Define expected user-facing behavior for every SPRITE interaction flow in a structured, testable format. These stories serve as:

1. A living spec that documents how the bot _should_ behave from a user's perspective
2. The source of truth for automated Discord UI tests (see `discord-ui-testing.md`)
3. A review checklist for PR authors shipping new commands or components

## Format

Use Gherkin-style Given/When/Then scenarios grouped by feature area. Keep language non-technical — describe what the user sees, not what the code does.

## Stories

### Help Command

```gherkin
Feature: Help Manual

  Scenario: Player opens help
    Given I am a user in a server with SPRITE
    When I use /help
    Then I see an ephemeral embed titled "Welcome to SPRITE"
    And I see two buttons: "I'm a Player" and "I'm a GM / Server Admin"
    And no other users can see this message

  Scenario: Player selects role
    Given I used /help and see the role selection
    When I click "I'm a Player"
    Then the existing message updates in-place
    And I see an embed titled "Player Help"
    And I see a category dropdown menu
    And I see a "Back to roles" button
    And no new message is created

  Scenario: Player browses category
    Given I selected the Player role and see the category menu
    When I select "Characters" from the dropdown
    Then the existing message updates in-place
    And I see an embed with character commands
    And the dropdown still shows "Characters" as selected
    And no new message is created

  Scenario: Player switches categories
    Given I am viewing the Characters category
    When I select "Roleplay" from the dropdown
    Then the existing message updates in-place with roleplay commands
    And no new message is created

  Scenario: Player returns to role selection
    Given I am viewing any help category
    When I click "Back to roles"
    Then the existing message updates back to the role selection
    And no new message is created

  Scenario: GM sees different categories
    Given I used /help
    When I click "I'm a GM / Server Admin"
    Then I see GM-specific categories including "Game Management" and "Server Tools"
    And "Game Management" includes /create-game

  Scenario: Subscription-gated categories are hidden
    Given I am in a server with only core (free) access
    When I use /help and select "I'm a Player"
    Then I do not see "Roleplay", "Inventory", or "Voice Transcription" categories
    And I see "Getting Started", "Games", "Dice", and "Subscription & Support"

  Scenario: Pro features hidden without Pro access
    Given I am in a server with Premium (not Pro) access
    When I use /help and select "I'm a Player"
    Then I do not see "Voice Transcription" in the category list
```

### Game Management

```gherkin
Feature: Game Deletion

  Scenario: GM sees delete button
    Given I am the GM who created a game
    When I use /view-game
    Then I see a "Delete Game" button in the controls

  Scenario: Non-GM does not see delete button
    Given I am a player (not the GM) in a game
    When I use /view-game
    Then I do not see a "Delete Game" button

  Scenario: GM deletes a game
    Given I am viewing my game with /view-game
    When I click "Delete Game"
    Then I see a confirmation prompt warning about character deletion
    And I see a "Confirm Delete" button and a "Cancel" button

  Scenario: GM confirms deletion
    Given I see the delete confirmation prompt
    When I click "Confirm Delete"
    Then the message updates to confirm deletion
    And the message mentions a 30-day recovery window
    And the message shows how many characters and players were affected

  Scenario: GM cancels deletion
    Given I see the delete confirmation prompt
    When I click "Cancel"
    Then the message returns to the normal game view card

  Scenario: GM restores a deleted game
    Given I deleted a game less than 30 days ago
    When I use /restore-game
    Then I see a dropdown of my recently deleted games
    When I select a game
    Then the game is restored with its characters
    And the confirmation shows how many characters were recovered
```

### Character Lifecycle

```gherkin
Feature: Character Management

  Scenario: Player creates a character
    Given I have joined a game
    When I use /create-character
    Then I see an interactive character draft
    And I can fill in name, bio, and game-defined stats

  Scenario: Player deletes a character
    Given I am viewing my own character
    When I click "Delete Character"
    Then I see a confirmation with a 30-day recovery warning
    When I click "Confirm Delete"
    Then the character is removed from my active selection

  Scenario: Player restores a character
    Given I deleted a character less than 30 days ago
    When I use /restore-character
    Then I see my recently deleted characters
    When I select one
    Then the character is restored as private
```

### Roleplay Proxy

```gherkin
Feature: Roleplay Proxy

  Scenario: Player enters IC mode
    Given I have an active character with an RP display name
    When I use /ic in a channel
    Then my subsequent messages are posted as my character via webhook
    And the webhook uses my character's RP display name and avatar

  Scenario: Player exits IC mode
    When I use /ooc in a channel
    Then my subsequent messages are posted as myself

  Scenario: Player edits a proxied message
    Given I have a proxied IC message in the channel
    When I right-click it and choose Apps > Edit IC Message
    Then I see a modal prefilled with my original message content
    When I submit the edit
    Then the proxied message updates with my new content

  Scenario: Player cannot edit another's proxied message
    Given another player has a proxied IC message
    When I right-click it and choose Apps > Edit IC Message
    Then I see an error saying I don't have permission
```

### Dice

```gherkin
Feature: Dice Rolling

  Scenario: Player rolls dice
    When I use /roll dice:2d20
    Then I see individual die results and the total
    And the result is visible to everyone in the channel
```

## Adding New Stories

When shipping a new command, button, select menu, or modal flow:

1. Write the Gherkin scenarios in this file first
2. Get them reviewed as part of the PR
3. Once merged, add corresponding automated tests in the UI test harness

## Maintenance

- Stories should be updated when behavior intentionally changes
- If a UI test fails, check the story first — it may need updating
- Stories are the spec; tests are the enforcement
