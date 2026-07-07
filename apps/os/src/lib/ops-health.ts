import "server-only";
import net from "node:net";
import tls from "node:tls";
import type { OpsHealthDeps, OpsHealthEmail, OpsHealthEnvironment } from "@companyos/api";

function envFlag(name: string): boolean {
  const value = process.env[name];
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export function opsHealthEnvironment(): OpsHealthEnvironment {
  return {
    brainCronEnabled: envFlag("BRAIN_CRON_ENABLED") || (process.env.COMPOSE_PROFILES || "").includes("brain-cron"),
    githubWebhookConfigured: !!process.env.GITHUB_WEBHOOK_SECRET,
    planeWebhookConfigured: !!process.env.PLANE_WEBHOOK_SECRET,
    planeApiConfigured: !!process.env.PLANE_API_TOKEN,
    litellmBaseUrl: process.env.LITELLM_BASE_URL || "http://localhost:4000",
    litellmEmbedKeyConfigured: !!process.env.LITELLM_EMBED_KEY,
    brainLiteLlmKeyConfigured: !!process.env.BRAIN_LITELLM_API_KEY,
    smtpConfigured: !!(process.env.SMTP_HOST && process.env.SMTP_FROM),
    dailyDigestEnabled: envFlag("OPS_HEALTH_DAILY_DIGEST"),
  };
}

export function opsHealthDeps(): OpsHealthDeps {
  const env = opsHealthEnvironment();
  return {
    llmProbe: async (keyName) => {
      const apiKey = keyName === "LITELLM_EMBED_KEY" ? process.env.LITELLM_EMBED_KEY : process.env.BRAIN_LITELLM_API_KEY;
      if (!apiKey) return { ok: false, checkedAt: new Date(), error: "key missing" };
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      try {
        const response = await fetch(`${(env.litellmBaseUrl || "http://localhost:4000").replace(/\/+$/, "")}/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: controller.signal,
          cache: "no-store",
        });
        return {
          ok: response.ok,
          checkedAt: new Date(),
          error: response.ok ? null : `LiteLLM returned HTTP ${response.status}`,
        };
      } catch (error) {
        return {
          ok: false,
          checkedAt: new Date(),
          error: error instanceof Error ? error.message : String(error),
        };
      } finally {
        clearTimeout(timeout);
      }
    },
    sendEmail: env.smtpConfigured ? sendSmtpEmail : undefined,
  };
}

function smtpLineReader(socket: net.Socket | tls.TLSSocket) {
  let buffer = "";
  return () => new Promise<string>((resolve, reject) => {
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
    };
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/);
      if (!buffer.endsWith("\n")) buffer = lines.pop() || "";
      else buffer = "";
      const terminal = lines.find((line) => /^\d{3}\s/.test(line));
      if (terminal) {
        cleanup();
        resolve(terminal);
      }
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    socket.on("data", onData);
    socket.on("error", onError);
  });
}

async function sendSmtpEmail(message: OpsHealthEmail): Promise<void> {
  const host = process.env.SMTP_HOST;
  const from = process.env.SMTP_FROM;
  if (!host || !from || message.to.length === 0) return;

  const port = Number(process.env.SMTP_PORT || "587");
  const secure = envFlag("SMTP_TLS") || port === 465;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const socket = secure ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
  const read = smtpLineReader(socket);
  const write = async (line: string, expected: RegExp) => {
    socket.write(`${line}\r\n`);
    const response = await read();
    if (!expected.test(response)) throw new Error(`SMTP rejected ${line.split(" ")[0]}: ${response}`);
  };

  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  const greeting = await read();
  if (!/^220/.test(greeting)) throw new Error(`SMTP greeting failed: ${greeting}`);
  await write(`EHLO ${process.env.INSTANCE_NAME || "companyos"}`, /^250/);
  if (user && pass) {
    await write("AUTH LOGIN", /^334/);
    await write(Buffer.from(user, "utf8").toString("base64"), /^334/);
    await write(Buffer.from(pass, "utf8").toString("base64"), /^235/);
  }
  await write(`MAIL FROM:<${from}>`, /^250/);
  for (const recipient of message.to) {
    await write(`RCPT TO:<${recipient}>`, /^250|^251/);
  }
  await write("DATA", /^354/);
  socket.write([
    `From: ${from}`,
    `To: ${message.to.join(", ")}`,
    `Subject: ${message.subject.replace(/\r|\n/g, " ")}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    message.text.replace(/\r?\n\./g, "\n.."),
    ".",
  ].join("\r\n") + "\r\n");
  const dataResponse = await read();
  if (!/^250/.test(dataResponse)) throw new Error(`SMTP DATA failed: ${dataResponse}`);
  socket.write("QUIT\r\n");
  socket.end();
}
