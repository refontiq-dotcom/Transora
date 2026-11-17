import { createServer, Server } from "node:http";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import app from "../src/app";

describe("public booking API versioning", () => {
  let server: Server;
  let baseUrl = "";

  beforeAll(async () => {
    server = createServer(app);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Impossible de déterminer le port du serveur de test.");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (!server?.listening) return;
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  });

  test.each([
    ["/api/v1/public", "versionnée"],
    ["/api/public", "historique"]
  ])("la route publique %s reste accessible sans JWT (%s)", async path => {
    const response = await fetch(`${baseUrl}${path}/code-invalide/departs`);
    const payload = await response.json() as { success: boolean; message: string };

    // Une réponse de validation 400 prouve que la route publique a été atteinte.
    // Une réponse 401 indiquerait que le middleware JWT l'a interceptée.
    expect(response.status).toBe(400);
    expect(payload.success).toBe(false);
    expect(payload.message).toBe("Données invalides");
  });
});
