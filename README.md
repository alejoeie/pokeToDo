# PokéDo

A small Pokémon-themed task board for Ale and Sharlotte. Independent of the portfolio project.

## Local setup

Requires Node.js 22.9+ and a MongoDB Atlas cluster. This version needs the Node server; `python3 -m http.server` no longer provides the required API.

```sh
cd /Users/azunigap/Documents/programming_projects/pokedo
npm ci
cp .env.example .env
```

Edit `.env` locally (or copy your `atlas-credentials.env` to `.env` first, then add the application settings below). Separate `MONGODB_USERNAME` and `MONGODB_PASSWORD` values, when both present, override the credentials in `MONGODB_URI` safely. All `*.env` files are ignored by Git.

Settings:

- `MONGODB_URI`: Atlas → Connect → Drivers → Node.js connection string. Use a database user, not your Atlas website login. URL-encode special characters in credentials. Never paste this value into chat, commit it, or put it in frontend code.
- `MONGODB_DB=pokedo`: dedicated application database. Do not use an existing unrelated database.
- `APP_ORIGIN=http://localhost:4174`: exact browser origin, no trailing slash. Use **localhost**, not 127.0.0.1 in the address bar with this setting.

In Atlas, allow your current development IP under Network Access. Use a database user with read/write rights for `pokedo`; initial setup also needs permission to create/update collection validators and indexes. Keep the runtime database user limited to the application database. Consult Atlas role settings if schema initialization is denied.

```sh
npm run db:setup
npm start
```

Setup creates validators and indexes, then asks for Ale's and Sharlotte's passwords **without echoing them**. Use distinct passwords of 12–128 characters. There is no registration endpoint. Existing accounts are preserved when setup is rerun.

Open **http://localhost:4174**. Enter username `alejoeie` (Ale) or `shar` (Sharlotte) and that account's password. Accounts start with an empty board; old browser demo tasks are not imported. Their old localStorage entries are no longer read.

If a previous Python preview is still using port 4174, stop it with Ctrl+C before starting Node.

## Change password

While signed in, select **Password** in the top bar. Enter your current password and confirm a new password (12–128 characters). A successful change signs out all sessions for that account; sign in again with the new password. The other account, tasks, and starter remain unchanged. Password changes are rate-limited to five attempts per account per 15-minute bucket.

## Password reset

Run privately in your local terminal:

```sh
npm run db:setup -- --reset ale
# or
npm run db:setup -- --reset sharlotte
```

This prompts for a new password and revokes that account's sessions. No passwords are printed or stored as plaintext. Passwords are salted scrypt hashes; session cookies contain random tokens and only token hashes are stored in Atlas. Sessions expire after seven days. Expiry is checked by the API even before Atlas removes the document.

## Access rules

- Personal task: only its creator can list, read, edit, or delete it.
- Shared task: both accounts can read, edit, and delete it.
- Only the creator may change a task's visibility.
- Personal assignments must be unassigned or the creator; shared assignments may be either account.
- Ownership comes from the session. Client-supplied ownership is rejected.
- The board has Mine and Ours tabs; the other person's private tasks are never downloaded.

Use **Refresh** to load changes made on another device. There is no realtime subscription yet. Edits include task versions; if another client changed the task, the API rejects the stale edit and the board reloads instead of silently overwriting it. A failed save does not fall back to localStorage.

## Collections and validation

Definitions: `server/schema.js`; request validation: `server/domain.js`.

| Collection      | Fields                                                                                                                                 |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `users`         | `_id` (`ale` or `sharlotte`), name, passwordHash, starter, timestamps                                                                  |
| `sessions`      | hashed token `_id`, userId, createdAt, expiresAt                                                                                       |
| `tasks`         | UUID `_id`, ownerId, visibility, assigneeId, title, description, status, companion, priority, due, minutes, steps, version, timestamps |
| `loginAttempts` | bucket `_id`, count, expiresAt                                                                                                         |

Checklists are embedded. Dates are local calendar strings (`YYYY-MM-DD`) or empty; timestamps are UTC BSON dates. TTL indexes clean up sessions and login counters. Task indexes support ownership/shared queries. Login limits are persistent in Atlas (10 attempts per account and 30 per direct connection IP per 15-minute bucket). Forwarding headers are not trusted; behind a proxy the IP limit may be shared by both accounts.

## API

