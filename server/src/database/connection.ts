/**
 * Database Configuration
 * MySQL connection setup (using mysql2 for now - can be replaced with ORM).
 *
 * Single shared pool for the whole process (REST + WebSocket + scripts).
 * Repositories receive this module (the `Db` interface) through constructor
 * dependency injection.
 */
import { createPool, type Pool, type PoolConnection, type ResultSetHeader } from 'mysql2/promise';

export type { Pool, PoolConnection, ResultSetHeader };

/**
 * The injected database handle used by every repository.
 * `query<T>` returns the FULL result (rows array for SELECT, ResultSetHeader
 * for INSERT/UPDATE/DELETE) so repositories keep the existing call shapes.
 */
export interface Db {
  pool: Pool;
  query<T>(sql: string, values?: unknown[]): Promise<T>;
  transaction<T>(callback: (conn: PoolConnection) => Promise<T>): Promise<T>;
  testConnection(): Promise<boolean>;
}

const pool: Pool = createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'kneachat',
  port: Number(process.env.DB_PORT) || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
});

/**
 * Test database connection
 */
const testConnection = async (): Promise<boolean> => {
  try {
    const connection = await pool.getConnection();
    console.log('✅ Database connection successful');
    connection.release();
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', (error as Error).message);
    return false;
  }
};

/**
 * Execute query with connection pooling.
 *
 * Uses the text protocol (connection.query) rather than prepared statements
 * (connection.execute): newer MySQL servers (8.0.23+ / 9.x) reject string or
 * number placeholders used with LIMIT/OFFSET in prepared statements with
 * "Incorrect arguments to mysqld_stmt_execute". Values are still escaped and
 * parameterized via ? placeholders, so SQL injection protection is kept.
 */
const query = async <T>(sql: string, values: unknown[] = []): Promise<T> => {
  const connection = await pool.getConnection();
  try {
    const [results] = await connection.query(sql, values);
    return results as unknown as T;
  } finally {
    connection.release();
  }
};

/**
 * Execute multiple queries in a transaction
 */
const transaction = async <T>(callback: (conn: PoolConnection) => Promise<T>): Promise<T> => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const db: Db = {
  pool,
  testConnection,
  query,
  transaction,
};

export default db;
