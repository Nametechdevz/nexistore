import mysql, { type Pool, type PoolConnection, type ResultSetHeader, type RowDataPacket } from "mysql2/promise";
import { config } from "./config.js";

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = mysql.createPool({
      host: config.DB_HOST,
      port: config.DB_PORT,
      user: config.DB_USER,
      password: config.DB_PASSWORD,
      database: config.DB_NAME,
      connectionLimit: 10,
      timezone: "Z",
      dateStrings: false,
      charset: "utf8mb4",
      // Nunca se permite más de una sentencia por consulta: reduce el impacto de una inyección.
      multipleStatements: false,
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

type Executor = Pool | PoolConnection;
type Params = (string | number | boolean | null | Date | Buffer)[];

/** Todas las consultas usan parámetros (?) — nunca concatenación de valores. */
export async function query<T = RowDataPacket>(sql: string, params: Params = [], db: Executor = getPool()): Promise<T[]> {
  const [rows] = await db.query<RowDataPacket[]>(sql, params);
  return rows as T[];
}

export async function queryOne<T = RowDataPacket>(sql: string, params: Params = [], db: Executor = getPool()): Promise<T | null> {
  const rows = await query<T>(sql, params, db);
  return rows[0] ?? null;
}

export async function execute(sql: string, params: Params = [], db: Executor = getPool()): Promise<ResultSetHeader> {
  const [res] = await db.execute<ResultSetHeader>(sql, params);
  return res;
}

export async function transaction<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export const toBool = (v: unknown) => v === 1 || v === true || v === "1";
export const toIso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ? new Date(String(v)).toISOString() : null);
