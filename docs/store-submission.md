# Store Submission Kit

Use this file as the copy/paste source for browser store submissions.

## Package Files

- Chrome, Edge, Opera: `artifacts/demiplane-dice-room-0.1.108-chromium.zip`
- Firefox: `artifacts/demiplane-dice-room-0.1.108-firefox.zip`
- Source package for reviewer requests: `artifacts/demiplane-dice-room-0.1.108-source.zip`

## Public URLs

- Support URL: `https://github.com/ByronAndrade/demiplane-dice-room/issues`
- Project URL: `https://github.com/ByronAndrade/demiplane-dice-room`
- Privacy policy URL: `https://github.com/ByronAndrade/demiplane-dice-room/blob/codex/dice-result-reveal/docs/privacy-policy.md`

After this branch is merged, prefer the main-branch privacy URL:

`https://github.com/ByronAndrade/demiplane-dice-room/blob/main/docs/privacy-policy.md`

## Listing Text

### Name

Demiplane Dice Room

### Short Summary

Share Demiplane dice rolls with your tabletop group in real time.

### Single Purpose

Demiplane Dice Room synchronizes dice rolls from supported Demiplane character-sheet pages with players who join the same tabletop room.

### Description

Demiplane Dice Room lets tabletop groups share dice rolls made on Demiplane character sheets in real time.

Create a room as the storyteller, invite players to join with the same room name and room password, and everyone sees the same roll history while playing. The extension captures completed Demiplane roll result cards, displays a floating table panel, and can animate shared dice on the page so the table feels connected during online play.

Main features:

- Shared roll history for everyone in the same room.
- Storyteller-created rooms with player approval.
- Optional local mode when you only want your own capture and animation.
- Optional shared dice animation with table cleanup controls.
- Community relay by default, with advanced settings for local or self-hosted relays.
- No Demiplane password collection and no modification of your Demiplane account.

The extension is built for tabletop groups who already use Demiplane and want a lightweight way to make rolls visible to the whole online table.

## Category Suggestions

- Chrome: Productivity or Fun, depending on available categories.
- Edge: Entertainment or Productivity.
- Firefox: Games & Entertainment or Other.
- Opera: Entertainment or Productivity.

## Permission Justifications

### storage

Used to save local extension settings such as relay URL, player name, room settings, panel position, language, and recent local room history.

### tabs

Used to coordinate extension state with supported Demiplane character-sheet tabs.

### scripting

Used to inject the extension scripts that detect supported Demiplane dice roll result cards and display the Dice Room panel.

### Host permission: https://app.demiplane.com/*

Needed to read completed dice roll result cards on supported Demiplane character-sheet pages and display the synchronized Dice Room interface.

### Host permissions: http://localhost/* and http://127.0.0.1/*

Used only for optional local relay testing or self-hosted relay play on the user's own machine.

## Remote Code Answer

No remote code is loaded or executed by the extension. The extension package contains its JavaScript, HTML, CSS, and image assets. It connects to a relay service only to send and receive room synchronization messages.

## Data Collection / Privacy Disclosure

The extension handles player-chosen display names, optional character display names, room names, room passwords for Dice Room rooms, dice roll results, room presence, and shared dice movement events when online room sharing is enabled.

It does not collect Demiplane credentials, browser cookies, payment information, general browsing history, or full character-sheet data.

Use the full privacy policy URL above for store privacy fields.

## Reviewer Test Notes

Suggested text:

Install the extension, open a supported Demiplane character-sheet URL matching `https://app.demiplane.com/nexus/*/character-sheet/*`, and use the Dice Room panel. The extension can be tested without a Demiplane login by opening the popup and using local configuration, but full roll capture requires a Demiplane character sheet with dice roll result cards. The default community relay is configured automatically. For two-user testing, use two browser profiles with the same room name and room password: create the room as Storyteller/host in one profile, join as player in the second profile, approve the player, then perform a roll on the Demiplane sheet.

## Store Assets

Generated assets live in `store-assets/`.

- `store-assets/icon-300.png`
- `store-assets/promo-small-440x280.png`
- `store-assets/promo-large-1400x560.png`

Use the real screenshots first in public listings and project documentation:

- `store-assets/screenshots/edge-real/00-real-shared-dice-over-sheet-1280x800.png`
- `store-assets/screenshots/edge-real/01-real-demiplane-roll-1280x800.png`
- `store-assets/screenshots/edge-real/02-real-roll-history-1280x800.png`
- `store-assets/screenshots/edge-real/03-real-room-settings-1280x800.png`
- `store-assets/screenshots/edge-real/04-real-compact-panel-1280x800.png`

The Chrome/Edge/Firefox filenames below are compatibility copies using real screenshots:

- `store-assets/screenshots/chrome-edge-firefox/01-room-panel-1280x800.png`
- `store-assets/screenshots/chrome-edge-firefox/02-shared-dice-1280x800.png`
- `store-assets/screenshots/chrome-edge-firefox/03-advanced-settings-1280x800.png`
- `store-assets/screenshots/opera/01-room-panel-612x408.png`
- `store-assets/screenshots/opera/02-shared-dice-612x408.png`
- `store-assets/screenshots/opera/03-advanced-settings-612x408.png`
