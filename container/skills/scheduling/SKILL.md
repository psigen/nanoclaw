---
name: scheduling
description: Translate natural-language scheduling requests into MCP tool calls. Handles reminders, recurring tasks, one-time tasks, cron expressions, and task management. Triggers on "remind me", "schedule", "every day/week/hour", "in X hours/minutes", "at X o'clock", "tomorrow at", "next Monday".
---

# Scheduling — Natural Language Task Scheduling

When the user asks to schedule something, convert their request into the appropriate `mcp__nanoclaw__schedule_task` call. This skill covers time parsing, schedule type selection, context mode, and prompt crafting.

## Step 1: Determine the current time

Always start by getting the current local time so you can compute relative times:

```bash
date '+%Y-%m-%dT%H:%M:%S %A %Z'
```

This gives you the timestamp, day of week, and timezone for accurate scheduling.

## Step 2: Choose schedule type

| User says | schedule_type | How to compute schedule_value |
|-----------|--------------|-------------------------------|
| "in 2 hours", "in 30 minutes", "tomorrow at 3pm", "next Tuesday at noon", "at 5pm today" | `once` | Compute the target local timestamp (see below) |
| "every day at 9am", "every Monday", "weekdays at 8:30", "first of every month" | `cron` | Build a cron expression (see below) |
| "every 5 minutes", "every 2 hours", "every 30 seconds" | `interval` | Convert to milliseconds |

## Step 3: Compute schedule_value

### For `once` — compute a local ISO timestamp

Use bash `date` to compute the target time. The result must be local time WITHOUT a Z suffix.

**Relative offsets ("in X hours/minutes"):**
```bash
date -d '+2 hours' '+%Y-%m-%dT%H:%M:%S'
date -d '+30 minutes' '+%Y-%m-%dT%H:%M:%S'
date -d '+1 day' '+%Y-%m-%dT%H:%M:%S'
```

**Specific time today ("at 3pm", "at 17:00"):**
```bash
date -d 'today 15:00' '+%Y-%m-%dT%H:%M:%S'
```

If the time has already passed today, schedule for tomorrow:
```bash
date -d 'tomorrow 15:00' '+%Y-%m-%dT%H:%M:%S'
```

**Specific day ("tomorrow at 3pm", "next Tuesday at noon"):**
```bash
date -d 'tomorrow 15:00' '+%Y-%m-%dT%H:%M:%S'
date -d 'next Tuesday 12:00' '+%Y-%m-%dT%H:%M:%S'
date -d 'next Friday 09:30' '+%Y-%m-%dT%H:%M:%S'
```

**Specific date ("March 15 at 2pm", "2026-04-01 at 10am"):**
```bash
date -d '2026-03-15 14:00' '+%Y-%m-%dT%H:%M:%S'
```

### For `cron` — build a cron expression

Format: `minute hour day-of-month month day-of-week`

| Pattern | Expression | Notes |
|---------|-----------|-------|
| Every day at 9am | `0 9 * * *` | |
| Every weekday at 8:30am | `30 8 * * 1-5` | Mon–Fri |
| Every Monday at 10am | `0 10 * * 1` | |
| Every hour | `0 * * * *` | On the hour |
| Every 15 minutes | `*/15 * * * *` | |
| Every 5 minutes | `*/5 * * * *` | |
| First of every month at 9am | `0 9 1 * *` | |
| Every Sunday at 6pm | `0 18 * * 0` | |
| Twice daily (9am and 5pm) | `0 9,17 * * *` | |
| Every weekday at 9am and 1pm | `0 9,13 * * 1-5` | |

Day-of-week: 0=Sunday, 1=Monday, ..., 6=Saturday

All cron times are in LOCAL timezone.

### For `interval` — convert to milliseconds

| Duration | Milliseconds |
|----------|-------------|
| 30 seconds | `30000` |
| 1 minute | `60000` |
| 5 minutes | `300000` |
| 15 minutes | `900000` |
| 30 minutes | `1800000` |
| 1 hour | `3600000` |
| 2 hours | `7200000` |
| 6 hours | `21600000` |
| 12 hours | `43200000` |
| 24 hours | `86400000` |

