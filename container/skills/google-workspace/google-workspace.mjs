#!/usr/bin/env node
/**
 * Google Workspace CLI tool for NanoClaw container agents.
 * Creates/edits Google Docs, Sheets, and Slides, and shares them with users.
 *
 * Usage:
 *   node google-workspace.mjs create-doc --title "Title" [--content "Text"]
 *   node google-workspace.mjs create-sheet --title "Title" [--data '[[...]]']
 *   node google-workspace.mjs create-slides --title "Title" [--slides '[{"title":"...","body":"..."}]']
 *   node google-workspace.mjs edit-doc --doc-id ID --content "Text" [--mode append|replace]
 *   node google-workspace.mjs edit-sheet --sheet-id ID --range "A1:B2" --data '[[...]]'
 *   node google-workspace.mjs add-slide --presentation-id ID --title "Title" [--body "Text"]
 *   node google-workspace.mjs read-doc --doc-id ID
 *   node google-workspace.mjs read-sheet --sheet-id ID [--range "A1:B2"]
 *   node google-workspace.mjs read-slides --presentation-id ID
 *   node google-workspace.mjs share --file-id ID --email user@example.com [--role reader|writer|commenter]
 *   node google-workspace.mjs list [--query "search terms"]
 */

import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';

const CREDENTIALS_PATH = '/workspace/credentials/google-workspace.json';

function loadAuth() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.error(`Error: Service account key not found at ${CREDENTIALS_PATH}`);
    console.error('Run the /add-google-workspace skill to set up credentials.');
    process.exit(1);
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: CREDENTIALS_PATH,
    scopes: [
      'https://www.googleapis.com/auth/documents',
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/presentations',
      'https://www.googleapis.com/auth/drive',
    ],
  });

  google.options({ auth });
  return auth;
}

function parseArgs(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
      result[key] = value;
    }
  }
  return result;
}

async function createDoc(opts) {
  loadAuth();
  const docs = google.docs({ version: 'v1' });
  const drive = google.drive({ version: 'v3' });

  const title = opts.title || 'Untitled Document';

  const res = await docs.documents.create({
    requestBody: { title },
  });

  const docId = res.data.documentId;

  if (opts.content) {
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: {
        requests: [
          {
            insertText: {
              location: { index: 1 },
              text: opts.content,
            },
          },
        ],
      },
    });
  }

  // Make it accessible via link (anyone with link can view)
  await drive.permissions.create({
    fileId: docId,
    requestBody: {
      role: 'reader',
      type: 'anyone',
    },
  });

  const url = `https://docs.google.com/document/d/${docId}/edit`;
  console.log(JSON.stringify({ success: true, docId, url, title }, null, 2));
}

async function createSheet(opts) {
  loadAuth();
  const sheets = google.sheets({ version: 'v4' });
  const drive = google.drive({ version: 'v3' });

  const title = opts.title || 'Untitled Spreadsheet';

  const res = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title },
    },
  });

  const sheetId = res.data.spreadsheetId;

  if (opts.data) {
    const data = JSON.parse(opts.data);
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: 'Sheet1',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: data },
    });
  }

  // Make it accessible via link
  await drive.permissions.create({
    fileId: sheetId,
    requestBody: {
      role: 'reader',
      type: 'anyone',
    },
  });

  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
  console.log(JSON.stringify({ success: true, sheetId, url, title }, null, 2));
}

async function editDoc(opts) {
  loadAuth();
  const docs = google.docs({ version: 'v1' });

  if (!opts['doc-id']) {
    console.error('Error: --doc-id is required');
    process.exit(1);
  }
  if (!opts.content) {
    console.error('Error: --content is required');
    process.exit(1);
  }

  const docId = opts['doc-id'];
  const mode = opts.mode || 'append';
  const requests = [];

  if (mode === 'replace') {
    // Get current document to find end index
    const doc = await docs.documents.get({ documentId: docId });
    const endIndex = doc.data.body.content.reduce((max, el) => {
      return Math.max(max, el.endIndex || 0);
    }, 1);

    if (endIndex > 2) {
      requests.push({
        deleteContentRange: {
          range: { startIndex: 1, endIndex: endIndex - 1 },
        },
      });
    }
  }

  requests.push({
    insertText: {
      location: { index: 1 },
      text: mode === 'append' ? '\n' + opts.content : opts.content,
    },
  });

  await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: { requests },
  });

  console.log(JSON.stringify({ success: true, docId, mode }, null, 2));
}

