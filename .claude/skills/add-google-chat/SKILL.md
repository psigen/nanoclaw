---
name: add-google-chat
description: Add Google Chat as a channel. Uses Google Cloud Pub/Sub for receiving messages (no public URL needed) and the Google Chat API for sending. Requires a Google Cloud project with a service account.
---

# Add Google Chat Channel

This skill adds Google Chat support to NanoClaw, then walks through interactive setup.

## Phase 1: Pre-flight

### Check if already applied

Check if `src/channels/googlechat.ts` exists. If it does, skip to Phase 3 (Setup). The code changes are already in place.

### Ask the user

Use `AskUserQuestion` to collect configuration:

AskUserQuestion: Do you have a Google Cloud project with a Chat app configured, or do you need to create one?

If they have one, collect credentials in Phase 3. If not, we'll walk through setup in Phase 3.

## Phase 2: Apply Code Changes

### Write the channel source

If `src/channels/googlechat.ts` does not exist, write it now. The channel:

- Implements the `Channel` interface (`connect`, `sendMessage`, `isConnected`, `ownsJid`, `disconnect`, `syncGroups`)
- Self-registers via `registerChannel('googlechat', factory)`
- Uses JID prefix `gchat:` (e.g., `gchat:spaces/AAAA123`)
- Receives messages via Google Cloud Pub/Sub subscription
- Sends messages via `google.chat.spaces.messages.create`
- Reads credentials from env: `GOOGLE_CHAT_SERVICE_ACCOUNT_KEY`, `GOOGLE_CHAT_PROJECT_ID`, `GOOGLE_CHAT_SUBSCRIPTION_ID`
- Returns `null` from factory when credentials are missing (auto-disable)
- Splits messages at 4096 chars (Google Chat limit)

Ensure `import './googlechat.js'` is in `src/channels/index.ts`.

### Install dependencies

```bash
npm install googleapis @google-cloud/pubsub
```

### Validate code changes

```bash
npm run build
npx vitest run src/channels/googlechat.test.ts
```

All tests must pass and build must be clean before proceeding.

## Phase 3: Setup

### Create Google Cloud Chat App (if needed)

If the user doesn't have a Google Cloud project with Chat configured, tell them:

