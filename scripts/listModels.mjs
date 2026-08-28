/**
 * Lists all Granite foundation models available in your watsonx account.
 * Run with: node scripts/listModels.mjs
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// Read .env.local manually (no dotenv dependency needed)
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "../.env.local");
const envLines = readFileSync(envPath, "utf-8").split("\n");
const env = {};
for (const line of envLines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq === -1) continue;
  env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1).trim();
}

const apiKey = env["WATSONX_API_KEY"];
const watsonxUrl = env["WATSONX_URL"] ?? "https://us-south.ml.cloud.ibm.com";

if (!apiKey) {
  console.error("WATSONX_API_KEY is not set in .env.local");
  process.exit(1);
}

// Step 1: Get IAM token
console.log("Fetching IAM token...");
const iamResp = await fetch("https://iam.cloud.ibm.com/identity/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "urn:ibm:params:oauth:grant-type:apikey",
    apikey: apiKey,
  }),
});

if (!iamResp.ok) {
  const body = await iamResp.text();
  console.error(`IAM token failed: HTTP ${iamResp.status}\n${body}`);
  process.exit(1);
}

const { access_token } = await iamResp.json();
console.log("IAM token acquired.\n");

// Step 2: List foundation model specs
const modelsResp = await fetch(
  `${watsonxUrl}/ml/v1/foundation_model_specs?version=2023-05-29&limit=200`,
  { headers: { Authorization: `Bearer ${access_token}` } }
);

if (!modelsResp.ok) {
  const body = await modelsResp.text();
  console.error(`Models endpoint failed: HTTP ${modelsResp.status}\n${body}`);
  process.exit(1);
}

const data = await modelsResp.json();
const graniteModels = data.resources
  ?.filter((m) => m.model_id?.toLowerCase().includes("granite"))
  .map((m) => m.model_id) ?? [];

console.log(`=== Granite models available in your account (${graniteModels.length}) ===`);
for (const id of graniteModels) {
  console.log(" ", id);
}

if (graniteModels.length === 0) {
  console.log("No Granite models found. Your account may need to enable them.");
  console.log("All available model IDs:");
  for (const m of data.resources ?? []) {
    console.log(" ", m.model_id);
  }
}