async function editSheet(opts) {
  loadAuth();
  const sheets = google.sheets({ version: 'v4' });

  if (!opts['sheet-id']) {
    console.error('Error: --sheet-id is required');
    process.exit(1);
  }
  if (!opts.data) {
    console.error('Error: --data is required (JSON array of arrays)');
    process.exit(1);
  }

  const sheetId = opts['sheet-id'];
  const range = opts.range || 'Sheet1';
  const data = JSON.parse(opts.data);

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: data },
  });

  console.log(JSON.stringify({ success: true, sheetId, range, rowCount: data.length }, null, 2));
}

async function readDoc(opts) {
  loadAuth();
  const docs = google.docs({ version: 'v1' });

  if (!opts['doc-id']) {
    console.error('Error: --doc-id is required');
    process.exit(1);
  }

  const doc = await docs.documents.get({ documentId: opts['doc-id'] });
  const content = doc.data.body.content
    .filter((el) => el.paragraph)
    .map((el) =>
      el.paragraph.elements
        .map((e) => e.textRun?.content || '')
        .join('')
    )
    .join('');

  console.log(JSON.stringify({
    success: true,
    docId: opts['doc-id'],
    title: doc.data.title,
    content: content.trim(),
  }, null, 2));
}

async function readSheet(opts) {
  loadAuth();
  const sheets = google.sheets({ version: 'v4' });

  if (!opts['sheet-id']) {
    console.error('Error: --sheet-id is required');
    process.exit(1);
  }

  const range = opts.range || 'Sheet1';
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: opts['sheet-id'],
    range,
  });

  console.log(JSON.stringify({
    success: true,
    sheetId: opts['sheet-id'],
    range,
    values: res.data.values || [],
  }, null, 2));
}

async function appendRows(opts) {
  loadAuth();
  const sheets = google.sheets({ version: 'v4' });

  if (!opts['sheet-id']) {
    console.error('Error: --sheet-id is required');
    process.exit(1);
  }
  if (!opts.data) {
    console.error('Error: --data is required (JSON array of arrays)');
    process.exit(1);
  }

  const sheetId = opts['sheet-id'];
  const range = opts.range || 'Sheet1';
  const data = JSON.parse(opts.data);

  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: data },
  });

  console.log(JSON.stringify({
    success: true,
    sheetId,
    updatedRange: res.data.updates?.updatedRange,
    rowsAppended: data.length,
  }, null, 2));
}

async function clearRange(opts) {
  loadAuth();
  const sheets = google.sheets({ version: 'v4' });

  if (!opts['sheet-id']) {
    console.error('Error: --sheet-id is required');
    process.exit(1);
  }
  if (!opts.range) {
    console.error('Error: --range is required (e.g. "Sheet1!A1:D10")');
    process.exit(1);
  }

  await sheets.spreadsheets.values.clear({
    spreadsheetId: opts['sheet-id'],
    range: opts.range,
  });

  console.log(JSON.stringify({
    success: true,
    sheetId: opts['sheet-id'],
    clearedRange: opts.range,
  }, null, 2));
}

async function addSheetTab(opts) {
  loadAuth();
  const sheets = google.sheets({ version: 'v4' });

  if (!opts['sheet-id']) {
    console.error('Error: --sheet-id is required');
    process.exit(1);
  }
  if (!opts.title) {
    console.error('Error: --title is required (name of the new tab)');
    process.exit(1);
  }

  const res = await sheets.spreadsheets.batchUpdate({
    spreadsheetId: opts['sheet-id'],
    requestBody: {
      requests: [{
        addSheet: {
          properties: { title: opts.title },
        },
      }],
    },
  });

  const newSheet = res.data.replies[0].addSheet.properties;
  console.log(JSON.stringify({
    success: true,
    sheetId: opts['sheet-id'],
    tabId: newSheet.sheetId,
    tabTitle: newSheet.title,
  }, null, 2));
}

async function listSheetTabs(opts) {
  loadAuth();
  const sheets = google.sheets({ version: 'v4' });

  if (!opts['sheet-id']) {
    console.error('Error: --sheet-id is required');
    process.exit(1);
  }

  const res = await sheets.spreadsheets.get({
    spreadsheetId: opts['sheet-id'],
    fields: 'sheets.properties',
  });

  const tabs = (res.data.sheets || []).map((s) => ({
    tabId: s.properties.sheetId,
    title: s.properties.title,
    index: s.properties.index,
    rowCount: s.properties.gridProperties?.rowCount,
    columnCount: s.properties.gridProperties?.columnCount,
  }));

  console.log(JSON.stringify({ success: true, sheetId: opts['sheet-id'], tabs }, null, 2));
}

