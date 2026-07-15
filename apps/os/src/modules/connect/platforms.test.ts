import { describe, expect, it } from "vitest";
import { buildTokenSnippets, cursorInstallDeeplink, platforms, vscodeInstallDeeplink } from "./platforms";

const mcpUrl = "https://company.example/api/mcp";
const token = "cos_test_token";

describe("connect platforms", () => {
  it("builds the documented Cursor and VS Code install links exactly", () => {
    expect(cursorInstallDeeplink(mcpUrl)).toBe(
      "https://cursor.com/install-mcp?name=companyos&config=" + btoa(JSON.stringify({ url: mcpUrl }))
    );
    expect(vscodeInstallDeeplink(mcpUrl)).toBe(
      "vscode:mcp/install?" + encodeURIComponent(JSON.stringify({ name: "companyos", type: "http", url: mcpUrl }))
    );
  });

  it("keeps OAuth builders token-free and includes the URL in commands", () => {
    for (const platform of platforms) {
      expect(JSON.stringify(platform.oauth)).not.toContain(token);
      if (platform.oauth.command) expect(platform.oauth.command(mcpUrl)).toContain(mcpUrl);
      if (platform.oauth.deeplink) expect(platform.oauth.deeplink(mcpUrl)).not.toContain(token);
    }
  });

  it("includes the explicit worker token in every token-lane snippet", () => {
    const snippets = buildTokenSnippets(mcpUrl, token);
    for (const snippet of Object.values(snippets)) expect(snippet).toContain(token);
    for (const platform of platforms) expect(platform.token.snippet(mcpUrl, token)).toContain(token);
  });
});
