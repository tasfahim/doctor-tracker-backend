import "dotenv/config";
import apiRoutes from "./routes/api.routes.js";
import express, {
  ErrorRequestHandler,
  Request,
  Response,
} from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import mongoose from "mongoose";

// Create the Express application.
const app = express();

// -----------------------------------------
// 1. Security middleware
// -----------------------------------------

app.use(helmet());

// -----------------------------------------
// 2. CORS configuration
// -----------------------------------------

// CLIENT_URL may contain one URL or a comma-separated list of allowed URLs.
// Example: https://your-frontend.vercel.app,http://localhost:3000
const allowedOrigins = (process.env.CLIENT_URL || "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Requests without an Origin header (for example health checks or curl)
      // are allowed. Browser requests must match the configured allowlist.
      if (!origin || allowedOrigins.includes(origin.replace(/\/$/, ""))) {
        return callback(null, true);
      }

      return callback(new Error("Origin is not allowed by CORS"));
    },
    credentials: true,
  })
);

// -----------------------------------------
// 3. Request parsing middleware
// -----------------------------------------

app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true, limit: "10kb" }));
app.use(cookieParser());

// -----------------------------------------
// 4. Rate limiting
// -----------------------------------------

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests. Please try again later.",
  },
});

app.use("/api", apiLimiter);

// -----------------------------------------
// 5. API health check
// -----------------------------------------

app.get("/api/health", (_req: Request, res: Response) => {
  const databaseReadyState = mongoose.connection.readyState;
  const databaseConnected = databaseReadyState === 1;

  return res.status(databaseConnected ? 200 : 503).json({
    success: databaseConnected,
    message: databaseConnected
      ? "Doctor Tracker API is running"
      : "Doctor Tracker database is not connected",
    database: databaseConnected ? "connected" : "disconnected",
    timestamp: new Date().toISOString(),
  });
});

// -----------------------------------------
// 6. Welcome route
// -----------------------------------------

app.get("/", (_req: Request, res: Response) => {
  return res.status(200).json({
    success: true,
    message: "Welcome to Doctor Tracker API",
    version: "1.0.0",
  });
});

// -----------------------------------------
// 7. API routes
// -----------------------------------------

app.use("/api", apiRoutes);

// -----------------------------------------
// 8. Handle unknown routes
// -----------------------------------------

app.use("/api", (_req: Request, res: Response) => {
  return res.status(404).json({
    success: false,
    message: "API endpoint not found",
  });
});

// -----------------------------------------
// 9. Centralized error handling
// -----------------------------------------

const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  let statusCode = 500;
  let message = "An unexpected server error occurred";

  if (error instanceof SyntaxError && "status" in error && error.status === 400) {
    statusCode = 400;
    message = "Invalid JSON request body";
  } else if (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "ValidationError"
  ) {
    statusCode = 400;
    message = "The submitted data is invalid";
  } else if (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "CastError"
  ) {
    statusCode = 400;
    message = "An invalid database identifier or value was provided";
  } else if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 11000
  ) {
    statusCode = 409;
    message = "A record with this information already exists";
  } else if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message === "Origin is not allowed by CORS"
  ) {
    statusCode = 403;
    message = "This website is not allowed to access the API";
  }

  // Keep technical details in the server console, not in public responses.
  console.error("[API ERROR]", error);

  if (process.env.NODE_ENV !== "production" && error instanceof Error) {
    return res.status(statusCode).json({
      success: false,
      message,
      ...(statusCode === 500 ? { debugMessage: error.message } : {}),
    });
  }

  return res.status(statusCode).json({
    success: false,
    message,
  });
};

app.use(errorHandler);

// Export the application.
export default app;
