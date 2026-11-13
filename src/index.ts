import dotenv from "dotenv";
import app from "./app";

dotenv.config();

const PORT = Number(process.env.PORT) || 3000;
const server = app.listen(PORT, () => {
  console.log(`TRANSORA API démarrée sur le port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
});

export default server;