async function insertTable(opts) {
  loadAuth();
  const docs = google.docs({ version: 'v1' });

  if (!opts['doc-id']) {
    console.error('Error: --doc-id is required');
    process.exit(1);
  }
  if (!opts.data) {
    console.error('Error: --data is required (JSON array of arrays)');
    process.exit(1);
  }

  const docId = opts['doc-id'];
  const data = JSON.parse(opts.data);
  const rows = data.length;
  const cols = Math.max(...data.map((r) => r.length));

  // Get document end index for insertion
  const doc = await docs.documents.get({ documentId: docId });
  const endIndex = doc.data.body.content.reduce((max, el) => Math.max(max, el.endIndex || 0), 1);
  const insertAt = endIndex - 1;

  const requests = [
    { insertTable: { rows, columns: cols, location: { index: insertAt } } },
  ];

  await docs.documents.batchUpdate({ documentId: docId, requestBody: { requests } });

  // Re-read the doc to find the table and populate cells
  const updated = await docs.documents.get({ documentId: docId });
  const tables = updated.data.body.content.filter((el) => el.table);
  const table = tables[tables.length - 1]; // last table = the one we just inserted

  if (table) {
    const cellRequests = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cellContent = String(data[r]?.[c] ?? '');
        if (!cellContent) continue;
        const cell = table.table.tableRows[r]?.tableCells[c];
        if (cell?.content?.[0]?.startIndex != null) {
          cellRequests.push({
            insertText: {
              location: { index: cell.content[0].startIndex },
              text: cellContent,
            },
          });
        }
      }
    }
    // Insert in reverse order to preserve indices
    cellRequests.reverse();
    if (cellRequests.length > 0) {
      await docs.documents.batchUpdate({ documentId: docId, requestBody: { requests: cellRequests } });
    }
  }

  console.log(JSON.stringify({ success: true, docId, rows, cols }, null, 2));
}

async function insertImage(opts) {
  loadAuth();
  const docs = google.docs({ version: 'v1' });

  if (!opts['doc-id']) {
    console.error('Error: --doc-id is required');
    process.exit(1);
  }
  if (!opts.url) {
    console.error('Error: --url is required (public image URL)');
    process.exit(1);
  }

  const docId = opts['doc-id'];

  // Get document end index
  const doc = await docs.documents.get({ documentId: docId });
  const endIndex = doc.data.body.content.reduce((max, el) => Math.max(max, el.endIndex || 0), 1);

  const requests = [
    {
      insertInlineImage: {
        location: { index: endIndex - 1 },
        uri: opts.url,
        objectSize: opts.width ? {
          width: { magnitude: parseInt(opts.width), unit: 'PT' },
        } : undefined,
      },
    },
  ];

  await docs.documents.batchUpdate({ documentId: docId, requestBody: { requests } });

  console.log(JSON.stringify({ success: true, docId, imageUrl: opts.url }, null, 2));
}

async function deleteSlide(opts) {
  loadAuth();
  const slides = google.slides({ version: 'v1' });

  if (!opts['presentation-id']) {
    console.error('Error: --presentation-id is required');
    process.exit(1);
  }
  if (!opts['slide-index'] && !opts['slide-id']) {
    console.error('Error: --slide-index or --slide-id is required');
    process.exit(1);
  }

  const presentationId = opts['presentation-id'];
  let objectId = opts['slide-id'];

  if (!objectId) {
    const pres = await slides.presentations.get({ presentationId });
    const idx = parseInt(opts['slide-index']);
    const slide = pres.data.slides?.[idx];
    if (!slide) {
      console.error(`Error: No slide at index ${idx}`);
      process.exit(1);
    }
    objectId = slide.objectId;
  }

  await slides.presentations.batchUpdate({
    presentationId,
    requestBody: {
      requests: [{ deleteObject: { objectId } }],
    },
  });

  console.log(JSON.stringify({ success: true, presentationId, deletedSlide: objectId }, null, 2));
}

