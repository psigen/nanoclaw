---
name: add-discord-image-vision
description: Add image vision to NanoClaw agents for Discord. Downloads and processes Discord image attachments, then sends them to Claude as multimodal content blocks so the agent can see and understand images.
---

# Discord Image Vision Skill

Adds the ability for NanoClaw agents to see and understand images sent via Discord. Images are downloaded from Discord's CDN, resized with sharp, saved to the group workspace, and passed to the agent as base64-encoded multimodal content blocks.

## Phase 1: Pre-flight

1. Check if `src/image.ts` exists — skip to Phase 3 if already applied
2. Confirm Discord channel is installed: `src/channels/discord.ts` must exist
3. Confirm `sharp` is installable (native bindings require build tools)

**Prerequisite:** Discord must be installed first (run `/add-discord`).

## Phase 2: Apply Code Changes

### Create `src/image.ts`

Create a channel-agnostic image processing module with:
- `downloadImage(url: string): Promise<Buffer>` — fetches image from any URL via `fetch`
- `processImage(buffer: Buffer, groupDir: string, caption: string)` — resizes to max 1024px with sharp, converts to JPEG (quality 85), saves to `{groupDir}/attachments/img-{timestamp}.jpg`
- `parseImageReferences(messages)` — extracts `[Image: attachments/...]` references from message content, returns `Array<{ relativePath, mediaType }>`

Directories and files must be created with `mode: 0o777` / `mode: 0o666` for rootless Docker compatibility.

### Install sharp

```bash
npm install sharp
```

### Modify `src/channels/discord.ts`

Replace the image attachment placeholder logic. When a registered group receives a message with image attachments:

1. Download the image from `att.url` via `downloadImage()`
2. Process it via `processImage()` — saves to group's `attachments/` directory
3. Set message content to `[Image: attachments/img-xxx.jpg]` (or `[Image: attachments/img-xxx.jpg] caption` if the image had a name)
4. Fall back to `[Image: name]` placeholder if download or processing fails, or if the group isn't registered

Non-image attachments (video, audio, files) keep their existing placeholder behavior.

### Modify `src/index.ts`

1. Import `parseImageReferences` from `./image.js`
2. In `processGroupMessages()`, after building the prompt with `formatMessages()`, call `parseImageReferences(missedMessages)` to extract image attachment paths
3. Pass the resulting `imageAttachments` array through `runAgent()` to `runContainerAgent()`
4. Add `imageAttachments` parameter to the `runAgent()` function signature

### Modify `src/container-runner.ts`

Add `imageAttachments?: Array<{ relativePath: string; mediaType: string }>` to the `ContainerInput` interface.

### Modify `container/agent-runner/src/index.ts`

1. Add types: `ImageContentBlock`, `TextContentBlock`, `ContentBlock`
2. Update `SDKUserMessage.message.content` type to `string | ContentBlock[]`
3. Add `imageAttachments` field to the `ContainerInput` interface
4. Add `pushMultimodal(content: ContentBlock[])` method to `MessageStream`
5. In `runQuery()`, after `stream.push(prompt)`, load image attachments from `/workspace/group/{relativePath}` as base64, create `ImageContentBlock` entries, and push via `stream.pushMultimodal(blocks)`

### Validate code changes

```bash
npm run build
npx vitest run src/channels/discord.test.ts
```

Update any Discord tests that assert on image attachment content — image attachments for unregistered groups should still produce `[Image: name]` placeholders. Tests for registered groups with `url` on the attachment should verify the processed `[Image: attachments/img-xxx.jpg]` format.

All tests must pass and build must be clean before proceeding.

## Phase 3: Configure

1. Rebuild the container (agent-runner changes need a rebuild):
   ```bash
   ./container/build.sh
   ```

2. Clear cached agent-runner sources so they pick up the new code:
   ```bash
   rm -rf data/sessions/*/agent-runner-src
   ```

3. Restart the service:
   ```bash
   # macOS:
   launchctl kickstart -k gui/$(id -u)/com.nanoclaw
   # Linux:
   systemctl --user restart nanoclaw
   ```

## Phase 4: Verify

1. Send an image in a registered Discord channel
2. Check the agent responds with understanding of the image content
3. Check logs for "Discord image attachment processed":
   ```bash
   tail -50 logs/nanoclaw.log | grep -i image
   ```
4. Check container logs for "Loaded image":
   ```bash
   tail -50 groups/*/logs/container-*.log | grep -i image
   ```

## How It Works

1. User sends an image in Discord
2. Discord channel downloads the image from Discord's CDN
3. Image is resized (max 1024px) and converted to JPEG via sharp
4. Saved to `groups/{folder}/attachments/img-{timestamp}.jpg`
5. Message content stored as `[Image: attachments/img-xxx.jpg]`
6. When processing the message, `parseImageReferences()` extracts the path
7. Container receives `imageAttachments` array in its input JSON
8. Agent-runner reads the image file, base64-encodes it, sends as a multimodal content block to Claude
9. Claude can see and describe the image

## Troubleshooting

- **Agent doesn't mention image content**: Check container logs for "Loaded image" messages. If missing, ensure agent-runner source was synced (`rm -rf data/sessions/*/agent-runner-src` then restart).
- **"Failed to process Discord image attachment"**: The download from Discord's CDN may have timed out. Check network connectivity. Discord CDN URLs are temporary — the image must be downloaded promptly.
- **Sharp not installing**: Sharp requires native bindings. On Linux, ensure build tools are installed (`build-essential`). On macOS, `xcode-select --install`.
- **Images not visible to agent but saved to disk**: Ensure the container was rebuilt after adding the agent-runner changes (`./container/build.sh`).
- **Permission errors on attachments directory**: Ensure directories are created with `mode: 0o777` for rootless Docker compatibility.

## Removal

1. Revert `src/channels/discord.ts` to use simple placeholders for image attachments
2. Remove `imageAttachments` from `src/index.ts`, `src/container-runner.ts`, and `container/agent-runner/src/index.ts`
3. Delete `src/image.ts`
4. Uninstall: `npm uninstall sharp`
5. Rebuild: `npm run build && ./container/build.sh`
6. Restart service
