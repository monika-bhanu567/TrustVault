import { buildApp } from "./app.js";
const app = buildApp();
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";
async function startServer() {
    try {
        await app.listen({ port, host });
        console.log(`TrustVault API listening on http://${host}:${port}`);
    }
    catch (error) {
        console.error("Failed to start TrustVault API:", error);
        process.exit(1);
    }
}
void startServer();
