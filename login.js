require("dotenv").config();
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { Api } = require("telegram/tl");
const TelegramBot = require("node-telegram-bot-api");
const input = require("input");
const fs = require("fs");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Load API credentials from .env
const apiId = parseInt(process.env.API_ID, 10);
const apiHash = process.env.API_HASH;
const botToken = process.env.BOT_TOKEN;
const ownerChatId = process.env.OWNER_CHAT_ID;

const SESSION_FILE = "session.json";
let sessionData = fs.existsSync(SESSION_FILE) ? fs.readFileSync(SESSION_FILE, "utf8") : "";

const stringSession = new StringSession(sessionData);
const client = new TelegramClient(stringSession, apiId, apiHash, { connectionRetries: 5 });
const bot = new TelegramBot(botToken, { polling: true });

let groups = [];
let failedGroups = [];
let forwardedCount = 0;
let failedCount = 0;
let totalGroups = 0;
let processedGroups = 0;
let lastSavedMessage = null;
let isLoopRunning = false;
let accountName = "";

// Function to fetch groups and last saved message
async function fetchGroupsAndMessage() {
  console.log("\n🔍 Fetching all groups and last saved message...");
  groups = [];
  const dialogs = await client.getDialogs();
  
  for (const chat of dialogs) {
    if (chat.isGroup || chat.isSupergroup) {
      groups.push({ title: chat.title, id: chat.id });
    }
  }
  totalGroups = groups.length;
  console.log(`✅ Total Groups: ${totalGroups}`);

  // Fetch last saved message
  lastSavedMessage = await getLastSavedMessage();
  if (lastSavedMessage) {
    console.log("📩 Last saved message fetched!");
  } else {
    console.log("⚠️ No saved messages found!");
  }

  // Notify the user via bot
  await bot.sendMessage(
    ownerChatId, 
    `📌 Groups fetched successfully! **${totalGroups} groups found.**\n📩 **Last saved message fetched!**`
  );
}

// Function to get last saved message
async function getLastSavedMessage() {
  const messages = await client.getMessages("me", { limit: 1 });
  return messages.length > 0 ? messages[0] : null;
}

// Function to forward messages with sender name (Quoted Forward)
async function forwardMessages() {
  isLoopRunning = true;
  forwardedCount = 0;
  failedCount = 0;
  processedGroups = 0;

  if (!lastSavedMessage) {
    console.error("❌ No saved messages found. Cannot forward.");
    return;
  }

  console.log(`🚀 Started Forwarding Messages as: ${accountName}`);
  await bot.sendMessage(ownerChatId, `🚀 **Started Forwarding Messages as:** ${accountName}`);

  for (const group of groups) {
    processedGroups++; // Count every attempt (success or failure)
    try {
      await client.invoke(
        new Api.messages.ForwardMessages({
          fromPeer: "me",
          id: [lastSavedMessage.id],
          toPeer: group.id,
          withMyScore: true,
        })
      );

      forwardedCount++;
      console.log(`✅ Forwarded to ${group.title} (${processedGroups}/${totalGroups})`);

      // Wait between 270 - 360 seconds
      const waitTime = Math.floor(Math.random() * (360 - 270 + 1)) + 270;
      console.log(`⏳ Waiting for ${waitTime} seconds before next...`);
      await delay(waitTime * 1000);
    } catch (error) {
      failedCount++;
      console.error(`❌ Failed to forward to ${group.title} (${processedGroups}/${totalGroups})`);
      failedGroups.push(group);
      await bot.sendMessage(ownerChatId, `❌ Failed to forward to: \`${group.title}\``, { parse_mode: "Markdown" });
      continue;
    }
  }

  console.log("\n✅ Loop Completed! Waiting for user confirmation to start next loop...");
  
  // Notify user via bot
  await bot.sendMessage(
    ownerChatId,
    `✅ **Loop Completed!**\n\n` +
    `❌ Failed: ${failedCount}\n` +
    `✅ Successful: ${forwardedCount}\n` +
    `🔢 Total: ${processedGroups}/${totalGroups}`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [[{ text: "🔄 Start Next Loop", callback_data: "start_next_loop" }]],
      },
    }
  );

  isLoopRunning = false;
}

// Monitor Telegram bot commands
bot.onText(/\/q/, async (msg) => {
  if (msg.chat.id.toString() !== ownerChatId) return;
  await bot.sendMessage(
    ownerChatId, 
    `📊 **Forwarding Progress:**\n` +
    `✅ Success: ${forwardedCount}\n` +
    `❌ Failed: ${failedCount}\n` +
    `🔢 Total: ${processedGroups}/${totalGroups}`
  );
});

// Secure Logout
bot.onText(/\/logout/, async (msg) => {
  if (msg.chat.id.toString() !== ownerChatId) return;

  await bot.sendMessage(ownerChatId, "🔴 Logging out...");
  try {
    await client.invoke(new Api.auth.LogOut());
    if (fs.existsSync(SESSION_FILE)) {
      fs.unlinkSync(SESSION_FILE);
    }

    await bot.sendMessage(ownerChatId, "✅ Successfully logged out! Session expired.");
    process.exit();
  } catch (error) {
    await bot.sendMessage(ownerChatId, `❌ Logout failed: ${error.message}`);
  }
});

// Handle Inline Button Clicks
bot.on("callback_query", async (query) => {
  if (query.data === "start_next_loop") {
    await bot.sendMessage(ownerChatId, "⏳ Fetching groups and last saved message again...");
    await fetchGroupsAndMessage();

    // Wait 270 - 360 seconds before restarting
    const waitTime = Math.floor(Math.random() * (360 - 270 + 1)) + 270;
    console.log(`🕒 Waiting for ${waitTime} seconds before restarting next loop...`);
    await bot.sendMessage(ownerChatId, `🕒 Waiting for ${waitTime} seconds before restarting...`);
    await delay(waitTime * 1000);

    await forwardMessages();
  }
});

// Secure Login Function
async function start() {
  console.log("⚡ Telegram Login Script ⚡");

  await client.connect();

  if (client.session && client.session.save() !== "" && (await client.checkAuthorization())) {
    const me = await client.getMe();
    accountName = `${me.firstName} ${me.lastName || ""}`.trim();
    console.log(`✅ Logged in as: ${accountName}`);

    await bot.sendMessage(ownerChatId, `✅ **Script Started!**\n👤 Account: ${accountName}`);

    await fetchGroupsAndMessage();
    await forwardMessages();
  } else {
    console.log("🔐 Logging in...");

    try {
      const phoneNumber = await input.password("📱 Enter phone number with country code: ");
      console.log("📨 Sending OTP...");
      
      await client.start({
        phoneNumber: async () => phoneNumber,
        password: async () => await input.password("🔒 Enter 2FA password (if any): "),
        phoneCode: async () => await input.password("📥 Enter OTP code: "),
        onError: (err) => console.error("❌ Error:", err),
      });

      fs.writeFileSync(SESSION_FILE, client.session.save());
      console.clear();

      await fetchGroupsAndMessage();
      await forwardMessages();
    } catch (error) {
      console.error("❌ Login Failed:", error);
    }
  }
}

start();