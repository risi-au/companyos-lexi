export type PlatformId =
  | "claude-code"
  | "claude-desktop-web"
  | "cursor"
  | "vscode"
  | "codex"
  | "chatgpt"
  | "gemini-cli"
  | "hermes"
  | "other";

export interface PlatformSetup {
  steps: string[];
  deeplink?: (mcpUrl: string) => string;
  command?: (mcpUrl: string) => string;
  note?: string;
}

export interface Platform {
  id: PlatformId;
  label: string;
  /** Omitted for token-only clients (no OAuth support): the wizard goes straight to the worker-token lane. */
  oauth?: PlatformSetup;
  token: {
    steps: string[];
    snippet: (mcpUrl: string, token: string) => string;
  };
}

export function buildTokenSnippets(mcpUrl: string, token: string) {
  const authHeader = "Authorization: Bearer " + token;
  return {
    claude: "claude mcp add companyos " + mcpUrl + ' --transport http --header "' + authHeader + '"',
    mcpJson: JSON.stringify(
      {
        mcpServers: {
          companyos: {
            url: mcpUrl,
            transport: "http",
            headers: { Authorization: "Bearer " + token },
          },
        },
      },
      null,
      2
    ),
    codex:
      "[mcp_servers.companyos]\nurl = \"" +
      mcpUrl +
      "\"\ntransport = \"http\"\n\n[mcp_servers.companyos.headers]\nAuthorization = \"Bearer " +
      token +
      "\"",
    claudeDesktop: "Add a custom HTTP connector named companyos.\nURL: " + mcpUrl + "\nHeader: " + authHeader,
    chatgpt: "ChatGPT web: paste " + mcpUrl + " and the Authorization bearer header Bearer " + token + " into its connector UI.",
    hermes:
      "# ~/.hermes/config.yaml on the machine running Hermes\nmcp_servers:\n  companyos:\n    url: \"" +
      mcpUrl +
      "\"\n    headers:\n      Authorization: \"Bearer " +
      token +
      "\"",
    other:
      "MCP URL: " +
      mcpUrl +
      "\nHeader: " +
      authHeader +
      "\n\nStandard mcpServers JSON, if your client reads one:\n" +
      JSON.stringify(
        {
          mcpServers: {
            companyos: {
              url: mcpUrl,
              transport: "http",
              headers: { Authorization: "Bearer " + token },
            },
          },
        },
        null,
        2
      ),
  };
}

export function cursorInstallDeeplink(mcpUrl: string): string {
  return "https://cursor.com/install-mcp?name=companyos&config=" + btoa(JSON.stringify({ url: mcpUrl }));
}

export function vscodeInstallDeeplink(mcpUrl: string): string {
  return "vscode:mcp/install?" + encodeURIComponent(JSON.stringify({ name: "companyos", type: "http", url: mcpUrl }));
}

const tokenSteps = ["Create a scoped worker token below.", "Copy the platform configuration, then connect."];

export const platforms: Platform[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    oauth: {
      steps: ["Add the remote MCP server.", "Run the login command, or use /mcp then Authenticate in Claude Code."],
      command: (mcpUrl) => "claude mcp add --transport http companyos " + mcpUrl + "\nclaude mcp login companyos",
    },
    token: { steps: tokenSteps, snippet: (mcpUrl, token) => buildTokenSnippets(mcpUrl, token).claude },
  },
  {
    id: "claude-desktop-web",
    label: "Claude Desktop / claude.ai",
    oauth: {
      steps: [
        "Open claude.ai, then Customize and Connectors.",
        "Add a custom connector named CompanyOS and paste the MCP URL.",
        "Choose Connect and approve the browser OAuth consent screen.",
      ],
      note: "Remote connectors are brokered through Anthropic's cloud, so this URL must be publicly reachable. Localhost will not work.",
    },
    token: { steps: tokenSteps, snippet: (mcpUrl, token) => buildTokenSnippets(mcpUrl, token).claudeDesktop },
  },
  {
    id: "cursor",
    label: "Cursor",
    oauth: {
      steps: ["Open the install link in a browser and accept the server.", "Connect in Cursor and approve browser OAuth when prompted."],
      deeplink: cursorInstallDeeplink,
    },
    token: { steps: tokenSteps, snippet: (mcpUrl, token) => buildTokenSnippets(mcpUrl, token).mcpJson },
  },
  {
    id: "vscode",
    label: "VS Code",
    oauth: {
      steps: ["Open the install link or run the command.", "Connect to CompanyOS and approve browser OAuth when prompted."],
      deeplink: vscodeInstallDeeplink,
      command: (mcpUrl) => "code --add-mcp '" + JSON.stringify({ name: "companyos", type: "http", url: mcpUrl }) + "'",
    },
    token: { steps: tokenSteps, snippet: (mcpUrl, token) => buildTokenSnippets(mcpUrl, token).mcpJson },
  },
  {
    id: "codex",
    label: "Codex",
    oauth: {
      steps: ["Add the remote MCP server.", "Run the separate login command and approve browser OAuth."],
      command: (mcpUrl) => "codex mcp add companyos --url " + mcpUrl + "\ncodex mcp login companyos",
    },
    token: { steps: tokenSteps, snippet: (mcpUrl, token) => buildTokenSnippets(mcpUrl, token).codex },
  },
  {
    id: "chatgpt",
    label: "ChatGPT",
    oauth: {
      steps: [
        "Open workspace Settings, Apps, and enable Developer mode.",
        "Create an app, paste the MCP URL, choose OAuth, then Scan Tools.",
        "Approve OAuth during the scan, then create the app.",
      ],
      note: "Business and Enterprise admins can enable Developer mode; Pro supports read-only MCP. The URL must be publicly reachable.",
    },
    token: { steps: tokenSteps, snippet: (mcpUrl, token) => buildTokenSnippets(mcpUrl, token).chatgpt },
  },
  {
    id: "gemini-cli",
    label: "Gemini CLI",
    oauth: {
      steps: ["Add the remote MCP server.", "OAuth starts on the first 401, or run /mcp auth companyos."],
      command: (mcpUrl) => "gemini mcp add --transport http companyos " + mcpUrl,
    },
    token: { steps: tokenSteps, snippet: (mcpUrl, token) => buildTokenSnippets(mcpUrl, token).mcpJson },
  },
  {
    id: "hermes",
    label: "Hermes",
    token: {
      steps: [
        "Create a scoped worker token below.",
        "Add the server block to ~/.hermes/config.yaml on the machine running Hermes, then reload or restart Hermes.",
      ],
      snippet: (mcpUrl, token) => buildTokenSnippets(mcpUrl, token).hermes,
    },
  },
  {
    id: "other",
    label: "Other (manual token)",
    token: {
      steps: [
        "Create a scoped worker token below.",
        "Configure your MCP client with the URL and the Authorization header from the snippet.",
      ],
      snippet: (mcpUrl, token) => buildTokenSnippets(mcpUrl, token).other,
    },
  },
];