async function updateSlide(opts) {
  loadAuth();
  const slides = google.slides({ version: 'v1' });

  if (!opts['presentation-id']) {
    console.error('Error: --presentation-id is required');
    process.exit(1);
  }
  if (opts['slide-index'] == null && !opts['slide-id']) {
    console.error('Error: --slide-index or --slide-id is required');
    process.exit(1);
  }

  const presentationId = opts['presentation-id'];
  const pres = await slides.presentations.get({ presentationId });

  let slide;
  if (opts['slide-id']) {
    slide = pres.data.slides?.find((s) => s.objectId === opts['slide-id']);
  } else {
    slide = pres.data.slides?.[parseInt(opts['slide-index'])];
  }

  if (!slide) {
    console.error('Error: Slide not found');
    process.exit(1);
  }

  const requests = [];
  // Find title and body placeholders
  for (const el of slide.pageElements || []) {
    const ph = el.shape?.placeholder;
    if (!ph) continue;

    const targetText = ph.type === 'TITLE' || ph.type === 'CENTERED_TITLE' ? opts.title : opts.body;
    if (!targetText) continue;

    // Clear existing text
    const textElements = el.shape?.text?.textElements || [];
    const existingText = textElements.map((te) => te.textRun?.content || '').join('');
    if (existingText.trim()) {
      requests.push({
        deleteText: {
          objectId: el.objectId,
          textRange: { type: 'ALL' },
        },
      });
    }

    requests.push({
      insertText: { objectId: el.objectId, text: targetText },
    });
  }

  if (requests.length === 0) {
    console.error('Error: No title/body placeholders found on this slide. Provide --title and/or --body.');
    process.exit(1);
  }

  await slides.presentations.batchUpdate({
    presentationId,
    requestBody: { requests },
  });

  console.log(JSON.stringify({
    success: true,
    presentationId,
    slideId: slide.objectId,
  }, null, 2));
}

async function renameFile(opts) {
  loadAuth();
  const drive = google.drive({ version: 'v3' });

  if (!opts['file-id']) {
    console.error('Error: --file-id is required');
    process.exit(1);
  }
  if (!opts.name) {
    console.error('Error: --name is required');
    process.exit(1);
  }

  await drive.files.update({
    fileId: opts['file-id'],
    requestBody: { name: opts.name },
  });

  console.log(JSON.stringify({
    success: true,
    fileId: opts['file-id'],
    newName: opts.name,
  }, null, 2));
}

async function copyFile(opts) {
  loadAuth();
  const drive = google.drive({ version: 'v3' });

  if (!opts['file-id']) {
    console.error('Error: --file-id is required');
    process.exit(1);
  }

  const res = await drive.files.copy({
    fileId: opts['file-id'],
    requestBody: {
      name: opts.name || undefined,
    },
  });

  // Make copy accessible via link
  await drive.permissions.create({
    fileId: res.data.id,
    requestBody: { role: 'reader', type: 'anyone' },
  });

  console.log(JSON.stringify({
    success: true,
    originalFileId: opts['file-id'],
    copyFileId: res.data.id,
    name: res.data.name,
  }, null, 2));
}

async function deleteFile(opts) {
  loadAuth();
  const drive = google.drive({ version: 'v3' });

  if (!opts['file-id']) {
    console.error('Error: --file-id is required');
    process.exit(1);
  }

  await drive.files.delete({ fileId: opts['file-id'] });

  console.log(JSON.stringify({
    success: true,
    fileId: opts['file-id'],
    deleted: true,
  }, null, 2));
}

async function exportPdf(opts) {
  loadAuth();
  const drive = google.drive({ version: 'v3' });

  if (!opts['file-id']) {
    console.error('Error: --file-id is required');
    process.exit(1);
  }

  const res = await drive.files.export({
    fileId: opts['file-id'],
    mimeType: 'application/pdf',
  }, { responseType: 'arraybuffer' });

  const outPath = opts.output || `/tmp/${opts['file-id']}.pdf`;
  fs.writeFileSync(outPath, Buffer.from(res.data));

  console.log(JSON.stringify({
    success: true,
    fileId: opts['file-id'],
    pdfPath: outPath,
    sizeBytes: Buffer.from(res.data).length,
  }, null, 2));
}

async function getFileInfo(opts) {
  loadAuth();
  const drive = google.drive({ version: 'v3' });

  if (!opts['file-id']) {
    console.error('Error: --file-id is required');
    process.exit(1);
  }

  const res = await drive.files.get({
    fileId: opts['file-id'],
    fields: 'id, name, mimeType, webViewLink, createdTime, modifiedTime, size, owners, permissions',
  });

  const f = res.data;
  console.log(JSON.stringify({
    success: true,
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    url: f.webViewLink,
    created: f.createdTime,
    modified: f.modifiedTime,
    owners: f.owners?.map((o) => ({ name: o.displayName, email: o.emailAddress })),
    permissions: f.permissions?.map((p) => ({ role: p.role, type: p.type, email: p.emailAddress })),
  }, null, 2));
}

