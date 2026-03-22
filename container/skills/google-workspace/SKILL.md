---
name: google-workspace
description: Create, edit, read, and share Google Docs, Sheets, and Slides. Use when the user asks to create documents, spreadsheets, presentations, or share files with others.
---

# Google Workspace

You can create, edit, read, and share Google Docs, Sheets, and Slides using the `google-workspace` tool.

## Commands

All commands are run via:
```bash
node ${CLAUDE_SKILL_DIR}/google-workspace.mjs <command> [options]
```

---

## Google Docs

### Create a Google Doc
```bash
node ${CLAUDE_SKILL_DIR}/google-workspace.mjs create-doc --title "Meeting Notes" --content "Discussion points..."
```

### Edit a Google Doc
```bash
# Append text to end
node ${CLAUDE_SKILL_DIR}/google-workspace.mjs edit-doc --doc-id "DOC_ID" --content "New paragraph"

# Replace all content
node ${CLAUDE_SKILL_DIR}/google-workspace.mjs edit-doc --doc-id "DOC_ID" --content "Replacement text" --mode replace
```

### Insert a Table into a Doc
```bash
node ${CLAUDE_SKILL_DIR}/google-workspace.mjs insert-table --doc-id "DOC_ID" --data '[["Name","Age","City"],["Alice",30,"NYC"],["Bob",25,"LA"]]'
```
Inserts a table at the end of the document. Data is a JSON array of arrays.

### Insert an Image into a Doc
```bash
node ${CLAUDE_SKILL_DIR}/google-workspace.mjs insert-image --doc-id "DOC_ID" --url "https://example.com/image.png"

# With specific width (in points, 72pt = 1 inch)
node ${CLAUDE_SKILL_DIR}/google-workspace.mjs insert-image --doc-id "DOC_ID" --url "https://example.com/image.png" --width 400
```
The image URL must be publicly accessible.

### Read a Google Doc
```bash
node ${CLAUDE_SKILL_DIR}/google-workspace.mjs read-doc --doc-id "DOC_ID"
```

---

## Google Sheets

### Create a Google Sheet
```bash
node ${CLAUDE_SKILL_DIR}/google-workspace.mjs create-sheet --title "Budget" --data '[["Item","Cost"],["Rent",1500],["Food",400]]'
```
The `--data` option takes a JSON array of arrays (rows of cells).

### Edit Cells in a Sheet
```bash
node ${CLAUDE_SKILL_DIR}/google-workspace.mjs edit-sheet --sheet-id "SHEET_ID" --range "A1:C3" --data '[["Name","Age","City"],["Alice",30,"NYC"],["Bob",25,"LA"]]'
```

### Append Rows to a Sheet
```bash
node ${CLAUDE_SKILL_DIR}/google-workspace.mjs append-rows --sheet-id "SHEET_ID" --data '[["New Item",99],["Another",42]]'

# Append to a specific tab
node ${CLAUDE_SKILL_DIR}/google-workspace.mjs append-rows --sheet-id "SHEET_ID" --range "Sheet2" --data '[["Data",123]]'
```
Adds rows after the last row with data. Unlike `edit-sheet`, you don't need to know the exact range.

### Clear a Range
```bash
node ${CLAUDE_SKILL_DIR}/google-workspace.mjs clear-range --sheet-id "SHEET_ID" --range "Sheet1!A2:D100"
```
Clears cell values in the specified range without deleting the cells.

### Add a Sheet Tab
```bash
node ${CLAUDE_SKILL_DIR}/google-workspace.mjs add-sheet-tab --sheet-id "SHEET_ID" --title "Q2 Data"
```

### List Sheet Tabs
```bash
node ${CLAUDE_SKILL_DIR}/google-workspace.mjs list-sheet-tabs --sheet-id "SHEET_ID"
```
Shows all tabs with their names, IDs, and dimensions.

### Read a Google Sheet
```bash
node ${CLAUDE_SKILL_DIR}/google-workspace.mjs read-sheet --sheet-id "SHEET_ID" --range "A1:D10"
```

---

## Google Slides

### Create a Presentation
```bash
node ${CLAUDE_SKILL_DIR}/google-workspace.mjs create-slides --title "Q4 Review" --slides '[{"title":"Overview","body":"Key metrics and highlights"},{"title":"Revenue","body":"Revenue grew 15% YoY"}]'
```
The `--slides` option takes a JSON array of `{"title","body"}` objects. Each becomes a slide after the default title slide.

### Add a Slide
```bash
node ${CLAUDE_SKILL_DIR}/google-workspace.mjs add-slide --presentation-id "PRES_ID" --title "New Slide" --body "Slide content here"
```

