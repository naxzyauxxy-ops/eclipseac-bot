require("dotenv").config();
const express = require("express");
const Database = require("better-sqlite3");
const crypto = require("crypto");
const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  REST,
  Routes,
} = require("discord.js");

// ── Config ────────────────────────────────────────────────────────────────────
const PORT         = process.env.PORT || 3000;
const ADMIN_SECRET = process.env.ADMIN_SECRET || "changeme";
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID;
const BOT_TOKEN    = process.env.BOT_TOKEN;
const CLIENT_ID    = process.env.CLIENT_ID;
const GUILD_ID     = process.env.GUILD_ID;

// ── Database ──────────────────────────────────────────────────────────────────
const db = new Database("licenses.db");
db.exec(`
  CREATE TABLE IF NOT EXISTS licenses (
    key        TEXT PRIMARY KEY,
    owner      TEXT NOT NULL,
    server_ip  TEXT DEFAULT '',
    active     INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT DEFAULT NULL,
    notes      TEXT DEFAULT ''
  )
`);

// ── License Server ────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

function requireAdmin(req, res, next) {
  if (req.headers["x-admin-secret"] !== ADMIN_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

app.post("/api/validate", (req, res) => {
  const { key, ip } = req.body;
  if (!key) return res.status(400).json({ valid: false, reason: "No key provided" });

  const row = db.prepare("SELECT * FROM licenses WHERE key = ?").get(key);
  if (!row) return res.json({ valid: false, reason: "Invalid license key" });
  if (row.active === 0) return res.json({ valid: false, reason: "License revoked" });
  if (row.expires_at && new Date() > new Date(row.expires_at)) {
    return res.json({ valid: false, reason: "License expired" });
  }

  db.prepare("UPDATE licenses SET server_ip = ? WHERE key = ?").run(ip || "", key);
  return res.json({ valid: true, owner: row.owner });
});

app.post("/api/create", requireAdmin, (req, res) => {
  const { owner, expires_at, notes } = req.body;
  if (!owner) return res.status(400).json({ error: "owner required" });

  const key = "ECLIPSE-"
    + crypto.randomBytes(2).toString("hex").toUpperCase() + "-"
    + crypto.randomBytes(2).toString("hex").toUpperCase() + "-"
    + crypto.randomBytes(2).toString("hex").toUpperCase();

  db.prepare("INSERT INTO licenses (key, owner, expires_at, notes) VALUES (?, ?, ?, ?)")
    .run(key, owner, expires_at || null, notes || "");

  return res.json({ key, owner, expires_at: expires_at || "never" });
});

app.post("/api/revoke", requireAdmin, (req, res) => {
  const { key } = req.body;
  if (!key) return res.status(400).json({ error: "key required" });
  const row = db.prepare("SELECT key FROM licenses WHERE key = ?").get(key);
  if (!row) return res.status(404).json({ error: "Key not found" });
  db.prepare("UPDATE licenses SET active = 0 WHERE key = ?").run(key);
  return res.json({ revoked: true, key });
});

app.get("/api/list", requireAdmin, (req, res) => {
  return res.json(db.prepare("SELECT * FROM licenses ORDER BY created_at DESC").all());
});

app.get("/api/lookup", requireAdmin, (req, res) => {
  return res.json(db.prepare("SELECT * FROM licenses WHERE owner = ?").all(req.query.owner || ""));
});

// Keep-alive endpoint so Replit doesn't spin down
app.get("/", (req, res) => res.send("EclipseAC License Server running."));

app.listen(PORT, () => {
  console.log(`License server running on port ${PORT}`);
});

// ── Register Slash Commands ───────────────────────────────────────────────────
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName("createlicense")
      .setDescription("Generate a new EclipseAC license key")
      .addUserOption(o => o.setName("user").setDescription("User to assign the key to").setRequired(true))
      .addStringOption(o => o.setName("expires").setDescription("Expiry date e.g. 2026-12-31 (leave blank = never)"))
      .addStringOption(o => o.setName("notes").setDescription("Optional notes")),

    new SlashCommandBuilder()
      .setName("revokelicense")
      .setDescription("Revoke a license key")
      .addStringOption(o => o.setName("key").setDescription("The key to revoke").setRequired(true)),

    new SlashCommandBuilder()
      .setName("listlicenses")
      .setDescription("List all license keys"),

    new SlashCommandBuilder()
      .setName("lookup")
      .setDescription("Look up licenses for a user")
      .addUserOption(o => o.setName("user").setDescription("User to look up").setRequired(true)),

    new SlashCommandBuilder()
      .setName("mylicense")
      .setDescription("Check your own license key"),
  ].map(c => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(BOT_TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log("Slash commands registered.");
}

// ── Discord Bot ───────────────────────────────────────────────────────────────
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

function isAdmin(interaction) {
  if (!ADMIN_ROLE_ID) return interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild);
  return interaction.member.roles.cache.has(ADMIN_ROLE_ID);
}

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await registerCommands();
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  await interaction.deferReply({ ephemeral: true });

  const { commandName } = interaction;

  if (commandName === "createlicense") {
    if (!isAdmin(interaction)) return interaction.editReply("❌ No permission.");

    const user    = interaction.options.getUser("user");
    const expires = interaction.options.getString("expires") || null;
    const notes   = interaction.options.getString("notes") || "";

    const key = "ECLIPSE-"
      + crypto.randomBytes(2).toString("hex").toUpperCase() + "-"
      + crypto.randomBytes(2).toString("hex").toUpperCase() + "-"
      + crypto.randomBytes(2).toString("hex").toUpperCase();

    db.prepare("INSERT INTO licenses (key, owner, expires_at, notes) VALUES (?, ?, ?, ?)")
      .run(key, user.id, expires || null, notes);

    try {
      await user.send(
        `🔑 **Your EclipseAC License Key**\n\`\`\`${key}\`\`\`\n` +
        `Paste this into your \`config.yml\` under \`license.key\`.\n` +
        (expires ? `⏰ Expires: **${expires}**` : `✅ Never expires`)
      );
    } catch {}

    const embed = new EmbedBuilder()
      .setColor(0x7289da)
      .setTitle("✅ License Created")
      .addFields(
        { name: "User",    value: `<@${user.id}>`,  inline: true },
        { name: "Key",     value: `\`${key}\``,      inline: false },
        { name: "Expires", value: expires || "Never", inline: true },
        { name: "Notes",   value: notes   || "—",     inline: true }
      )
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  }

  if (commandName === "revokelicense") {
    if (!isAdmin(interaction)) return interaction.editReply("❌ No permission.");
    const key = interaction.options.getString("key");
    const row = db.prepare("SELECT key FROM licenses WHERE key = ?").get(key);
    if (!row) return interaction.editReply("❌ Key not found.");
    db.prepare("UPDATE licenses SET active = 0 WHERE key = ?").run(key);
    return interaction.editReply(`✅ License \`${key}\` revoked.`);
  }

  if (commandName === "listlicenses") {
    if (!isAdmin(interaction)) return interaction.editReply("❌ No permission.");
    const rows = db.prepare("SELECT * FROM licenses ORDER BY created_at DESC").all();
    if (!rows.length) return interaction.editReply("No licenses found.");
    const lines = rows.slice(0, 20).map(r =>
      `${r.active ? "✅" : "❌"} \`${r.key}\` — <@${r.owner}> — ${r.expires_at || "never"} — IP: ${r.server_ip || "unused"}`
    );
    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle("📋 EclipseAC Licenses")
      .setDescription(lines.join("\n"))
      .setFooter({ text: `Showing ${Math.min(rows.length, 20)} of ${rows.length}` });
    return interaction.editReply({ embeds: [embed] });
  }

  if (commandName === "lookup") {
    if (!isAdmin(interaction)) return interaction.editReply("❌ No permission.");
    const user = interaction.options.getUser("user");
    const rows = db.prepare("SELECT * FROM licenses WHERE owner = ?").all(user.id);
    if (!rows.length) return interaction.editReply(`No licenses for <@${user.id}>.`);
    const lines = rows.map(r => `${r.active ? "✅" : "❌ Revoked"} \`${r.key}\` — expires: ${r.expires_at || "never"}`);
    return interaction.editReply(`**Licenses for <@${user.id}>:**\n` + lines.join("\n"));
  }

  if (commandName === "mylicense") {
    const rows = db.prepare("SELECT * FROM licenses WHERE owner = ? AND active = 1").all(interaction.user.id);
    if (!rows.length) return interaction.editReply("You don't have a license. Contact an admin.");
    const lines = rows.map(r => `\`${r.key}\` — expires: ${r.expires_at || "never"}`);
    return interaction.editReply(`🔑 **Your EclipseAC License(s):**\n` + lines.join("\n"));
  }
});

client.login(BOT_TOKEN);
