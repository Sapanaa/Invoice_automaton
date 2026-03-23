# ITClinical Invoice Processing Automation

An **n8n**-based workflow that monitors a Google Drive folder for invoice files (PDF and XML), extracts structured data using Gemini AI, saves it to Google Sheets and a REST API, and organises files into clearly-labelled outcome folders.

---

## Architecture Overview

```
Google Drive (Inbox folder)
        │  [every 1 minute]
        ▼
   n8n Workflow
   ┌─────────────────────────────────────────────────────┐
   │  List files → Download → Read file (PDF or XML)      │
   │       → Extract text → Gemini AI → Extract 5 fields  │
   │       → Save to Google Sheets → POST to Mock API     │
   │                                                       │
   │  On success: move to /Processed                       │
   │  On failure: move to /Failed                          │
   └─────────────────────────────────────────────────────┘
        │                          │
  /Processed folder          /Failed folder
```

---

## Prerequisites

- **Docker** ≥ 24.x and **Docker Compose** ≥ 2.x
- A **Google Cloud project** with the Google Drive API and Google Sheets API enabled
- A Google OAuth 2.0 **Client ID + Secret** (Web Application type)
- A free **Gemini API key** from https://aistudio.google.com
- Three Google Drive folders:
  - `Inbox` – where invoice files are dropped
  - `Processed` – successfully processed invoices
  - `Failed` – files that could not be processed
- One **Google Sheet** with these headers in row 1:
  `Supplier | Invoice Number | Invoice Date | Amount | Currency | Source File | Processed At`

---

## Setup Instructions

### 1 – Unzip the project

```bash
unzip invoice-automation.zip
cd invoice-automation
```

### 2 – Create your `.env` file

```bash
cp .env.example .env
```

Open `.env` and fill in every placeholder:

| Variable | Description |
|---|---|
| `N8N_PASSWORD` | Your n8n login password |
| `N8N_ENCRYPTION_KEY` | Random 32-character string (`openssl rand -hex 16`) |
| `API_KEY` | Shared secret between n8n and the mock API |

### 3 – Start the containers

```bash
docker compose up -d
```

This starts:
- **n8n** at `http://localhost:5678`
- **mock-api** at `http://localhost:3000`

Verify both are running:
```bash
docker compose ps
curl http://localhost:3000/health
```

### 4 – Configure Google credentials in n8n

1. Open `http://localhost:5678` and log in (username: `admin`, password: your N8N_PASSWORD)
2. Go to **Settings → Credentials → New Credential → Google Drive OAuth2 API**
3. Enter your `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
4. Set the OAuth redirect URI in Google Cloud Console to:
   `http://localhost:5678/rest/oauth2-credential/callback`
5. Click **Connect** and complete the OAuth flow
6. Repeat for **Google Sheets OAuth2 API**

### 5 – Import the workflow

1. In n8n go to **Workflows → Import from File**
2. Select `workflows/invoice_processing.json`

### 6 – Fill in placeholders

Open each node and replace the placeholders:

| Placeholder | Node | Replace with |
|---|---|---|
| `PLACEHOLDER_GEMINI_API_KEY` | Extract Invoice Fields (Gemini) | Your Gemini API key |
| `PLACEHOLDER_INBOX_FOLDER_ID` | Search files and folders | Your Inbox folder ID |
| `PLACEHOLDER_PROCESSED_FOLDER_ID` | Move to Processed | Your Processed folder ID |
| `PLACEHOLDER_FAILED_FOLDER_ID` | Move to Failed | Your Failed folder ID |
| `PLACEHOLDER_GOOGLE_SHEET_ID` | Save to Google Sheets | Your Google Sheet ID |
| `PLACEHOLDER_MOCK_API_KEY` | HTTP Request | Same value as API_KEY in .env |

**How to find a Google Drive folder ID:**
Open the folder in your browser. The URL looks like:
```
https://drive.google.com/drive/folders/1A2B3C4D5E6F
```
The ID is the string after `/folders/`.

**How to get a free Gemini API key:**
1. Go to https://aistudio.google.com
2. Click **Get API Key** → **Create API Key**
3. Copy and paste into the workflow node

### 7 – Activate the workflow

Toggle the workflow from **Inactive → Active** in n8n.

---

## How to Test

