/**
 * Run this ONCE to register slash commands with Discord:
 *   node deploy-commands.js
 */

require("dotenv").config();
const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const commands = [
  new SlashCommandBuilder()
    .setName("createlicense")
    .setDescription("Generate a new EclipseAC license key for a user")
    .addUserOption(o => o.setName("user").setDescription("Discord user to assign the key to").setRequired(true))
    .addStringOption(o => o.setName("expires").setDescription("Expiry date (ISO format, e.g. 2025-12-31). Leave empty = never."))
    .addStringOption(o => o.setName("notes").setDescription("Optional notes about this license")),

  new SlashCommandBuilder()
    .setName("revokelicense")
    .setDescription("Revoke an existing license key")
    .addStringOption(o => o.setName("key").setDescription("The license key to revoke").setRequired(true)),

  new SlashCommandBuilder()
    .setName("listlicenses")
    .setDescription("List all EclipseAC license keys"),

  new SlashCommandBuilder()
    .setName("lookup")
    .setDescription("Look up licenses assigned to a user")
    .addUserOption(o => o.setName("user").setDescription("Discord user to look up").setRequired(true)),

  new SlashCommandBuilder()
    .setName("mylicense")
    .setDescription("Check your own EclipseAC license key"),
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.BOT_TOKEN);

(async () => {
  console.log("Registering slash commands...");
  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: commands }
  );
  console.log("Done! Commands registered.");
})();
