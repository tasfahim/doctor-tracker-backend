
import dns from "node:dns";

dns.setServers(["1.1.1.1", "8.8.8.8"]);
import app from "./app.js";
import connectDatabase from "./config/database.js";

const PORT = Number(process.env.PORT) || 5000;

const startServer = async (): Promise<void> => {
  try {
    // Connect to MongoDB before starting the API
    await connectDatabase();

    const server = app.listen(PORT, () => {
      console.log("--------------------------------------");
      console.log("       DOCTOR TRACKER API");
      console.log("--------------------------------------");
      console.log(`Server running on: http://localhost:${PORT}`);
      console.log(`Health check: http://localhost:${PORT}/api/health`);
      console.log("Environment:", process.env.NODE_ENV || "development");
      console.log("--------------------------------------");
    });

    server.on("error", (error) => {
      console.error("Server startup error:", error);
      process.exit(1);
    });
  } catch (error) {
    console.error("Application startup failed:", error);
    process.exit(1);
  }
};

startServer();
