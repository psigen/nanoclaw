---
name: add-google-workspace
description: Add Google Docs, Sheets, and Slides integration. Lets the agent create, edit, read, and share Google Docs, Sheets, and Slides. Requires a Google Cloud service account.
---

# Add Google Workspace Integration

This skill adds Google Docs, Sheets, and Slides support to NanoClaw container agents.

## Phase 1: Pre-flight

### Check if already applied

Check if `container/skills/google-workspace/google-workspace.mjs` exists AND `data/credentials/google-workspace.json` exists.

- Both exist → skip to Phase 4 (Verify)
- Code exists but no credentials → skip to Phase 3 (Setup)
- Neither exists → proceed to Phase 2

## Phase 2: Apply Code Changes

### Check for skill files

If `container/skills/google-workspace/google-workspace.mjs` does not exist, the skill code needs to be written. Write:

1. `container/skills/google-workspace/google-workspace.mjs` — CLI tool with commands: create-doc, create-sheet, edit-doc, edit-sheet, read-doc, read-sheet, share, list
2. `container/skills/google-workspace/SKILL.md` — Agent instructions for using the tool

### Add googleapis dependency

Add `googleapis` to `container/agent-runner/package.json` dependencies if not already present.

### Add credentials mount

Ensure `src/container-runner.ts` mounts `data/credentials/` to `/workspace/credentials/` (read-only) in containers.

### Rebuild container

```bash
./container/build.sh
```

Wait for the build to complete before proceeding.

## Phase 3: Setup

### Create Google Cloud Service Account

AskUserQuestion: Do you have a Google Cloud service account with Docs, Sheets, and Drive API access?

If they need to create one, tell them:

> Here's how to set up Google Workspace API access:
>
> **1. Create or select a Google Cloud project**
>    - Go to [Google Cloud Console](https://console.cloud.google.com)
>    - Create a new project or select an existing one
>
> **2. Enable the required APIs**
>    - Go to **APIs & Services** > **Library**
>    - Search for and enable each of these:
>      - **Google Docs API**
>      - **Google Sheets API**
>      - **Google Slides API**
>      - **Google Drive API**
>
> **3. Create a service account**
>    - Go to **IAM & Admin** > **Service Accounts**
>    - Click **Create Service Account**
>    - Name: `nanoclaw-workspace`
>    - Click **Done** (no extra roles needed — the service account owns docs it creates)
>    - Click on the service account you just created
>    - Go to **Keys** > **Add Key** > **Create new key** > **JSON**
>    - Download the key file
>
> **Important:** The service account creates docs/sheets as itself. Documents are owned by the service account and shared with users via the Drive API. Users don't need to grant any access — the service account creates files in its own Drive space and shares them.

Wait for the user to confirm they have the key file.

### Install credentials

Ask for the path to the downloaded JSON key file. Then:

```bash
mkdir -p data/credentials
cp <path-to-key-file> data/credentials/google-workspace.json
chmod 644 data/credentials/google-workspace.json
```

### Rebuild and restart

```bash
npm run build
```

Restart the service:
- macOS: `launchctl kickstart -k gui/$(id -u)/com.nanoclaw`
- Linux: `systemctl --user restart nanoclaw`

## Phase 4: Verify

### Test the integration

Tell the user:

> Send a message to your bot asking it to create a Google Doc. For example:
>
> "Create a Google Doc called 'Test Document' with some sample content and share it with me at my-email@example.com"
>
> The bot should respond with a link to the created document.

### Check logs if needed

```bash
tail -f logs/nanoclaw.log
```

## Troubleshooting

### "Service account key not found"

The credentials file is missing from `data/credentials/google-workspace.json`. Re-run Phase 3.

### "Permission denied" or "Insufficient permissions"

1. Verify the Google Docs, Sheets, and Drive APIs are all enabled in your Google Cloud project
2. Check the service account has a valid key

### "File not found" when editing

The document/sheet ID may be incorrect. Document IDs are found in the URL:
- Docs: `docs.google.com/document/d/DOC_ID/edit`
- Sheets: `docs.google.com/spreadsheets/d/SHEET_ID/edit`

### "Unable to share" errors

The service account can only share files it owns (files it created). It cannot share files owned by other users unless those files were explicitly shared with the service account first.

### Container can't find the tool

Ensure the container was rebuilt after adding the skill files:
```bash
./container/build.sh
```

Also clear cached agent-runner sources:
```bash
rm -rf data/sessions/*/agent-runner-src
```

## Removal

1. Delete `container/skills/google-workspace/`
2. Delete `data/credentials/google-workspace.json`
3. Remove `googleapis` from `container/agent-runner/package.json`
4. Rebuild container: `./container/build.sh`
5. Restart service