async function shareFile(opts) {
  loadAuth();
  const drive = google.drive({ version: 'v3' });

  if (!opts['file-id']) {
    console.error('Error: --file-id is required');
    process.exit(1);
  }
  if (!opts.email) {
    console.error('Error: --email is required');
    process.exit(1);
  }

  const role = opts.role || 'writer';

  await drive.permissions.create({
    fileId: opts['file-id'],
    sendNotificationEmail: true,
    requestBody: {
      role,
      type: 'user',
      emailAddress: opts.email,
    },
  });

  console.log(JSON.stringify({
    success: true,
    fileId: opts['file-id'],
    sharedWith: opts.email,
    role,
  }, null, 2));
}

async function transferOwnership(opts) {
  loadAuth();
  const drive = google.drive({ version: 'v3' });

  if (!opts['file-id']) {
    console.error('Error: --file-id is required');
    process.exit(1);
  }
  if (!opts.email) {
    console.error('Error: --email is required (new owner\'s email)');
    process.exit(1);
  }

  try {
    await drive.permissions.create({
      fileId: opts['file-id'],
      transferOwnership: true,
      sendNotificationEmail: true,
      requestBody: {
        role: 'owner',
        type: 'user',
        emailAddress: opts.email,
      },
    });

    console.log(JSON.stringify({
      success: true,
      fileId: opts['file-id'],
      newOwner: opts.email,
    }, null, 2));
  } catch (err) {
    const detail = err.response?.data?.error?.message || err.message;
    if (detail.includes('ownership can only be transferred to') || detail.includes('same domain')) {
      console.error(JSON.stringify({
        success: false,
        error: 'Ownership transfer failed: both accounts must be in the same Google Workspace domain. Consumer Gmail accounts cannot receive ownership transfers.',
        details: detail,
      }, null, 2));
    } else {
      console.error(JSON.stringify({
        success: false,
        error: detail,
        details: err.response?.data?.error?.message || null,
      }, null, 2));
    }
    process.exit(1);
  }
}

async function createSlides(opts) {
  loadAuth();
  const slides = google.slides({ version: 'v1' });
  const drive = google.drive({ version: 'v3' });

  const title = opts.title || 'Untitled Presentation';

  const res = await slides.presentations.create({
    requestBody: { title },
  });

  const presentationId = res.data.presentationId;

  if (opts.slides) {
    const slideData = JSON.parse(opts.slides);
    const requests = [];

    for (let i = 0; i < slideData.length; i++) {
      const slide = slideData[i];
      const slideId = `slide_${i}`;
      const titleId = `title_${i}`;
      const bodyId = `body_${i}`;

      // Create a new slide with a title and body layout
      requests.push({
        createSlide: {
          objectId: slideId,
          insertionIndex: i + 1, // after the default title slide
          slideLayoutReference: { predefinedLayout: 'TITLE_AND_BODY' },
          placeholderIdMappings: [
            { layoutPlaceholder: { type: 'TITLE', index: 0 }, objectId: titleId },
            { layoutPlaceholder: { type: 'BODY', index: 0 }, objectId: bodyId },
          ],
        },
      });

      if (slide.title) {
        requests.push({
          insertText: { objectId: titleId, text: slide.title },
        });
      }
      if (slide.body) {
        requests.push({
          insertText: { objectId: bodyId, text: slide.body },
        });
      }
    }

    if (requests.length > 0) {
      await slides.presentations.batchUpdate({
        presentationId,
        requestBody: { requests },
      });
    }
  }

  // Make it accessible via link
  await drive.permissions.create({
    fileId: presentationId,
    requestBody: { role: 'reader', type: 'anyone' },
  });

  const url = `https://docs.google.com/presentation/d/${presentationId}/edit`;
  console.log(JSON.stringify({ success: true, presentationId, url, title }, null, 2));
}

