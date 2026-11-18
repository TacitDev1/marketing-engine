// One-time Google login for the read-only GA4 + Search Console connectors.
//
// Why this exists: Google's UI currently rejects newly-created service accounts
// ("email not found" bug, since Apr 2026), so we authenticate as you (admin on
// the property) via OAuth instead. Scopes are read-only — this app can never
// change anything in your Google properties, and it never posts anywhere.
//
// Run once:   node server/google-auth.js
// It prints a URL, you approve in the browser with your @larkwell.example account,
// and it saves a refresh token to .secrets/oauth-token.json. After that the app
// just works — re-run this only if you revoke access or change scopes.

import fs from "node:fs";
import http from "node:http";
import { google } from "googleapis";
import { OAUTH_CLIENT_PATH, OAUTH_TOKEN_PATH, SCOPES } from "./tools/google.js";

const PORT = Number(process.env.OAUTH_CALLBACK_PORT || 5191);
const REDIRECT = `http://127.0.0.1:${PORT}`;

function loadClient() {
  const path = OAUTH_CLIENT_PATH();
  if (!fs.existsSync(path)) {
    console.error(
      `\n[google-auth] No OAuth client file found at:\n  ${path}\n\n` +
        "Create one in Google Cloud Console (project marketing-engine):\n" +
        "  APIs & Services > Credentials > Create credentials >\n" +
        "  OAuth client ID > Application type: Desktop app > Download JSON.\n" +
        `Then save it to that path and re-run this script.\n`
    );
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(path, "utf8"));
  const c = raw.installed || raw.web || raw;
  return new google.auth.OAuth2(c.client_id, c.client_secret, REDIRECT);
}

async function main() {
  const oauth2 = loadClient();
  const authUrl = oauth2.generateAuthUrl({
    access_type: "offline", // gives us a refresh token
    prompt: "consent", // force a refresh token even on re-auth
    scope: SCOPES,
  });

  console.log(
    "\n=== Marketing Engine — connect Google (read-only) ===\n\n" +
      "1. Open this URL in your browser and approve with your @larkwell.example account:\n\n" +
      `   ${authUrl}\n\n` +
      "2. After you approve, this window will save the token and exit.\n" +
      `   (Listening on ${REDIRECT} for the redirect.)\n`
  );

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, REDIRECT);
      const code = url.searchParams.get("code");
      const err = url.searchParams.get("error");
      if (err) {
        res.end(`Authorization failed: ${err}. You can close this tab.`);
        console.error(`\n[google-auth] Authorization failed: ${err}`);
        server.close();
        process.exit(1);
      }
      if (!code) {
        res.end("Waiting for Google authorization...");
        return;
      }
      const { tokens } = await oauth2.getToken(code);
      // Persist the whole token object (includes refresh_token for offline use).
      fs.writeFileSync(OAUTH_TOKEN_PATH(), JSON.stringify(tokens, null, 2));
      fs.chmodSync(OAUTH_TOKEN_PATH(), 0o600);
      res.end(
        "Marketing Engine is now connected to Google (read-only). " +
          "You can close this tab and return to the app."
      );
      console.log(
        `\n[google-auth] Success. Token saved to:\n  ${OAUTH_TOKEN_PATH()}\n` +
          "Restart the app (or it'll pick this up on next request). Done.\n"
      );
      server.close();
      process.exit(0);
    } catch (e) {
      res.end(`Error: ${e.message}. You can close this tab.`);
      console.error(`\n[google-auth] ${e.stack || e.message}`);
      server.close();
      process.exit(1);
    }
  });

  server.listen(PORT);
}

main();
