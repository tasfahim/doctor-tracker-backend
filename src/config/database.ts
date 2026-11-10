import mongoose from "mongoose";

const connectDatabase = async (): Promise<void> => {
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri || !mongoUri.trim()) {
    throw new Error("MONGODB_URI is missing from environment variables");
  }

  // Avoid buffering database operations indefinitely when the database is down.
  mongoose.set("bufferCommands", false);

  // Log connection state changes so database interruptions are visible.
  mongoose.connection.on("disconnected", () => {
    console.error("MongoDB connection lost");
  });

  mongoose.connection.on("reconnected", () => {
    console.log("MongoDB connection restored");
  });

  mongoose.connection.on("error", (error) => {
    console.error("MongoDB connection error:", error.message);
  });

  // If the initial connection fails, this throws and server.ts can stop startup.
  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000,
    socketTimeoutMS: 45000,
    maxPoolSize: 10,
    minPoolSize: 0,
  });

  console.log("MongoDB connected successfully");
  console.log(`Database name: ${mongoose.connection.name}`);
};

export default connectDatabase;
