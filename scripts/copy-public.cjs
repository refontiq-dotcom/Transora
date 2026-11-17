const fs = require("node:fs");
const path = require("node:path");

const source = path.resolve(process.cwd(), "public");
const destination = path.resolve(process.cwd(), "dist");

if (!fs.existsSync(source)) {
  throw new Error("Le dossier public est introuvable : " + source);
}

fs.mkdirSync(destination, { recursive: true });
fs.cpSync(source, destination, { recursive: true, force: true });
console.log("Fichiers publics copiés dans dist.");