**Drop a valid invoice:**
1. Upload any invoice PDF to your Inbox folder
2. Wait 1 minute
3. Check Google Sheets — new row should appear
4. Check Google Drive — file moved to `/Processed`
5. Check mock API:
```bash
curl -H "X-Api-Key: your-api-key" http://localhost:3000/invoices
```

**Test error handling:**
1. Drop `order_reception_document.pdf` into Inbox
2. Wait 1 minute
3. File should move to `/Failed`
4. Nothing added to Google Sheets

---

## Mock API Reference

### Authentication

All endpoints except `/health` require:
```
X-Api-Key: your-api-key
```

### Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check — no auth needed |
| `POST` | `/invoices` | Submit a new invoice |
| `GET` | `/invoices` | List all invoices |
| `GET` | `/invoices/:id` | Get a single invoice |

### POST /invoices – Request body

```json
{
  "supplier":       "Northwind Industrial Parts",
  "invoice_number": "INV-2026-0001",
  "invoice_date":   "2026-01-14",
  "amount":         1834.72,
  "currency":       "EUR",
  "source_file":    "invoice_sample_1.pdf"
}
```

### Responses

**201 Created**
```json
{ "success": true, "invoice": { "id": "uuid", ... } }
```

**422 Validation failure**
```json
{ "error": "Must provide at least supplier or invoice_number" }
```

**409 Duplicate**
```json
{ "error": "Duplicate invoice", "existing_id": "uuid" }
```

**401 Unauthorized**
```json
{ "error": "Unauthorized – invalid or missing X-Api-Key header" }
```

---

## Workflow Design Decisions

### PDF and XML Extraction Strategy

The workflow handles both PDF and XML invoice files:

**PDF files:** n8n's built-in `Extract From File` node reads the text layer of the PDF and returns it as plain text.

**XML files:** The file binary is decoded as UTF-8 directly, giving the raw XML content as text.

Both formats are then sent to **Gemini AI (free tier)** with a prompt asking for the 5 required fields as a JSON object. Gemini handles any invoice layout — top-box, side-by-side columns, tables — without needing layout-specific rules.

A file is considered a valid invoice if Gemini can extract at least 3 of the 5 required fields. Files with fewer than 3 fields are silently routed to `/Failed`.

---

### Ensuring No File Is Left Unprocessed

The workflow runs on a **1-minute schedule** and lists all files in the Inbox folder on every run:

- New files are picked up within 1 minute of being uploaded
- Every file is always moved to either `/Processed` or `/Failed` — never left in Inbox
- If n8n was temporarily down, files are picked up on the next run
- The schedule-based approach also handles backfill — existing files in Inbox are processed immediately when the workflow is activated

---

### Ensuring Users Are Warned of Errors

- **Failed files are moved to `/Failed` folder** — visible at a glance in Google Drive
- Non-invoice files are silently routed to `/Failed` via an IF node check — no workflow crashes
- **n8n execution history** shows every run with full input/output at each node for debugging
- The `/Failed` folder itself acts as a visual alert — a non-empty Failed folder signals files needing attention

---

## Optional Enhancements Implemented

### 1 – Gemini AI Extraction
Instead of regex, Gemini AI reads the invoice text and extracts fields intelligently. This handles any invoice layout without needing format-specific rules and is more robust than pattern matching.

### 2 – XML Support
In addition to PDFs the workflow processes XML invoice files by reading them as plain text and sending to Gemini. This goes beyond the basic challenge requirements.

### 3 – Google Sheets Integration
Invoice data is saved to Google Sheets in addition to the mock REST API. This provides a human-readable, filterable view of all processed invoices that can be shared with the finance team.

### 4 – Graceful Failure Handling
Non-invoice files and extraction failures are handled silently — no workflow crashes. Everything routes cleanly to `/Failed` via IF node checks rather than error throws.

### 5 – Duplicate Invoice Detection
The mock API checks for duplicate `(supplier, invoice_number)` pairs before inserting. This prevents double-processing if a file is somehow triggered twice.

### 6 – Bulk Processing
The schedule-based approach processes all files in Inbox on every run, not just newly uploaded ones. This handles backfill scenarios and ensures no file is missed.

---

## Google Drive Folder Structure

```
My Drive/
├── Invoices/
│   ├── Inbox/       ← Drop invoice files here
│   ├── Processed/   ← Successfully processed invoices
│   └── Failed/      ← Files that could not be processed
```

---

## Stopping

```bash
docker compose down
```

Remove all saved data:
```bash
docker compose down -v
```