All routes except login require a valid session. Logout can also clear an expired session.

- `POST /api/login` — `{ login, password }`
- `POST /api/logout`
- `POST /api/password` — `{ currentPassword, newPassword, confirmPassword }`; authenticated, changes only the signed-in account
- `GET /api/me`, `PATCH /api/me` — `{ starter }`
- `GET /api/tasks` (100 per page, optional `?after=<next>`, frontend loads all pages), `POST /api/tasks`
- `GET /api/tasks/:id`, `PATCH /api/tasks/:id`, `DELETE /api/tasks/:id`

Task create/update body: `{ title, description, visibility, assigneeId, status, companion, priority, due, minutes, steps }`. PATCH also requires `version`. The owner is immutable. Updates are complete task replacements for editable fields, not arbitrary MongoDB updates. Every mutation requires exact `Origin: APP_ORIGIN`, JSON, and `X-Pokedo-Request: 1`; no permissive cross-origin access is enabled. The frontend sends these requests automatically.

## Checks

```sh
npm run check
npm test
```

Tests use an in-memory database adapter to verify the API, password/session behavior, per-user authorization, shared access, validation, conflicts, expiry, and CSRF rejection. They do **not** prove Atlas connectivity or run the MongoDB validators. An opt-in Atlas schema test is available with a separate test connection string (see `test/atlas.test.js`). A real connection and browser review are required before production.

## Hosting later

The implementation runs on **Node.js with MongoDB network access**. It is not a static-only Pages deploy or a ready-made Workers application. For the first deployment, choose a Node-capable host, configure a dedicated Atlas database user and host egress access, terminate HTTPS, set `NODE_ENV=production`, `APP_ORIGIN=https://your-app-domain`, and `HOST=0.0.0.0` as appropriate. Production cookies use Secure, HttpOnly, SameSite=Strict. The API serves only the three public frontend files, not `.env`, scripts, or server source.

Hosting and credentials have not been provisioned automatically. Do not upload the entire folder to a static host: use the Node server so server files remain private. Your domain registration can stay at GoDaddy; a separate subdomain can be configured after a host is chosen.

## Pokémon artwork

Seven curated companions use the public [PokéAPI sprites repository](https://github.com/PokeAPI/sprites). No API call is needed per task. Artwork requires an internet connection. Pokémon and character names belong to their respective owners; this is an unofficial personal application.

## Task evolution and dragging

Drag a card into any column with a mouse. The existing Next button and task status selector remain available for keyboard and touch. Moves use the same authenticated, version-checked API; failed moves reload saved data.

Tasks keep their assigned base species ID in Atlas. To do / Ready show the base form; In progress shows an intermediate form when available; Done shows the final form. Single-stage Pokémon stay in their original form. Two-stage Pokémon evolve at completion. Branching families use a deterministic first branch so they never change between devices. Moving backward restores the earlier form with a hit reaction. New encounters are assigned by the server from the base-species pool; clients cannot choose or swap the companion. Existing companions remain valid.

Successful form changes and backward moves show a dismissible sprite animation. It never runs for failed saves or ordinary reloads. Reduced-motion preferences replace it with a brief text notification.

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for GitHub Actions, Render, Atlas network access, and the separate `pokedo.alebyte.me` subdomain. `npm start` loads a local `.env` if present and also supports hosting environment variables without an `.env` file.

Startup logs report missing URI, invalid origin, authentication, and network-access problems without printing MongoDB errors or secrets. On Render, the message that `.env` is absent is expected: configure the service Environment variables instead.

## Catalog and login identifiers

The fixed login identifiers are `alejoeie` and `shar`. Internal account IDs remain `ale` and `sharlotte`, preserving passwords, sessions, task ownership, and CLI reset commands. Names are shown only in the authenticated workspace.

`data/pokemon.json` caches 1,025 species and 541 unevolved species from PokéAPI's CSV dataset. `server/pokemon.js` selects uniformly from base species using Node's crypto randomInt. The server provides cached metadata at `/pokemon-catalog.json`; it does not call PokéAPI during task creation. Legacy task species remain valid even if later games introduced pre-evolutions. The user-selected starter remains the profile companion and does not affect random task assignment.

When deploying catalog changes, run schema initialization against Atlas first to expand the allowed companion IDs. This changes validators/indexes only and does not reset accounts or modify tasks.