async function addSlide(opts) {
  loadAuth();
  const slides = google.slides({ version: 'v1' });

  if (!opts['presentation-id']) {
    console.error('Error: --presentation-id is required');
    process.exit(1);
  }

  const presentationId = opts['presentation-id'];

  // Get current slide count for insertion index
  const pres = await slides.presentations.get({ presentationId });
  const slideCount = pres.data.slides?.length || 0;

  const slideId = `slide_${Date.now()}`;
  const titleId = `title_${Date.now()}`;
  const bodyId = `body_${Date.now()}`;

  const requests = [
    {
      createSlide: {
        objectId: slideId,
        insertionIndex: slideCount,
        slideLayoutReference: { predefinedLayout: 'TITLE_AND_BODY' },
        placeholderIdMappings: [
          { layoutPlaceholder: { type: 'TITLE', index: 0 }, objectId: titleId },
          { layoutPlaceholder: { type: 'BODY', index: 0 }, objectId: bodyId },
        ],
      },
    },
  ];

  if (opts.title) {
    requests.push({ insertText: { objectId: titleId, text: opts.title } });
  }
  if (opts.body) {
    requests.push({ insertText: { objectId: bodyId, text: opts.body } });
  }

  await slides.presentations.batchUpdate({
    presentationId,
    requestBody: { requests },
  });

  console.log(JSON.stringify({
    success: true,
    presentationId,
    slideId,
    slideIndex: slideCount,
  }, null, 2));
}

async function readSlides(opts) {
  loadAuth();
  const slides = google.slides({ version: 'v1' });

  if (!opts['presentation-id']) {
    console.error('Error: --presentation-id is required');
    process.exit(1);
  }

  const pres = await slides.presentations.get({
    presentationId: opts['presentation-id'],
  });

  const slidesSummary = (pres.data.slides || []).map((slide, i) => {
    const texts = [];
    for (const element of slide.pageElements || []) {
      if (element.shape?.text?.textElements) {
        for (const te of element.shape.text.textElements) {
          if (te.textRun?.content?.trim()) {
            texts.push(te.textRun.content.trim());
          }
        }
      }
    }
    return { slideIndex: i, objectId: slide.objectId, text: texts.join('\n') };
  });

  console.log(JSON.stringify({
    success: true,
    presentationId: opts['presentation-id'],
    title: pres.data.title,
    slideCount: slidesSummary.length,
    slides: slidesSummary,
  }, null, 2));
}

async function listFiles(opts) {
  loadAuth();
  const drive = google.drive({ version: 'v3' });

  let q = "mimeType='application/vnd.google-apps.document' or mimeType='application/vnd.google-apps.spreadsheet' or mimeType='application/vnd.google-apps.presentation'";
  if (opts.query) {
    q = `(${q}) and fullText contains '${opts.query.replace(/'/g, "\\'")}'`;
  }

  const res = await drive.files.list({
    q,
    fields: 'files(id, name, mimeType, webViewLink, createdTime, modifiedTime)',
    orderBy: 'modifiedTime desc',
    pageSize: 20,
  });

  const files = (res.data.files || []).map((f) => ({
    id: f.id,
    name: f.name,
    type: f.mimeType.includes('document') ? 'doc' : f.mimeType.includes('presentation') ? 'slides' : 'sheet',
    url: f.webViewLink,
    modified: f.modifiedTime,
  }));

  console.log(JSON.stringify({ success: true, files }, null, 2));
}

// --- Main ---
const [command, ...rest] = process.argv.slice(2);
const opts = parseArgs(rest);

const commands = {
  'create-doc': createDoc,
  'create-sheet': createSheet,
  'create-slides': createSlides,
  'edit-doc': editDoc,
  'edit-sheet': editSheet,
  'add-slide': addSlide,
  'update-slide': updateSlide,
  'delete-slide': deleteSlide,
  'append-rows': appendRows,
  'clear-range': clearRange,
  'add-sheet-tab': addSheetTab,
  'list-sheet-tabs': listSheetTabs,
  'insert-table': insertTable,
  'insert-image': insertImage,
  'read-doc': readDoc,
  'read-sheet': readSheet,
  'read-slides': readSlides,
  'share': shareFile,
  'transfer-ownership': transferOwnership,
  'rename': renameFile,
  'copy': copyFile,
  'delete': deleteFile,
  'export-pdf': exportPdf,
  'info': getFileInfo,
  'list': listFiles,
};

if (!command || !commands[command]) {
  console.error(`Usage: node google-workspace.mjs <command> [options]`);
  console.error(`Commands: ${Object.keys(commands).join(', ')}`);
  process.exit(1);
}

try {
  await commands[command](opts);
} catch (err) {
  console.error(JSON.stringify({
    success: false,
    error: err.message,
    details: err.response?.data?.error?.message || null,
  }, null, 2));
  process.exit(1);
}
