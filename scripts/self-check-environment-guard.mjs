import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { PROJECT_ROOT, SERVER_CONFIG } from "../server/config.js";
import { closeDbPool, getDbPool } from "../server/db.js";
import {
  CHAT_ATTACHMENT_UPLOAD_POLICY,
  CHAT_IMAGE_UPLOAD_POLICY,
  CHAT_VOICE_UPLOAD_POLICY,
} from "../server/upload-policies.js";

const APPROVED_LOCAL_DB_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const APPROVED_DEVELOPMENT_DB_PORT = 3307;
const APPROVED_SERVER_DB_PORT = 3306;

export function isApprovedLocalDatabaseTarget({ host = "", port = 0, allowServerPort = false } = {}) {
  if (!APPROVED_LOCAL_DB_HOSTS.has(String(host).trim().toLowerCase())) return false;
  const normalizedPort = Number(port);
  return normalizedPort === APPROVED_DEVELOPMENT_DB_PORT
    || (allowServerPort && normalizedPort === APPROVED_SERVER_DB_PORT);
}

export async function assertLocalMutatingSelfCheckEnvironment({ label = "mutating self-check" } = {}) {
  const configuredHost = String(SERVER_CONFIG.db.host || "").trim().toLowerCase();
  const allowServerPort = ["1", "true"].includes(String(process.env.ALLOW_MUTATING_SELF_CHECKS || "").trim().toLowerCase());
  if (!isApprovedLocalDatabaseTarget({ host: configuredHost, port: SERVER_CONFIG.db.port, allowServerPort })) {
    throw new Error(
      `${label} refused: expected development MySQL on loopback:3307, or explicit ALLOW_MUTATING_SELF_CHECKS=true for loopback:3306; received ${configuredHost}:${SERVER_CONFIG.db.port}`
    );
  }

  const [[database]] = await getDbPool().query(
    "SELECT DATABASE() AS database_name, @@port AS server_port"
  );
  if (
    String(database?.database_name || "") !== String(SERVER_CONFIG.db.database || "")
    || Number(database?.server_port) !== Number(SERVER_CONFIG.db.port)
  ) {
    throw new Error(`${label} refused: the connected database does not match the approved local target`);
  }

  const projectRoot = await realpath(PROJECT_ROOT);
  const uploadRoot = await realpath(resolve(PROJECT_ROOT, "uploads"));
  assertPathWithinProject(uploadRoot, projectRoot, `${label} upload root`);
  for (const policy of [
    CHAT_ATTACHMENT_UPLOAD_POLICY,
    CHAT_IMAGE_UPLOAD_POLICY,
    CHAT_VOICE_UPLOAD_POLICY,
  ]) {
    assertPathWithinProject(resolve(policy.uploadDir), uploadRoot, `${label} upload policy`);
  }

  return Object.freeze({
    database: String(database.database_name),
    databasePort: Number(database.server_port),
    uploadRoot,
  });
}

function assertPathWithinProject(candidate, parent, label) {
  const relation = relative(parent, candidate);
  if (relation === "" || (!relation.startsWith(`..${sep}`) && relation !== ".." && !isAbsolute(relation))) {
    return;
  }
  throw new Error(`${label} refused: ${candidate} is outside ${parent}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (
      !isApprovedLocalDatabaseTarget({ host: "localhost", port: 3307 })
      || isApprovedLocalDatabaseTarget({ host: "127.0.0.1", port: 3306 })
      || !isApprovedLocalDatabaseTarget({ host: "127.0.0.1", port: 3306, allowServerPort: true })
      || isApprovedLocalDatabaseTarget({ host: "mysql.example.com", port: 3306 })
      || isApprovedLocalDatabaseTarget({ host: "mysql.example.com", port: 3306, allowServerPort: true })
      || isApprovedLocalDatabaseTarget({ host: "127.0.0.1", port: 3308 })
    ) {
      throw new Error("self-check environment guard policy regression");
    }
    const target = await assertLocalMutatingSelfCheckEnvironment({ label: "deployment self-check suite" });
    console.log(`self-check environment approved: ${target.database}@127.0.0.1:${target.databasePort}`);
  } finally {
    await closeDbPool();
  }
}
