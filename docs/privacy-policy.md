# Demiplane Dice Room Privacy Policy

Last updated: 2026-05-24

Demiplane Dice Room is a browser extension that shares dice rolls from Demiplane character sheets with players who join the same tabletop room. This policy describes what the extension and the optional relay handle.

## Data handled by the extension

The extension stores these settings locally in the browser:

- Relay URL and optional relay access key.
- Player display name.
- Optional character display name.
- Room name and room password for Dice Room rooms.
- Local extension preferences, such as dice animation, shared dice, panel position, opacity, and language.
- Recent local room history used to display the table roll history.

The extension reads dice roll result cards from supported Demiplane character-sheet pages. It does not read or collect Demiplane login credentials, payment data, private account settings, cookies, or full character-sheet data.

## Data sent to the relay

When online room sharing is enabled, the extension sends the minimum data needed to synchronize a table:

- A generated client ID.
- Player display name and optional character display name.
- Room name and room password used for the Dice Room room. This is not a Demiplane password and should not be reused from any important account.
- Dice roll data captured from the roll result card, including roll title, successes, dice values, player name, optional character name, timestamp, and raw roll-card text.
- Presence state, pending approval state, shared dice movement events, and shared dice clear events.

The default community relay is:

`wss://demiplane-dice-room-relay.foxbyron.workers.dev`

Users can replace it with a local or self-hosted relay from the extension's advanced settings.

## What is not collected

Demiplane Dice Room does not collect:

- Demiplane usernames or passwords.
- Browser cookies.
- Payment information.
- General browsing history.
- Full character-sheet contents.
- Data from websites outside the declared Demiplane character-sheet URL pattern, except localhost/127.0.0.1 access used for optional local relay testing.

## Storage and retention

Browser-local settings and recent history remain in the user's browser until the user changes settings, disconnects, clears browser extension data, or removes the extension.

The community relay is designed for short-lived tabletop synchronization. Room data is held in relay memory for active sessions and recent reconnect support only. Room state is removed when the room closes, when the storyteller/host leaves, or when relay/session cleanup expires. The relay is not intended as a permanent archive.

The project may use minimal operational logs from the hosting provider for reliability, abuse prevention, and rate-limit monitoring. These logs are not used to build advertising profiles.

## Data sharing

Dice Room room data is shared with other players connected to the same room. The project does not sell personal information.

The relay provider may process connection metadata as part of normal hosting operations. The current community relay is hosted on Cloudflare Workers.

## Security notes

Use a room password that is unique to the game session. Do not reuse a Demiplane password or any other account password as a Dice Room room password.

The extension uses rate limits and room-size limits to reduce spam and abuse on the community relay. Users who want full control can run their own relay.

## Contact and support

Support and issue tracking:

https://github.com/ByronAndrade/demiplane-dice-room/issues

Project repository:

https://github.com/ByronAndrade/demiplane-dice-room
