const fs = require("fs");
const path = require("path");
const readline = require("readline");

const envPath = path.join(__dirname, ".env");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function ask(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

async function main() {
  console.log("Bunpro Full Sentence Trainer setup");
  console.log("");
  console.log("This writes a local .env file. Do not share that file or commit it to GitHub.");
  console.log("");

  if (fs.existsSync(envPath)) {
    const overwrite = (await ask(".env already exists. Replace it? Type yes to replace: ")).toLowerCase();
    if (overwrite !== "yes") {
      console.log("Setup cancelled. Existing .env was left alone.");
      rl.close();
      return;
    }
  }

  const bunproToken = await ask("Bunpro API token: ");
  const llmBaseUrl = await ask("LLM base URL [https://generativelanguage.googleapis.com/v1beta/openai] (press Enter for default setting): ");
  const llmKey = await ask("LLM API key (paste your Gemini key; OpenAI/local providers also work): ");
  const modelAnswer = await ask("LLM model [gemini-3.5-flash] (press Enter for default setting): ");
  const portAnswer = await ask("Local port [5174] (press Enter for default setting): ");

  const lines = [
    `BUNPRO_API_TOKEN=${bunproToken}`,
    `LLM_BASE_URL=${llmBaseUrl || "https://generativelanguage.googleapis.com/v1beta/openai"}`,
    `LLM_API_KEY=${llmKey}`,
    `LLM_MODEL=${modelAnswer || "gemini-3.5-flash"}`,
    `PORT=${portAnswer || "5174"}`
  ];

  fs.writeFileSync(envPath, `${lines.join("\n")}\n`, { mode: 0o600 });
  console.log("");
  console.log("Wrote .env.");
  console.log("Start the app with:");
  console.log("  npm start");
  console.log("");
  console.log("Then open:");
  console.log(`  http://127.0.0.1:${portAnswer || "5174"}`);
  rl.close();
}

main().catch((error) => {
  rl.close();
  console.error(error);
  process.exitCode = 1;
});
