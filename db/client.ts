import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

const url = process.env.TURSO_DATABASE_URL || "file:./db/dextrip-arena.sqlite";
const authToken = process.env.TURSO_AUTH_TOKEN;

export const sqlite = createClient({
  url,
  authToken,
});

export const db = drizzle(sqlite, { schema });
