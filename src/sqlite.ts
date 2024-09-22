import {drizzle} from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as fs from "node:fs";
import {migrate} from "drizzle-orm/better-sqlite3/migrator";

if (!fs.existsSync('db/sqlite.db')) {
    fs.mkdirSync('db', {recursive: true});
    fs.writeFileSync('db/sqlite.db', '');
}
const sqlite = new Database('db/sqlite.db');

const db = drizzle(sqlite);
migrate(db, {migrationsFolder: 'drizzle', migrationsTable: 'migrations'});
export {db};