### Update a Slide
```bash
# By slide index (0-based)
node ${CLAUDE_SKILL_DIR}/google-workspace.mjs update-slide --presentation-id "PRES_ID" --slide-index 1 --title "Updated Title" --body "Updated body text"

# By slide object ID (from read-slides output)
node ${CLAUDE_SKILL_DIR}/google-workspace.mjs update-slide --presentation-id "PRES_ID" --slide-id "g123abc" --title "New Title"
```
Replaces the title and/or body text of an existing slide.

### Delete a Slide
```bash
# By index
node ${CLAUDE_SKILL_DIR}/google-workspace.mjs delete-slide --presentation-id "PRES_ID" --slide-index 2

# By object ID
node ${CLAUDE_SKILL_DIR}/google-workspace.mjs delete-slide --presentation-id "PRES_ID" --slide-id "g123abc"
```

### Read a Presentation
```bash
node ${CLAUDE_SKILL_DIR}/google-workspace.mjs read-slides --presentation-id "PRES_ID"
```
Returns the title and text content of each slide, plus their object IDs.

---

## File Management (Docs, Sheets, and Slides)

### Share a File
```bash
# Share with write access
node ${CLAUDE_SKILL_DIR}/google-workspace.mjs share --file-id "FILE_ID" --email "user@example.com" --role writer

# Share with read-only access
node ${CLAUDE_SKILL_DIR}/google-workspace.mjs share --file-id "FILE_ID" --email "user@example.com" --role reader

# Share with comment access
node ${CLAUDE_SKILL_DIR}/google-workspace.mjs share --file-id "FILE_ID" --email "user@example.com" --role commenter
```

### Transfer Ownership
```bash
node ${CLAUDE_SKILL_DIR}/google-workspace.mjs transfer-ownership --file-id "FILE_ID" --email "user@example.com"
```
Transfers file ownership from the service account to the specified user. **Both accounts must be in the same Google Workspace domain** — this will not work with consumer Gmail accounts. The new owner receives an email notification. After transfer, the service account retains writer access but no longer owns the file.

### Rename a File
```bash
node ${CLAUDE_SKILL_DIR}/google-workspace.mjs rename --file-id "FILE_ID" --name "New Document Title"
```

### Copy/Duplicate a File
```bash
node ${CLAUDE_SKILL_DIR}/google-workspace.mjs copy --file-id "FILE_ID" --name "Copy of Budget"
```

### Delete a File
```bash
node ${CLAUDE_SKILL_DIR}/google-workspace.mjs delete --file-id "FILE_ID"
```

### Export as PDF
```bash
node ${CLAUDE_SKILL_DIR}/google-workspace.mjs export-pdf --file-id "FILE_ID"

# Custom output path
node ${CLAUDE_SKILL_DIR}/google-workspace.mjs export-pdf --file-id "FILE_ID" --output /tmp/report.pdf
```
Works for Docs, Sheets, and Slides. Saves the PDF locally and returns the file path.

### Get File Info
```bash
node ${CLAUDE_SKILL_DIR}/google-workspace.mjs info --file-id "FILE_ID"
```
Returns metadata: name, type, URL, created/modified dates, owners, and current permissions.

### List Files
```bash
# List recent docs, sheets, and slides
node ${CLAUDE_SKILL_DIR}/google-workspace.mjs list

# Search by keyword
node ${CLAUDE_SKILL_DIR}/google-workspace.mjs list --query "budget"
```

---

## Output

All commands output JSON with `success: true/false`. On success, relevant IDs and URLs are included. Always share the URL with the user after creating a document.

## Sharing

After creating a doc, sheet, or presentation, it is automatically made viewable by anyone with the link. To give specific people edit access, use the `share` command with `--role writer`. You can share with multiple people by running the command multiple times with different emails.

## Tips

- The `--data` flag for sheets takes a JSON array of arrays. Each inner array is a row.
- The `--slides` flag for presentations takes a JSON array of `{"title":"...","body":"..."}` objects.
- Use `append-rows` instead of `edit-sheet` when adding data to the end — you don't need to calculate the range.
- Use `insert-table` to add structured data to a doc instead of plain text.
- File IDs are found in the URL: `docs.google.com/document/d/DOC_ID/edit`
- After creating or sharing, always tell the user the URL so they can access it.
- The `share`, `rename`, `copy`, `delete`, `export-pdf`, and `info` commands work for all file types.
- Use `read-slides` to get slide object IDs needed for `update-slide` and `delete-slide`.
