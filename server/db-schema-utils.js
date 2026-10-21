import { getDbPool } from "./db-core.js";

export async function tableExists(tableName) {
  const [tables] = await getDbPool().query(
    `SELECT TABLE_NAME
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
     LIMIT 1`,
    [tableName]
  );

  return tables.length > 0;
}

export async function addColumnIfMissing(tableName, columnName, definition) {
  const [columns] = await getDbPool().query(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [tableName, columnName]
  );

  if (!columns.length) {
    try {
      await getDbPool().query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    } catch (error) {
      if (error?.code !== "ER_DUP_FIELDNAME") throw error;
    }
  }
}

export async function addIndexIfMissing(tableName, indexName, statement) {
  const [indexes] = await getDbPool().query(
    `SELECT INDEX_NAME
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND INDEX_NAME = ?
     LIMIT 1`,
    [tableName, indexName]
  );

  if (!indexes.length) {
    await getDbPool().query(statement);
  }
}

// A guest can now own multiple character conversations. Older installations created
// this index as UNIQUE, so keep the migration explicit instead of relying on a
// fresh-schema-only definition.
export async function ensureNonUniqueIndex(tableName, indexName, statement) {
  const [indexes] = await getDbPool().query(
    `SELECT NON_UNIQUE
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND INDEX_NAME = ?
     LIMIT 1`,
    [tableName, indexName]
  );
  const current = indexes[0];
  if (current && Number(current.NON_UNIQUE) === 1) return;
  if (current) await getDbPool().query(`ALTER TABLE ${tableName} DROP INDEX ${indexName}`);
  await getDbPool().query(statement);
}

export async function ensureIndexColumns(tableName, indexName, columnNames, statement) {
  const [indexes] = await getDbPool().query(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND INDEX_NAME = ?
     ORDER BY SEQ_IN_INDEX ASC`,
    [tableName, indexName]
  );
  const actualColumns = indexes.map((index) => String(index.COLUMN_NAME || "").toLowerCase());
  const expectedColumns = columnNames.map((columnName) => String(columnName || "").toLowerCase());
  if (actualColumns.length === expectedColumns.length
    && actualColumns.every((columnName, index) => columnName === expectedColumns[index])) {
    return;
  }
  if (actualColumns.length) await getDbPool().query(`ALTER TABLE ${tableName} DROP INDEX ${indexName}`);
  await getDbPool().query(statement);
}
