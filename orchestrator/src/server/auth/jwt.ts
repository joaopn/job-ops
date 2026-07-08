import { randomBytes, randomUUID } from "node:crypto";
import { logger } from "@infra/logger";
import * as authSessionsRepo from "@server/repositories/auth-sessions";
import {
  getRuntimeSecret,
  insertRuntimeSecretIfAbsent,
} from "@server/repositories/runtime-secrets";
import jwt from "jsonwebtoken";

const DEFAULT_EXPIRY_SECONDS = 86400; // 24 hours
const MIN_JWT_SECRET_LENGTH = 32;
const JWT_SECRET_KEY = "jwt_secret";
let cachedJwtSecret: string | null = null;

async function ensurePersistedJwtSecret(): Promise<string> {
  const existing = await getRuntimeSecret(JWT_SECRET_KEY);
  if (existing) {
    if (existing.length < MIN_JWT_SECRET_LENGTH) {
      throw new Error(
        `Persisted JWT secret must be at least ${MIN_JWT_SECRET_LENGTH} characters long`,
      );
    }
    return existing;
  }

  // Insert-if-absent + re-read: concurrent first sign-ins both generate, one
  // insert wins, both converge on the stored winner.
  const generated = randomBytes(48).toString("base64url");
  await insertRuntimeSecretIfAbsent(JWT_SECRET_KEY, generated);
  const stored = await getRuntimeSecret(JWT_SECRET_KEY);
  if (!stored || stored.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      `Persisted JWT secret must be at least ${MIN_JWT_SECRET_LENGTH} characters long`,
    );
  }
  if (stored === generated) {
    logger.info("Generated local JWT secret");
  }
  return stored;
}

async function getJwtSecret(): Promise<string> {
  if (cachedJwtSecret) return cachedJwtSecret;

  const explicit = process.env.JWT_SECRET;
  if (explicit) {
    if (explicit.length < MIN_JWT_SECRET_LENGTH) {
      throw new Error(
        `JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters long`,
      );
    }
    cachedJwtSecret = explicit;
    return explicit;
  }

  const persisted = await ensurePersistedJwtSecret();
  cachedJwtSecret = persisted;
  return persisted;
}

function getJwtExpirySeconds(): number {
  const raw = process.env.JWT_EXPIRY_SECONDS;
  if (!raw) return DEFAULT_EXPIRY_SECONDS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_EXPIRY_SECONDS;
}

export async function signToken(sub: string): Promise<{
  token: string;
  expiresIn: number;
}> {
  const secret = await getJwtSecret();
  const expiresIn = getJwtExpirySeconds();
  const jti = randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;

  await authSessionsRepo.createAuthSession({
    id: jti,
    subject: sub,
    expiresAt,
  });

  const token = jwt.sign({ sub }, secret, {
    algorithm: "HS256",
    expiresIn,
    jwtid: jti,
  });

  return { token, expiresIn };
}

export async function verifyToken(token: string): Promise<{
  sub: string;
  jti: string;
  exp: number;
}> {
  const secret = await getJwtSecret();
  const payload = jwt.verify(token, secret, {
    algorithms: ["HS256"],
  }) as jwt.JwtPayload;

  if (!payload.sub || !payload.jti || !payload.exp) {
    throw new Error("Token missing required claims");
  }

  const session = await authSessionsRepo.getAuthSession(payload.jti);
  const now = Math.floor(Date.now() / 1000);
  if (
    !session ||
    session.revokedAt !== null ||
    session.expiresAt <= now ||
    session.subject !== payload.sub
  ) {
    throw new Error("Token has been revoked");
  }

  return {
    sub: payload.sub,
    jti: payload.jti,
    exp: payload.exp,
  };
}

export async function blacklistToken(jti: string): Promise<void> {
  await authSessionsRepo.revokeAuthSession(jti);
}

/** Test-only: clear persisted auth sessions. */
export async function __resetBlacklistForTests(): Promise<void> {
  cachedJwtSecret = null;
  await authSessionsRepo.deleteAllAuthSessions();
}
