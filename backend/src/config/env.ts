import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().min(1),
  JOIN_CODE_PEPPER: z.string().min(32),
  TRUST_PROXY: z.string().default("false"),
  CORS_ORIGIN: z.string().default("http://localhost:3000,https://skillquest.associationchabaconnect.ma"),
});

export const env = schema.parse(process.env);
if (env.JOIN_CODE_PEPPER.startsWith("REPLACE_")) {
  throw new Error("Remplacez JOIN_CODE_PEPPER par un secret aléatoire dans backend/.env");
}

if (env.CORS_ORIGIN.split(",").some(o => o.trim() === "*")) throw new Error("CORS_ORIGIN doit contenir des origines explicites, jamais *");
