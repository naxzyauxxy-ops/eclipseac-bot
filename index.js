require("dotenv").config();
const express = require("express");
const crypto  = require("crypto");
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

// MUST match the SECRET in LicenseManager.java
const SECRET = process.env.LICENSE_SECRET || "EclipseAC-Private-Secret-2025-ChangeMe";

// ── Key Generation (HMAC-SHA256, no database needed) ─────────────────────────
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

// ── Keep-alive web server (stops Replit sleeping) ─────────────────────────────
const app = express();
app.get("/", (req, res) => res.send("EclipseAC Bot running."));
app.listen(process.env.PORT || 3000, () => console.log("Web server running."));

// ── Register Slash Commands ───────────────────────────────────────────────────
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName("createlicense")
      .setDescription("Generate a new EclipseAC license key")
      .addUserOption(o => o.setName("user").setDescription("User to give the key to").setRequired(true))
      .addStringOption(o => o.setName("notes").setDescription("Optional notes")),

    new SlashCommandBuilder()
      .setName("genkey")
      .setDescription("Generate a license key (shown only to you)"),
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

  if (commandName === "createlicense") {
    if (!isAdmin(interaction)) return interaction.editReply("❌ No permission.");

    const user  = interaction.options.getUser("user");
    const notes = interaction.options.getString("notes") || "";
    const key   = generateKey();

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

  if (commandName === "genkey") {
    if (!isAdmin(interaction)) return interaction.editReply("❌ No permission.");
    const key = generateKey();
    return interaction.editReply(`🔑 Generated key:\n\`\`\`${key}\`\`\``);
  }
});

client.login(BOT_TOKEN);
