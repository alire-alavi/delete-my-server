# get-task-delete-server

Schedules deletion of a YottaSrc server with a cancel window. When a deletion is scheduled, a Telegram
message with a **🛑 Cancel deletion** button is sent. If nobody presses it before the grace period ends,
a real Chrome browser logs in to `console.yottasrc.com` and deletes the server.

## Deploy on a server (Docker)

Every week at `WEEKLY_DAY WEEKLY_TIME` (in `TZ`) the bot sends a Cancel message for each server in
`WEEKLY_SERVERS`; each one is deleted `GRACE_MINUTES` later unless you press Cancel.

```bash
# on the server, in a copy of this repo
cp .env.example .env && chmod 600 .env     # fill in credentials, WEEKLY_*, TZ, VNC_PASSWORD
docker compose build                        # if Docker Hub is blocked: BASE_IMAGE=<mirror>/oven/bun:1.2.18-debian docker compose build

# one-time login, shown over VNC (the port is bound to the server's loopback only)
docker compose run --rm --service-ports login
#   on your machine: ssh -L 5900:127.0.0.1:5900 user@server, then open a VNC viewer at localhost:5900
#   solve the captcha / email code in the browser; the session is stored in the `data` volume

docker compose run --rm -it app dry-run <server>   # stops before the final confirm; or check Telegram screenshots
docker compose up -d                                # start the bot + weekly scheduler
docker compose logs -f app
```

Telegram `/next` shows the schedule and the next run. Set `DRY_RUN=false` in `.env` and run
`docker compose up -d` again only after a dry run looks right.

The container runs Chrome on a virtual display (Xvfb) because Cloudflare Turnstile rejects headless Chrome.
If the saved session expires, the bot logs in again with your credentials and asks for any email code in Telegram.
If that fails it reports the error, and you repeat the VNC login.

## Local setup

```bash
bun install
cp .env.example .env      # fill in YottaSrc + Telegram values
bun run login             # one-time: headed Chrome, solve the captcha/email code, session is saved
bun run dry-run <server>  # walks the delete flow, stops before the final confirm, screenshots in data/debug/
```

`<server>` is the server's console URL (most reliable) or its exact name/hostname as shown in the server list.
If the dry run can't find the buttons, set `YOTTA_DELETE_SELECTOR` / `YOTTA_CONFIRM_SELECTOR` in `.env`.

Only after the dry run looks right, set `DRY_RUN=false`.

## Run

```bash
bun run start             # Telegram bot + scheduler (on a box without a display: xvfb-run bun run start)
```

From Telegram: `/delete <server> [minutes]`, `/jobs`, `/cancel <id>`.
From the shell (picked up by the running service): `bun run schedule <server> [minutes]`, `bun run jobs`.

## Safety behaviour

- Cancel and the scheduler both use atomic `pending → cancelled/running` updates, so a cancel can't race a deletion.
- A job never runs before its Cancel button has been sent; late or post-restart jobs get `RESTART_GRACE_MINUTES` extra.
- Jobs interrupted mid-run by a crash are marked failed and never retried automatically.
- Ambiguous matches (zero or several servers / delete buttons) abort instead of guessing.
- If YottaSrc asks for an email verification code, the bot asks you for it in Telegram.

## Notes

- Cloudflare Turnstile protects the login page and rejects headless Chrome, so `HEADLESS=false` is the default.
- `data/` holds the SQLite DB, the Chrome profile (logged-in session) and screenshots. It is gitignored. Keep it private.
