import postgres from "postgres";
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

// Read the database URL from environment variables
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL environment variable is not set");
  process.exit(1);
}

// Connect to the database
console.log("Connecting to database...");
const sql = postgres(databaseUrl, { ssl: { rejectUnauthorized: false } });

// Run migrations
async function main() {
  console.log("Running migrations...");

  try {
    // Log database connection info
    console.log("Database connection established");

    // Drop existing tables if they exist
    console.log("Dropping existing tables...");
    await sql`DROP TABLE IF EXISTS "messages" CASCADE;`;
    await sql`DROP TABLE IF EXISTS "tickets" CASCADE;`;
    await sql`DROP TABLE IF EXISTS "allowed_origins" CASCADE;`;
    await sql`DROP TABLE IF EXISTS "shops" CASCADE;`;
    console.log("Existing tables dropped");

    // Create tables
    console.log("Creating shops table...");
    await sql`
      CREATE TABLE "shops" (
        "id" text PRIMARY KEY NOT NULL,
        "name" text NOT NULL,
        "domain" text NOT NULL UNIQUE,
        "access_token" text,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" text NOT NULL,
        "updated_at" text NOT NULL
      );
    `;
    console.log("Shops table created successfully");

    console.log("Creating tickets table...");
    await sql`
      CREATE TABLE "tickets" (
        "id" text PRIMARY KEY NOT NULL,
        "order_number" text,
        "email" text,
        "name" text,
        "shop_id" text REFERENCES "shops"("id"),
        "created_at" text NOT NULL,
        "updated_at" text NOT NULL,
        "status" text NOT NULL,
        "admin" boolean NOT NULL DEFAULT false
      );
    `;
    console.log("Tickets table created successfully");

    console.log("Creating messages table...");
    await sql`
      CREATE TABLE "messages" (
        "id" serial PRIMARY KEY NOT NULL,
        "sender" text NOT NULL,
        "text" text NOT NULL,
        "timestamp" text NOT NULL,
        "ticket_id" text REFERENCES "tickets"("id") ON DELETE CASCADE
      );
    `;
    console.log("Messages table created successfully");

    // Create allowed_origins table
    console.log("Creating allowed_origins table...");
    await sql`
      CREATE TABLE "allowed_origins" (
        "id" serial PRIMARY KEY NOT NULL,
        "origin" text NOT NULL UNIQUE,
        "shop_id" text REFERENCES "shops"("id"),
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" text NOT NULL,
        "updated_at" text NOT NULL
      );
    `;
    console.log("Allowed origins table created successfully");

    // Verify tables were created
    console.log("Verifying tables...");
    const tables = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public';
    `;
    console.log(
      "Tables in database:",
      tables.map((t) => t.table_name)
    );

    console.log("Migration completed successfully");
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  } finally {
    await sql.end();
    console.log("Database connection closed");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Unhandled error in migration script:", err);
  process.exit(1);
});
