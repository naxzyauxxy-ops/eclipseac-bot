require("dotenv").config();
const express = require("express");
const crypto = require("crypto");

const app = express();
app.use(express.json());

const PORT = 3000;
const ADMIN_SECRET = process.env.ADMIN_SECRET;

if (!ADMIN_SECRET) {
  console.error("❌ ADMIN_SECRET not set in .env file.");
  process.exit(1);
}

// simple memory database (for now)
const licenses = [];

// middleware auth
app.use((req, res, next) => {
  if (req.headers["x-admin-secret"] !== ADMIN_SECRET) {
    return res.json({ error: "Unauthorized" });
  }
  next();
});

// create license
app.post("/api/create", (req, res) => {
  const key = crypto.randomBytes(16).toString("hex");

  const license = {
    key,
    owner: req.body.owner,
    expires_at: req.body.expires_at,
    notes: req.body.notes,
    active: true,
    server_ip: null,
  };

  licenses.push(license);
  res.json({ key });
});

// revoke license
app.post("/api/revoke", (req, res) => {
  const lic = licenses.find(l => l.key === req.body.key);
  if (!lic) return res.json({ error: "Not found" });

  lic.active = false;
  res.json({ success: true });
});

// list all licenses
app.get("/api/list", (req, res) => {
  res.json(licenses);
});

// lookup by owner
app.get("/api/lookup", (req, res) => {
  const rows = licenses.filter(l => l.owner === req.query.owner);
  res.json(rows);
});

app.listen(PORT, () => {
  console.log(`✅ License server running on port ${PORT}`);
});