Prefer `cron` over `interval` when the user specifies clock times ("every hour at :30") since intervals drift relative to wall-clock time.

## Step 4: Choose context mode

| Mode | When to use | Example requests |
|------|-------------|-----------------|
| `group` | Task needs conversation history, user preferences, or recent context | "Remind me about what we discussed", "Follow up on my request", "Check on the thing I asked about" |
| `isolated` | Task is self-contained — all info fits in the prompt | "Check the weather", "Send a daily news summary", "Ping example.com every hour" |

**Default to `group`** unless the task is clearly independent. When using `isolated`, include ALL necessary context in the prompt.

## Step 5: Craft the task prompt

The prompt is what the agent receives when the task fires. Write it as a complete instruction.

**For reminders** — include the message to deliver:
> Send this reminder to the user: "Time to check your email and respond to any urgent messages."

**For recurring tasks** — be specific about what to do and how to report:
> Check the current weather for San Francisco. Send a brief summary including temperature, conditions, and any alerts. Keep the message under 3 sentences.

**For monitoring tasks** — specify when to notify vs stay silent:
> Check if https://example.com returns a 200 status code. Only send a message if the site is DOWN or responding with errors. If everything is fine, wrap your output in <internal> tags to suppress it.

**For tasks using `isolated` mode** — include all context the agent needs since it has no conversation history:
> You are a daily briefing assistant. Every morning, search for the top 3 tech news stories and send a brief summary. Format as a numbered list with one sentence each.

## Step 6: Call the MCP tool

After computing everything, call `mcp__nanoclaw__schedule_task` with:
- `prompt`: the crafted task prompt
- `schedule_type`: `once`, `cron`, or `interval`
- `schedule_value`: the computed value
- `context_mode`: `group` or `isolated`

**Always confirm** the scheduled task to the user, including:
- What will happen (the task description)
- When it will run (human-readable time/schedule)
- The task ID (for future management)

## Task management

When the user wants to manage existing tasks:

| Request | Action |
|---------|--------|
| "Show my tasks", "What's scheduled?" | Call `mcp__nanoclaw__list_tasks` |
| "Pause the reminder" | Call `mcp__nanoclaw__pause_task` with the task ID |
| "Resume it" | Call `mcp__nanoclaw__resume_task` with the task ID |
| "Cancel the daily report" | Call `mcp__nanoclaw__cancel_task` with the task ID |
| "Change it to 10am instead" | Call `mcp__nanoclaw__update_task` with new schedule |
| "Update the prompt to include weather" | Call `mcp__nanoclaw__update_task` with new prompt |

If the user refers to a task by description rather than ID, call `list_tasks` first to find the matching task ID.

## Common patterns

**Simple reminder:**
User: "Remind me in 1 hour to call the dentist"
→ `once`, compute timestamp 1 hour from now, `group` mode
→ Prompt: "Send this reminder: Time to call the dentist!"

**Daily recurring:**
User: "Every morning at 8am, give me a weather update"
→ `cron`, `0 8 * * *`, `isolated` mode
→ Prompt: "Check the current weather and send a brief morning update with temperature and conditions."

**Monitoring:**
User: "Check my website every 5 minutes and tell me if it goes down"
→ `cron`, `*/5 * * * *`, `isolated` mode
→ Prompt: "Check if https://example.com returns HTTP 200. Only send a message if the site is DOWN or returning errors. If healthy, wrap output in <internal> tags."

**Weekday schedule:**
User: "Every weekday at 5pm, remind me to write my standup"
→ `cron`, `0 17 * * 1-5`, `group` mode
→ Prompt: "Send this reminder: Time to write your standup notes for tomorrow!"

**One-time future task:**
User: "Next Monday at 9am, send me a summary of open issues"
→ `once`, compute next Monday 9am timestamp, `group` mode
→ Prompt: "Review any open issues or pending items and send a summary to the user."
