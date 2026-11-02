// SQLite storage via Node's built-in driver (no native build step).
// The schema sticks to portable SQL so it can move to Postgres later.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const DB_PATH = process.env.DB_PATH || resolve(here, '../data/inventory.db');

export const STATUSES = [
  { key: 'in_stock',   label: 'In Stock' },
  { key: 'deployed',   label: 'Deployed' },
  { key: 'in_transit', label: 'In Transit' },
  { key: 'repair',     label: 'In Repair' },
  { key: 'retired',    label: 'Retired' },
  { key: 'lost',       label: 'Lost' },
];
export const CATEGORIES = [
  // short: Add device type picker; eui: whether this kind of equipment carries a LoRaWAN EUI
  { key: 'sensor',   label: 'LoRaWAN Sensor',     short: 'Sensor',  eui: true },
  { key: 'gateway',  label: 'Gateway',            short: 'Gateway', eui: true },
  { key: 'antenna',  label: 'Antenna',            short: 'Antenna' },
  { key: 'power',    label: 'Power / Solar',      short: 'Power' },
  { key: 'network',  label: 'Backhaul / Network', short: 'Network' },
  { key: 'other',    label: 'Other Equipment',    short: 'Other' },
];
export const LOCATION_KINDS = [
  { key: 'warehouse', label: 'Warehouse / Stock' },
  { key: 'site',      label: 'Deployment Site' },
  { key: 'vehicle',   label: 'Vehicle / Field Kit' },
  { key: 'vendor',    label: 'Vendor / Repair' },
  { key: 'customer',  label: 'Customer' },
];

const MIGRATIONS = [
  `CREATE TABLE models (
     id           INTEGER PRIMARY KEY,
     category     TEXT NOT NULL DEFAULT 'sensor',
     manufacturer TEXT NOT NULL,
     model        TEXT NOT NULL,
     description  TEXT,
     created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
     UNIQUE (manufacturer, model)
   );
   CREATE TABLE locations (
     id         INTEGER PRIMARY KEY,
     name       TEXT NOT NULL UNIQUE,
     kind       TEXT NOT NULL DEFAULT 'warehouse',
     address    TEXT,
     lat        REAL,
     lon        REAL,
     notes      TEXT,
     archived   INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
   );
   CREATE TABLE devices (
     id               INTEGER PRIMARY KEY,
     uid              TEXT NOT NULL UNIQUE,          -- DevEUI / Gateway EUI, or generated JSP-xxxxxxxx
     uid_source       TEXT NOT NULL,                 -- 'eui' | 'generated' | 'manual'
     eui              TEXT UNIQUE,                   -- DevEUI or Gateway EUI (16 hex)
     join_eui         TEXT,
     serial_number    TEXT,
     name             TEXT,                          -- friendly label, e.g. "Tank 3 level"
     model_id         INTEGER REFERENCES models(id),
     status           TEXT NOT NULL DEFAULT 'in_stock',
     location_id      INTEGER REFERENCES locations(id),
     lat              REAL,                          -- last recorded position (e.g. GPS at deploy)
     lon              REAL,
     purchase_date    TEXT,
     vendor           TEXT,
     po_number        TEXT,
     cost             REAL,
     warranty_expires TEXT,
     firmware         TEXT,
     notes            TEXT,
     created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
     updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
   );
   CREATE INDEX devices_status   ON devices(status);
   CREATE INDEX devices_location ON devices(location_id);
   CREATE INDEX devices_model    ON devices(model_id);
   CREATE TABLE events (
     id               INTEGER PRIMARY KEY,
     device_id        INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
     ts               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
     action           TEXT NOT NULL,                 -- created | status | edit | note
     from_status      TEXT,
     to_status        TEXT,
     from_location_id INTEGER REFERENCES locations(id),
     to_location_id   INTEGER REFERENCES locations(id),
     lat              REAL,
     lon              REAL,
     note             TEXT,
     changes          TEXT,                          -- JSON of edited fields
     actor            TEXT                           -- free text until logins exist
   );
   CREATE INDEX events_device ON events(device_id, ts);
   CREATE INDEX events_ts     ON events(ts);`,
  // Devices first added without their EUI got a generated JSP- id. Once the EUI is known the EUI becomes
  // the id, and the JSP- id is kept as old_uid so its printed label still scans.
  `ALTER TABLE devices ADD COLUMN old_uid TEXT;
   CREATE UNIQUE INDEX devices_old_uid ON devices(old_uid) WHERE old_uid IS NOT NULL;
   UPDATE devices SET old_uid = uid, uid = eui, uid_source = 'eui' WHERE uid_source = 'generated' AND eui IS NOT NULL;
   INSERT INTO events (device_id, action, changes, actor)
     SELECT id, 'edit', json_object('uid', json_object('from', old_uid, 'to', uid)), 'system'
     FROM devices WHERE old_uid IS NOT NULL;`,
];

export function openDb(path = DB_PATH) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  return db;
}

export function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
