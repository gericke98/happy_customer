// @ts-check
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "../db/schema";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Check if DATABASE_URL is defined
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL environment variable is not set");
  process.exit(1);
}

// Connect to the database
const sql = neon(databaseUrl);
const db = drizzle(sql, { schema });

async function addAllowedOrigin() {
  try {
    const now = new Date().toISOString();

    // Add the allowed origin
    const result = await db.insert(schema.allowedOrigins).values({
      origin: "https://shameless-test.myshopify.com",
      shopId: "shameless-test", // Using a simpler shop ID
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    console.log("Allowed origin added successfully:", result);
  } catch (error) {
    console.error("Error adding allowed origin:", error);
  } finally {
    process.exit(0);
  }
}

addAllowedOrigin();
