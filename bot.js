/**
 * EclipseAC License Bot (Fixed for Discord.js v15+)
 * ==================================================
 * Fully compatible with current Discord.js versions (v15+).
 */

require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  PermissionFlagsBits,
  EmbedBuilder,
} = require("discord.js");

const fetch = require("node-fetch"); // Ensure node-fetch is installed

const ADMIN_ROLE_ID  = process.env.ADMIN_ROLE_ID;
const LICENSE_SERVER = process.env.LICENSE_SERVER;
const ADMIN_SECRET   = process.env.ADMIN_SECRET;

if (!ADMIN_SECRET || !LICENSE_SERVER) {
  console.error("❌ ADMIN_SECRET or LICENSE_SERVER not set in .env file.");
  process.exit(1);
}

// Helper: call license server
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

// Bot
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.on("clientReady", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// Check admin
function isAdmin(interaction) {
  if (!ADMIN_ROLE_ID) {
    return interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild);
  }
  return interaction.member.roles.cache.has(ADMIN_ROLE_ID);
}

// Interaction handler
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  await interaction.deferReply({ ephemeral: true });

  const { commandName } = interaction;

  if (commandName === "createlicense") {
    if (!isAdmin(interaction)) return interaction.editReply("❌ You don't have permission.");

    const user = interaction.options.getUser("user");
    const expires = interaction.options.getString("expires") || null;
    const notes = interaction.options.getString("notes") || "";

    const data = await callLicenseServer("POST", "/api/create", {
      owner: user.id,
      expires_at: expires,
      notes,
    });

    if (data.error) return interaction.editReply(`❌ ${data.error}`);

    try { await user.send(`🔑 Your license key: \`${data.key}\`
Expires: ${expires || 'never'}`); } catch {}

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

  if (commandName === "revokelicense") {
    if (!isAdmin(interaction)) return interaction.editReply("❌ You don't have permission.");
    const key = interaction.options.getString("key");
    const data = await callLicenseServer("POST", "/api/revoke", { key });
    if (data.error) return interaction.editReply(`❌ ${data.error}`);
    return interaction.editReply(`✅ License \`${key}\` revoked.`);
  }

  if (commandName === "listlicenses") {
    if (!isAdmin(interaction)) return interaction.editReply("❌ No permission.");
    const rows = await callLicenseServer("GET", "/api/list");
    if (!rows.length) return interaction.editReply("No licenses found.");

    const lines = rows.slice(0, 20).map(r => `${r.active ? '✅' : '❌'} \`${r.key}\` — <@${r.owner}> — ${r.expires_at || 'never'} — IP: ${r.server_ip || 'unused'}`);
    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle("📋 EclipseAC Licenses")
      .setDescription(lines.join("\n"))
      .setFooter({ text: `Showing ${Math.min(rows.length,20)} of ${rows.length}` });

    return interaction.editReply({ embeds: [embed] });
  }

  if (commandName === "lookup") {
    if (!isAdmin(interaction)) return interaction.editReply("❌ No permission.");
    const user = interaction.options.getUser("user");
    const rows = await callLicenseServer("GET", `/api/lookup?owner=${user.id}`);
    if (!rows.length) return interaction.editReply(`No licenses for <@${user.id}>.`);
    const lines = rows.map(r => `${r.active ? '✅' : '❌ Revoked'} \`${r.key}\` — expires: ${r.expires_at || 'never'}`);
    return interaction.editReply(`**Licenses for <@${user.id}>:**\n` + lines.join("\n"));
  }

  if (commandName === "mylicense") {
    const rows = await callLicenseServer("GET", `/api/lookup?owner=${interaction.user.id}`);
    if (!rows.length) return interaction.editReply("You have no licenses.");
    const active = rows.filter(r => r.active);
    if (!active.length) return interaction.editReply("All your licenses have been revoked.");
    const lines = active.map(r => `\`${r.key}\` — expires: ${r.expires_at || 'never'}`);
    return interaction.editReply(`🔑 Your licenses:\n` + lines.join("\n"));
  }
});
