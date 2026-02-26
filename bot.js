/**
 * EclipseAC License Bot
 * =====================
 * A Discord bot that lets you issue and revoke licenses via slash commands.
 *
 * Slash commands:
 *   /createlicense @user [expires] [notes]  — generate a license key for a user
 *   /revokelicense <key>                    — revoke a license key
 *   /listlicenses                           — list all licenses
 *   /lookup @user                           — look up licenses for a user
 *   /mylicense                              — users can check their own key
 *
 * Setup:
 *   1. npm install
 *   2. Copy .env.example to .env and fill it in
 *   3. node deploy-commands.js    (run once to register slash commands)
 *   4. node bot.js
 */

require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
} = require("discord.js");

const ADMIN_ROLE_ID    = process.env.ADMIN_ROLE_ID;    // Role allowed to manage licenses
const LICENSE_SERVER   = process.env.LICENSE_SERVER;   // e.g. http://localhost:3000
const ADMIN_SECRET     = process.env.ADMIN_SECRET;     // Must match server's ADMIN_SECRET

// ── Helper: call license server ───────────────────────────────────────────────
async function callLicenseServer(method, path, body = null) {
  const options = {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-admin-secret": ADMIN_SECRET,
    },
  };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(`${LICENSE_SERVER}${path}`, options);
  return res.json();
}

// ── Bot ───────────────────────────────────────────────────────────────────────
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// ── Check if user is admin ────────────────────────────────────────────────────
function isAdmin(interaction) {
  if (!ADMIN_ROLE_ID) {
    // Fallback: require MANAGE_GUILD permission
    return interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild);
  }
  return interaction.member.roles.cache.has(ADMIN_ROLE_ID);
}

// ── Slash command handler ─────────────────────────────────────────────────────
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  await interaction.deferReply({ ephemeral: true });

  const { commandName } = interaction;

  // ── /createlicense ──────────────────────────────────────────────────────────
  if (commandName === "createlicense") {
    if (!isAdmin(interaction)) {
      return interaction.editReply("❌ You don't have permission to do that.");
    }

    const user     = interaction.options.getUser("user");
    const expires  = interaction.options.getString("expires") || null;
    const notes    = interaction.options.getString("notes") || "";

    const data = await callLicenseServer("POST", "/api/create", {
      owner: user.id,
      expires_at: expires,
      notes,
    });

    if (data.error) {
      return interaction.editReply(`❌ Error: ${data.error}`);
    }

    // DM the key to the user
    try {
      await user.send(
        `🔑 **Your EclipseAC License Key**\n` +
        `\`\`\`${data.key}\`\`\`\n` +
        `Add this to your \`config.yml\` under \`license.key\`.\n` +
        (expires ? `⏰ Expires: **${expires}**` : `✅ Never expires`)
      );
    } catch {
      // DMs disabled — will show key in response only
    }

    const embed = new EmbedBuilder()
      .setColor(0x7289da)
      .setTitle("✅ License Created")
      .addFields(
        { name: "User", value: `<@${user.id}>`, inline: true },
        { name: "Key", value: `\`${data.key}\``, inline: false },
        { name: "Expires", value: expires || "Never", inline: true },
        { name: "Notes", value: notes || "—", inline: true }
      )
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  }

  // ── /revokelicense ──────────────────────────────────────────────────────────
  if (commandName === "revokelicense") {
    if (!isAdmin(interaction)) {
      return interaction.editReply("❌ You don't have permission to do that.");
    }

    const key = interaction.options.getString("key");
    const data = await callLicenseServer("POST", "/api/revoke", { key });

    if (data.error) {
      return interaction.editReply(`❌ ${data.error}`);
    }

    return interaction.editReply(`✅ License \`${key}\` has been revoked.`);
  }

  // ── /listlicenses ───────────────────────────────────────────────────────────
  if (commandName === "listlicenses") {
    if (!isAdmin(interaction)) {
      return interaction.editReply("❌ You don't have permission to do that.");
    }

    const rows = await callLicenseServer("GET", "/api/list");

    if (!rows.length) return interaction.editReply("No licenses found.");

    const lines = rows.slice(0, 20).map((r) => {
      const status = r.active ? "✅" : "❌";
      return `${status} \`${r.key}\` — <@${r.owner}> — ${r.expires_at || "never"} — IP: ${r.server_ip || "unused"}`;
    });

    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle("📋 EclipseAC Licenses")
      .setDescription(lines.join("\n"))
      .setFooter({ text: `Showing ${Math.min(rows.length, 20)} of ${rows.length}` });

    return interaction.editReply({ embeds: [embed] });
  }

  // ── /lookup ─────────────────────────────────────────────────────────────────
  if (commandName === "lookup") {
    if (!isAdmin(interaction)) {
      return interaction.editReply("❌ You don't have permission to do that.");
    }

    const user = interaction.options.getUser("user");
    const rows = await callLicenseServer("GET", `/api/lookup?owner=${user.id}`);

    if (!rows.length) return interaction.editReply(`No licenses found for <@${user.id}>.`);

    const lines = rows.map((r) => {
      const status = r.active ? "✅" : "❌ Revoked";
      return `${status} \`${r.key}\` — expires: ${r.expires_at || "never"}`;
    });

    return interaction.editReply({ content: `**Licenses for <@${user.id}>:**\n` + lines.join("\n") });
  }

  // ── /mylicense ──────────────────────────────────────────────────────────────
  if (commandName === "mylicense") {
    const rows = await callLicenseServer("GET", `/api/lookup?owner=${interaction.user.id}`);

    if (!rows.length) {
      return interaction.editReply("You don't have any licenses. Contact an admin to get one.");
    }

    const active = rows.filter((r) => r.active);
    if (!active.length) {
      return interaction.editReply("Your license(s) have been revoked. Contact an admin.");
    }

    const lines = active.map((r) => `\`${r.key}\` — expires: ${r.expires_at || "never"}`);
    return interaction.editReply(`🔑 **Your EclipseAC License(s):**\n` + lines.join("\n"));
  }
});

client.login(process.env.BOT_TOKEN);