> I need you to set up a Google Chat app in Google Cloud. Here's how:
>
> **1. Create or select a Google Cloud project**
>    - Go to [Google Cloud Console](https://console.cloud.google.com)
>    - Create a new project or select an existing one
>    - Note the **Project ID** (you'll need it later)
>
> **2. Enable the Google Chat API**
>    - Go to **APIs & Services** > **Library**
>    - Search for "Google Chat API" and enable it
>
> **3. Configure the Chat app**
>    - Go to **APIs & Services** > **Google Chat API** > **Configuration**
>    - App name: Something friendly (e.g., "Andy Assistant")
>    - Avatar URL: Optional
>    - Description: Optional
>    - Under **Connection settings**, select **Cloud Pub/Sub**
>    - Enter a Pub/Sub topic name: `projects/YOUR_PROJECT_ID/topics/nanoclaw-chat`
>    - Under **Visibility**, choose who can discover the app (your org or specific people)
>    - Under **Permissions**, add users or groups who can use the app
>    - Click **Save**
>
> **4. Create the Pub/Sub topic and subscription**
>    - Go to **Pub/Sub** in Google Cloud Console
>    - The topic `nanoclaw-chat` should already exist (created by Chat API config)
>    - If not, create it: `projects/YOUR_PROJECT_ID/topics/nanoclaw-chat`
>    - Create a **Pull subscription** on that topic:
>      - Subscription ID: `nanoclaw-chat-sub`
>      - Delivery type: **Pull**
>      - Acknowledgement deadline: 30 seconds
>    - Grant the Chat service account `chat-api-push@system.gserviceaccount.com` the **Pub/Sub Publisher** role on the topic
>
> **5. Create a service account**
>    - Go to **IAM & Admin** > **Service Accounts**
>    - Click **Create Service Account**
>    - Name: `nanoclaw-chat`
>    - Grant roles:
>      - **Chat Bots** (`roles/chat.bot`)
>      - **Pub/Sub Subscriber** (`roles/pubsub.subscriber`)
>    - Click **Done**, then click on the service account
>    - Go to **Keys** > **Add Key** > **Create new key** > **JSON**
>    - Download the key file and save it somewhere safe (e.g., `~/.config/nanoclaw/google-chat-sa.json`)

Wait for the user to confirm they've completed these steps and have the key file path.

### Configure environment

Collect from the user:
- Path to the service account JSON key file
- Google Cloud project ID
- Pub/Sub subscription ID (default: `nanoclaw-chat-sub`)

Add to `.env`:

```bash
GOOGLE_CHAT_SERVICE_ACCOUNT_KEY=/path/to/google-chat-sa.json
GOOGLE_CHAT_PROJECT_ID=your-project-id
GOOGLE_CHAT_SUBSCRIPTION_ID=nanoclaw-chat-sub
```

Channels auto-enable when their credentials are present — no extra configuration needed.

Sync to container environment:

```bash
mkdir -p data/env && cp .env data/env/env
```

The container reads environment from `data/env/env`, not `.env` directly.

### Build and restart

```bash
npm run build
```

Restart:
- macOS: `launchctl kickstart -k gui/$(id -u)/com.nanoclaw`
- Linux: `systemctl --user restart nanoclaw`

## Phase 4: Registration

### Get Space ID

Tell the user:

> To get the Space ID for registration:
>
> 1. Open Google Chat and add the bot to a space (or start a DM with it)
> 2. Open the space in a web browser
> 3. The URL will look like: `https://chat.google.com/room/AAAA123` — the part after `/room/` is the space ID
> 4. The full space name format is `spaces/AAAA123`
>
> Alternatively, check the NanoClaw logs after starting the service — when the bot is added to a space, it logs the space name.

Wait for the user to provide the space name (format: `gchat:spaces/AAAA123`).

### Register the space

The space ID, name, and folder name are needed. Use `npx tsx setup/index.ts --step register` with the appropriate flags.

For a main chat (responds to all messages):

```bash
npx tsx setup/index.ts --step register -- --jid "gchat:spaces/<space-id>" --name "<space-name>" --folder "googlechat_main" --trigger "@${ASSISTANT_NAME}" --channel googlechat --no-trigger-required --is-main
```

For additional spaces (trigger-only):

```bash
npx tsx setup/index.ts --step register -- --jid "gchat:spaces/<space-id>" --name "<space-name>" --folder "googlechat_<space-name>" --trigger "@${ASSISTANT_NAME}" --channel googlechat
```

## Phase 5: Verify

### Test the connection

Tell the user:

> Send a message in your registered Google Chat space:
> - For main space: Any message works
> - For non-main: @mention the bot
>
> The bot should respond within a few seconds.

### Check logs if needed

```bash
tail -f logs/nanoclaw.log
```

## Troubleshooting

### Bot not responding

Check:
1. `GOOGLE_CHAT_SERVICE_ACCOUNT_KEY`, `GOOGLE_CHAT_PROJECT_ID`, and `GOOGLE_CHAT_SUBSCRIPTION_ID` are set in `.env` AND synced to `data/env/env`
2. Service account key file exists at the path specified
3. Space is registered in SQLite: `sqlite3 store/messages.db "SELECT * FROM registered_groups WHERE jid LIKE 'gchat:%'"`
4. For non-main spaces: message includes trigger pattern
5. Service is running: `systemctl --user status nanoclaw` (Linux) or `launchctl list | grep nanoclaw` (macOS)

### Pub/Sub not receiving messages

1. Verify the Chat API is configured with Pub/Sub connection in Google Cloud Console
2. Check the `chat-api-push@system.gserviceaccount.com` service account has **Pub/Sub Publisher** role on the topic
3. Verify the subscription exists and is attached to the correct topic: `gcloud pubsub subscriptions describe nanoclaw-chat-sub`
4. Check for unacknowledged messages: `gcloud pubsub subscriptions pull nanoclaw-chat-sub --auto-ack --limit=1`

### Authentication errors

1. Verify the service account key file is valid JSON: `cat /path/to/key.json | python3 -m json.tool`
2. Check the service account has the required roles: `Chat Bots` and `Pub/Sub Subscriber`
3. Verify the Google Chat API is enabled in the project

### Getting Space ID

If you can't find the space ID from the URL:
- Check NanoClaw logs after the bot is added to a space
- Use the Chat API directly: `curl -H "Authorization: Bearer $(gcloud auth print-access-token)" https://chat.googleapis.com/v1/spaces`

## Removal

To remove Google Chat integration:

1. Delete `src/channels/googlechat.ts` and `src/channels/googlechat.test.ts`
2. Remove `import './googlechat.js'` from `src/channels/index.ts`
3. Remove `GOOGLE_CHAT_*` variables from `.env`
4. Remove Google Chat registrations from SQLite: `sqlite3 store/messages.db "DELETE FROM registered_groups WHERE jid LIKE 'gchat:%'"`
5. Uninstall: `npm uninstall googleapis @google-cloud/pubsub`
6. Rebuild: `npm run build && systemctl --user restart nanoclaw` (Linux) or `npm run build && launchctl kickstart -k gui/$(id -u)/com.nanoclaw` (macOS)
