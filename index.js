require("dotenv").config();
const express  = require("express");
const crypto   = require("crypto");
const Database = require("better-sqlite3");
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
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID;
const BOT_TOKEN     = process.env.BOT_TOKEN;
const CLIENT_ID     = process.env.CLIENT_ID;
const GUILD_ID      = process.env.GUILD_ID;
const SECRET        = process.env.LICENSE_SECRET || "EclipseAC-Private-Secret-2025-ChangeMe";

// ── Database (tracks issued + revoked keys) ───────────────────────────────────
const db = new Database("licenses.db");
db.exec(`
  CREATE TABLE IF NOT EXISTS licenses (
    key        TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL,
    owner_name TEXT NOT NULL,
    notes      TEXT DEFAULT '',
    revoked    INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

// ── Key Generation ────────────────────────────────────────────────────────────
function generateKey() {
  const id = [
    crypto.randomBytes(2).toString("hex").toUpperCase(),
    crypto.randomBytes(2).toString("hex").toUpperCase(),
    crypto.randomBytes(2).toString("hex").toUpperCase(),
  ].join("-");

  const sig = crypto
    .createHmac("sha256", SECRET)
    .update(id)
    .digest("hex")
    .substring(0, 16)
    .toUpperCase();

  return `ECLIPSE-${id}-${sig}`;
}

// ── Web server (keep-alive + revocation check endpoint) ───────────────────────
const app = express();
app.use(express.json());

app.get("/", (req, res) => res.send("EclipseAC License Bot running."));

// Plugin can optionally call this to check if a key is revoked
app.get("/check/:key", (req, res) => {
  const row = db.prepare("SELECT revoked FROM licenses WHERE key = ?").get(req.params.key);
  if (!row) return res.json({ valid: true }); // HMAC valid, not in blacklist = fine
  res.json({ valid: row.revoked === 0 });
});

app.listen(process.env.PORT || 3000, () => console.log("Web server running."));

// ── Register Slash Commands ───────────────────────────────────────────────────
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName("createlicense")
      .setDescription("Generate a new license key for a user")
      .addUserOption(o => o.setName("user").setDescription("User to give the key to").setRequired(true))
      .addStringOption(o => o.setName("notes").setDescription("Optional notes")),

    new SlashCommandBuilder()
      .setName("revokelicense")
      .setDescription("Revoke a license key so it no longer works")
      .addStringOption(o => o.setName("key").setDescription("The key to revoke").setRequired(true)),

    new SlashCommandBuilder()
      .setName("listlicenses")
      .setDescription("List all issued license keys"),

    new SlashCommandBuilder()
      .setName("lookup")
      .setDescription("Look up licenses for a user")
      .addUserOption(o => o.setName("user").setDescription("User to look up").setRequired(true)),

    new SlashCommandBuilder()
      .setName("genkey")
      .setDescription("Generate a key without assigning it to a user"),
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

client.once("clientReady", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await registerCommands();
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  await interaction.deferReply({ flags: 64 });

  const { commandName } = interaction;

  // /createlicense
  if (commandName === "createlicense") {
    if (!isAdmin(interaction)) return interaction.editReply("❌ No permission.");

    const user  = interaction.options.getUser("user");
    const notes = interaction.options.getString("notes") || "";
    const key   = generateKey();

    db.prepare("INSERT INTO licenses (key, owner_id, owner_name, notes) VALUES (?, ?, ?, ?)")
      .run(key, user.id, user.tag, notes);

    try {
      await user.send(
        `🔑 **Your EclipseAC License Key**\n\`\`\`${key}\`\`\`\n` +
        `Add this to your \`config.yml\` under \`license.key\`.\n` +
        (notes ? `📝 Notes: ${notes}` : "")
      );
    } catch {}

    const embed = new EmbedBuilder()
      .setColor(0x7289da)
      .setTitle("✅ License Created")
      .addFields(
        { name: "User",  value: `<@${user.id}>`, inline: true },
        { name: "Key",   value: `\`${key}\``,     inline: false },
        { name: "Notes", value: notes || "—",      inline: true }
      )
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  }

  // /revokelicense
  if (commandName === "revokelicense") {
    if (!isAdmin(interaction)) return interaction.editReply("❌ No permission.");

    const key = interaction.options.getString("key");
    const row = db.prepare("SELECT * FROM licenses WHERE key = ?").get(key);

    if (!row) {
      // Key not in DB — add it as revoked so it gets blacklisted
      db.prepare("INSERT OR IGNORE INTO licenses (key, owner_id, owner_name, notes, revoked) VALUES (?, ?, ?, ?, 1)")
        .run(key, "unknown", "unknown", "manually revoked");
    } else if (row.revoked) {
      return interaction.editReply(`⚠️ Key \`${key}\` is already revoked.`);
    } else {
      db.prepare("UPDATE licenses SET revoked = 1 WHERE key = ?").run(key);
    }

    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle("🚫 License Revoked")
      .addFields(
        { name: "Key",   value: `\`${key}\``,               inline: false },
        { name: "Owner", value: row ? `<@${row.owner_id}>` : "Unknown", inline: true }
      )
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  }

  // /listlicenses
  if (commandName === "listlicenses") {
    if (!isAdmin(interaction)) return interaction.editReply("❌ No permission.");

    const rows = db.prepare("SELECT * FROM licenses ORDER BY created_at DESC LIMIT 20").all();
    if (!rows.length) return interaction.editReply("No licenses found.");

    const lines = rows.map(r =>
      `${r.revoked ? "🚫" : "✅"} \`${r.key}\` — <@${r.owner_id}>${r.notes ? " — " + r.notes : ""}`
    );

    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle("📋 License Keys")
      .setDescription(lines.join("\n"))
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  }

  // /lookup
  if (commandName === "lookup") {
    if (!isAdmin(interaction)) return interaction.editReply("❌ No permission.");

    const user = interaction.options.getUser("user");
    const rows = db.prepare("SELECT * FROM licenses WHERE owner_id = ?").all(user.id);

    if (!rows.length) return interaction.editReply(`No licenses found for <@${user.id}>.`);

    const lines = rows.map(r =>
      `${r.revoked ? "🚫 Revoked" : "✅ Active"} \`${r.key}\`${r.notes ? " — " + r.notes : ""}`
    );

    return interaction.editReply(`**Licenses for <@${user.id}>:**\n` + lines.join("\n"));
  }

  // /genkey
  if (commandName === "genkey") {
    if (!isAdmin(interaction)) return interaction.editReply("❌ No permission.");
    const key = generateKey();
    db.prepare("INSERT INTO licenses (key, owner_id, owner_name, notes) VALUES (?, ?, ?, ?)")
      .run(key, interaction.user.id, interaction.user.tag, "generated manually");
    return interaction.editReply(`🔑 Generated key:\n\`\`\`${key}\`\`\``);
  }
});

client.login(BOT_TOKEN);
