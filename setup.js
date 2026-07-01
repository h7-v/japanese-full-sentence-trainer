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
  const openaiKey = await ask("OpenAI API key: ");
  const modelAnswer = await ask("OpenAI model [gpt-5.4-mini] (press Enter for default setting): ");
  const portAnswer = await ask("Local port [5174] (press Enter for default setting): ");

  const lines = [
    `BUNPRO_API_TOKEN=${bunproToken}`,
    `OPENAI_API_KEY=${openaiKey}`,
    `OPENAI_MODEL=${modelAnswer || "gpt-5.4-mini"}`,
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
