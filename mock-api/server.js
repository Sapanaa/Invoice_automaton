/**
 * Invoice Tracking Mock API
 * ITClinical Take-Home Challenge
 *
 * Endpoints:
 *   POST /invoices          – Submit a new invoice
 *   GET  /invoices          – List all invoices
 *   GET  /invoices/:id      – Get a single invoice
 *   GET  /health            – Health check
 */

const express = require("express");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || "dev-key";
const DATA_FILE = path.join("/app/data", "invoices.json");

// ── Persistence helpers ──────────────────────────────────────
function loadInvoices() {
  if (!fs.existsSync(DATA_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveInvoices(invoices) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(invoices, null, 2));
}

// ── API key middleware ───────────────────────────────────────
function requireApiKey(req, res, next) {
  const key = req.headers["x-api-key"];
  if (!key || key !== API_KEY) {
    return res.status(401).json({ error: "Unauthorized – invalid or missing X-Api-Key header" });
  }
  next();
}

// ── Validation ───────────────────────────────────────────────
const REQUIRED_FIELDS = ["supplier", "invoice_number", "invoice_date", "amount", "currency"];

function validateInvoice(body) {
  const errors = [];
  for (const field of REQUIRED_FIELDS) {
    if (body[field] === undefined || body[field] === null || body[field] === "") {
      errors.push(`Missing required field: ${field}`);
    }
  }
  // Amount must be a positive number
  if (body.amount !== undefined && (isNaN(Number(body.amount)) || Number(body.amount) <= 0)) {
    errors.push("Field 'amount' must be a positive number");
  }
  // Currency must be 3-letter ISO code
  if (body.currency && !/^[A-Z]{3}$/.test(String(body.currency).toUpperCase())) {
    errors.push("Field 'currency' must be a 3-letter ISO 4217 code (e.g. EUR, USD)");
  }
  return errors;
}

// ── Routes ───────────────────────────────────────────────────

// Health check (no auth required)
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// POST /invoices – submit a new invoice
app.post("/invoices", requireApiKey, (req, res) => {
  const errors = validateInvoice(req.body);
  if (errors.length > 0) {
    return res.status(422).json({ error: "Validation failed", details: errors });
  }

  const invoices = loadInvoices();

  // Duplicate check by invoice_number + supplier
  const duplicate = invoices.find(
    (inv) =>
      inv.invoice_number === String(req.body.invoice_number) &&
      inv.supplier === String(req.body.supplier)
  );
  if (duplicate) {
    return res.status(409).json({
      error: "Duplicate invoice",
      message: `Invoice ${req.body.invoice_number} from ${req.body.supplier} already exists`,
      existing_id: duplicate.id,
    });
  }

  const newInvoice = {
    id: uuidv4(),
    supplier: String(req.body.supplier),
    invoice_number: String(req.body.invoice_number),
    invoice_date: String(req.body.invoice_date),
    amount: Number(req.body.amount),
    currency: String(req.body.currency).toUpperCase(),
    source_file: req.body.source_file || null,
    received_at: new Date().toISOString(),
  };

  invoices.push(newInvoice);
  saveInvoices(invoices);

  console.log(`[${new Date().toISOString()}] Invoice accepted: ${newInvoice.id} – ${newInvoice.invoice_number}`);
  return res.status(201).json({ success: true, invoice: newInvoice });
});

// GET /invoices – list all invoices
app.get("/invoices", requireApiKey, (_req, res) => {
  const invoices = loadInvoices();
  res.json({ count: invoices.length, invoices });
});

// GET /invoices/:id – get one invoice
app.get("/invoices/:id", requireApiKey, (req, res) => {
  const invoices = loadInvoices();
  const inv = invoices.find((i) => i.id === req.params.id);
  if (!inv) return res.status(404).json({ error: "Invoice not found" });
  res.json(inv);
});

// ── Start ────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Invoice Mock API listening on port ${PORT}`);
  console.log(`Health: http://localhost:${PORT}/health`);
});
