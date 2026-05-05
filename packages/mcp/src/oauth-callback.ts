import { createServer, Server } from "node:http";

export interface AuthCallbackResult {
  token: string;
  orgId: string;
}

export interface WaitForOAuthCallbackOptions {
  expectedState: string;
  timeoutMs?: number;
}

export interface WaitForOAuthCallbackReturn {
  port: number;
  result: Promise<AuthCallbackResult>;
}

const CALLBACK_PATH = "/callback";
// Grace period for the browser to render the success page before the port closes
const SERVER_CLOSE_DELAY_MS = 100;

interface RenderSetupPageOpts {
  title: string;
  heading: string;
  headingColor: string;
  body: string;
  logoOpacity?: number;
}

function renderSetupPage(opts: RenderSetupPageOpts): string {
  const logoOpacity = opts.logoOpacity ?? 1;
  return `<!DOCTYPE html>
<html>
  <head><title>${opts.title}</title></head>
  <body style="font-family: system-ui, -apple-system, sans-serif; background: #0a0a0a; color: #fff; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
    <div style="text-align: center; display: flex; flex-direction: column; align-items: center; gap: 24px;">
      <img src="https://b3os.org/images/homepage/b3-logo.svg" alt="B3OS" width="69" height="62" style="display: block; filter: invert(1); opacity: ${logoOpacity};" />
      <h1 style="color: ${opts.headingColor}; font-size: 32px; margin: 0; font-weight: 700;">${opts.heading}</h1>
      <p style="color: #a1a1aa; font-size: 16px; margin: 0; max-width: 400px; line-height: 1.5;">${opts.body}</p>
    </div>
  </body>
</html>`;
}

const SUCCESS_HTML = renderSetupPage({
  title: "B3OS MCP Setup Complete",
  heading: "Setup Complete",
  headingColor: "#6C8EEF",
  body: "You can close this tab and return to your terminal.",
});

const ERROR_HTML = renderSetupPage({
  title: "B3OS MCP Setup Failed",
  heading: "Setup Failed",
  headingColor: "#ef4444",
  body: "The authentication callback was invalid. Please re-run b3os-mcp-setup.",
  logoOpacity: 0.5,
});

export async function waitForOAuthCallback(
  options: WaitForOAuthCallbackOptions,
): Promise<WaitForOAuthCallbackReturn> {
  const { expectedState, timeoutMs = 300_000 } = options;

  const { server, port } = await new Promise<{ server: Server; port: number }>(
    (resolve, reject) => {
      const s = createServer();
      s.on("error", (err) => {
        s.close();
        reject(err);
      });
      // Bind to 127.0.0.1 only (never 0.0.0.0) and let the OS pick a free port (port 0)
      s.listen(0, "127.0.0.1", () => {
        const addr = s.address();
        if (addr && typeof addr === "object") {
          resolve({ server: s, port: addr.port });
        } else {
          s.close();
          reject(new Error("Failed to determine callback server port"));
        }
      });
    },
  );

  const result = new Promise<AuthCallbackResult>((resolve, reject) => {
    let handled = false;
    const timeout = setTimeout(() => {
      if (handled) return;
      handled = true;
      server.close();
      reject(
        new Error(`Timed out after ${Math.round(timeoutMs / 60_000)} minutes`),
      );
    }, timeoutMs);

    server.on("request", (req, res) => {
      if (!req.url?.startsWith(CALLBACK_PATH)) {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }
      if (handled) {
        // Already received a valid callback; ignore extras (browser prefetch, favicon, etc.)
        res.statusCode = 204;
        res.end();
        return;
      }

      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      const token = url.searchParams.get("token");
      const orgId = url.searchParams.get("orgId");
      const state = url.searchParams.get("state");

      // Non-constant-time comparison is intentional: this server binds to 127.0.0.1
      // only, runs for a single callback, then shuts down. Remote timing attacks
      // are not feasible.
      if (!token || !orgId || state !== expectedState) {
        handled = true;
        clearTimeout(timeout);
        res.statusCode = 400;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(ERROR_HTML);
        // Defer settlement until after the response is fully sent so fetch() resolves
        // before the promise rejects — prevents PromiseRejectionHandledWarning in tests
        res.on("finish", () => {
          server.close();
          reject(
            new Error(
              "Invalid OAuth callback: missing token/orgId or state mismatch",
            ),
          );
        });
        return;
      }

      handled = true;
      clearTimeout(timeout);
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(SUCCESS_HTML);
      res.on("finish", () => {
        setTimeout(() => server.close(), SERVER_CLOSE_DELAY_MS);
        resolve({ token, orgId });
      });
    });
  });

  // Attach a no-op catch so Node never sees an unhandled rejection — the caller
  // is expected to await `result`, but if the promise rejects before they do,
  // Node would surface a warning.
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  result.catch(() => {});

  return { port, result };
}
