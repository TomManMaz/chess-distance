import postgres from "postgres";

// In development, reuse the connection across hot-reloads
declare global {
  // eslint-disable-next-line no-var
  var __db: ReturnType<typeof postgres> | undefined;
}

function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL environment variable is not set");
  return postgres(url, {
    max: 1,             // one connection per serverless invocation
    idle_timeout: 20,   // close idle connections after 20s
    connect_timeout: 10,
  });
}

export function getDb(): ReturnType<typeof postgres> {
  if (process.env.NODE_ENV === "production") {
    return createDb();
  }
  // Dev: reuse across hot-reloads to avoid connection churn
  if (!global.__db) global.__db = createDb();
  return global.__db;
}
