// OAuth 2.1 support for remote MCP servers (MCP spec authorization flow):
// discovery + dynamic client registration + PKCE via the SDK, with all state
// persisted per-connector in SQLite. The browser handles the authorization
// redirect; /api/oauth/callback completes the code exchange.

import crypto from "crypto";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformation,
  OAuthClientInformationFull,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { getConnectorOAuth, getSetting, saveConnectorOAuth } from "./db";

/** Thrown when a remote server requires the user to authorize in a browser. */
export class AuthorizationRequiredError extends Error {
  constructor(public authUrl: string) {
    super("Authorization required");
    this.name = "AuthorizationRequiredError";
  }
}

export function oauthBaseUrl(): string {
  return getSetting("base_url") || "http://localhost:3000";
}

export interface LiberdeOAuthProvider extends OAuthClientProvider {
  pendingAuthUrl: string | undefined;
}

export function makeOAuthProvider(connectorId: string): LiberdeOAuthProvider {
  const redirectUrl = () => {
    const stored = getConnectorOAuth(connectorId).redirect_url as string | undefined;
    return stored ?? `${oauthBaseUrl()}/api/oauth/callback`;
  };

  const provider: LiberdeOAuthProvider = {
    pendingAuthUrl: undefined,

    get redirectUrl() {
      return redirectUrl();
    },

    get clientMetadata(): OAuthClientMetadata {
      return {
        client_name: "Liberde",
        redirect_uris: [redirectUrl()],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "client_secret_post",
      };
    },

    state(): string {
      const nonce = crypto.randomBytes(16).toString("base64url");
      // Pin the redirect URL at flow start so registration & exchange agree.
      saveConnectorOAuth(connectorId, {
        state_nonce: nonce,
        redirect_url: redirectUrl(),
      });
      return `${connectorId}.${nonce}`;
    },

    clientInformation(): OAuthClientInformation | undefined {
      return getConnectorOAuth(connectorId).client_information as
        | OAuthClientInformation
        | undefined;
    },

    saveClientInformation(info: OAuthClientInformationFull) {
      saveConnectorOAuth(connectorId, { client_information: info });
    },

    tokens(): OAuthTokens | undefined {
      return getConnectorOAuth(connectorId).tokens as OAuthTokens | undefined;
    },

    saveTokens(tokens: OAuthTokens) {
      saveConnectorOAuth(connectorId, { tokens });
    },

    redirectToAuthorization(url: URL) {
      provider.pendingAuthUrl = url.toString();
      saveConnectorOAuth(connectorId, { pending_auth_url: url.toString() });
    },

    saveCodeVerifier(verifier: string) {
      saveConnectorOAuth(connectorId, { code_verifier: verifier });
    },

    codeVerifier(): string {
      const v = getConnectorOAuth(connectorId).code_verifier as string | undefined;
      if (!v) throw new Error("No code verifier saved for this connector");
      return v;
    },

    invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier") {
      if (scope === "all") {
        saveConnectorOAuth(connectorId, {
          tokens: undefined,
          client_information: undefined,
          code_verifier: undefined,
        });
      } else if (scope === "tokens") {
        saveConnectorOAuth(connectorId, { tokens: undefined });
      } else if (scope === "client") {
        saveConnectorOAuth(connectorId, { client_information: undefined });
      } else {
        saveConnectorOAuth(connectorId, { code_verifier: undefined });
      }
    },
  };

  return provider;
}

export function parseOAuthState(
  state: string
): { connectorId: string; nonce: string } | null {
  const dot = state.lastIndexOf(".");
  if (dot === -1) return null;
  return { connectorId: state.slice(0, dot), nonce: state.slice(dot + 1) };
}
