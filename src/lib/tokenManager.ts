/**
 * IBM Cloud IAM token manager for watsonx API calls.
 *
 * IAM tokens expire after ~3600 seconds. This module caches the token in memory
 * and proactively refreshes it 60 seconds before expiry so callers never
 * receive an expired token mid-request — which would produce a silent 401
 * failure that is very hard to debug mid-demo.
 *
 * Usage:
 *   import { getIAMToken } from "@/lib/tokenManager";
 *   const token = await getIAMToken(); // safe to call on every request
 */

const IAM_TOKEN_URL = "https://iam.cloud.ibm.com/identity/token";

// ─── Module-level cache ───────────────────────────────────────────────────────

let cachedToken: string | null = null;
/** Timestamp (ms) after which the cached token should be considered expired */
let tokenExpiresAt: number = 0;

// ─── Types ────────────────────────────────────────────────────────────────────

interface IAMTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number; // seconds
  expiration: number; // unix timestamp
}

// ─── Token fetch ──────────────────────────────────────────────────────────────

async function fetchFreshToken(apiKey: string): Promise<string> {
  console.log("[tokenManager] Requesting fresh IAM token from IBM Cloud…");
  const response = await fetch(IAM_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ibm:params:oauth:grant-type:apikey",
      apikey: apiKey,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "(no body)");
    console.error(
      `[tokenManager] IAM token request FAILED — HTTP ${response.status}.`,
      `\nResponse body: ${body}`
    );
    throw new Error(
      `IAM token request failed with HTTP ${response.status}. ` +
        `Check that WATSONX_API_KEY is valid.\nResponse: ${body}`
    );
  }

  const data = (await response.json()) as IAMTokenResponse;

  if (!data.access_token) {
    console.error("[tokenManager] IAM response did not include access_token. Raw response shape:", Object.keys(data));
    throw new Error(
      "IAM token response did not include an access_token. " +
        "Unexpected response shape from IBM Cloud IAM."
    );
  }

  // Cache expires 60 seconds before the actual expiry to give a safe margin
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;

  const expiresInMin = Math.round((data.expires_in - 60) / 60);
  console.log(`[tokenManager] IAM token acquired successfully. Cached for ~${expiresInMin} minutes.`);

  return data.access_token;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Returns a valid IBM Cloud IAM access token for watsonx API calls.
 *
 * - On first call: fetches a fresh token from IBM Cloud IAM and caches it.
 * - On subsequent calls: returns the cached token if it has not expired
 *   (with a 60-second safety margin).
 * - When the cached token is about to expire: fetches a new one transparently.
 *
 * This ensures the token is always valid for the duration of a watsonx call,
 * even during long demo sessions.
 */
export async function getIAMToken(): Promise<string> {
  const apiKey = process.env.WATSONX_API_KEY;
  if (!apiKey) {
    throw new Error(
      "WATSONX_API_KEY is not set. Add it to .env.local. " +
        "Generate an API key at https://cloud.ibm.com/iam/apikeys"
    );
  }

  // Return cached token if still valid
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  // Fetch and cache a new token
  return fetchFreshToken(apiKey);
}

/**
 * Resets the token cache. Used in testing to force a fresh fetch.
 * Not needed in production code.
 */
export function _resetTokenCache(): void {
  cachedToken = null;
  tokenExpiresAt = 0;
}
