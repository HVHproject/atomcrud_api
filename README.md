# AtomCRUD — Back End API

A local Express/SQLite REST API that powers the AtomCRUD Electron app.

---

## Tech Stack

| Layer        | Technology                        |
|--------------|-----------------------------------|
| Runtime      | Node.js (CommonJS)               |
| Language     | TypeScript 5.x                   |
| Framework    | Express 5.x                      |
| Database     | SQLite via `better-sqlite3`       |
| File upload  | `multer` (memory storage)         |
| Rich text    | `marked`, `mammoth`, `turndown`, `docx` |
| Port         | 4000 (default)                   |

---

## Running the Project

```bash
# Development (watches for changes)
npm run dev

# Build TypeScript
npm run build

# Run compiled output
npm run start
```

---

## Database Folder Structure

Each database is stored as its own **folder** under `./databases/`:

```
databases/
  {safeName}_{timestamp}/          ← database folder (also the db ID)
    {safeName}.sqlite               ← SQLite database file
    {safeName}.meta.json            ← metadata (types, hidden flags, tags, rules)
    Gallery/                        ← reserved for media assets (future use)

backup/
  backup_{safeName}_{timestamp}/            ← backup folder (mirrors database structure)
    {safeName}.sqlite
    {safeName}.meta.json
    Gallery/                                ← copied from source if present
```

The `id` of a database is always the folder name (`{safeName}_{timestamp}`).  
The `safeName` is derived by lowercasing the display name and replacing non-alphanumeric characters with underscores (max 30 chars).

---

## System Columns

Every table has six protected columns that cannot be deleted, renamed, or retyped:

| Column         | Type    | Notes                            |
|----------------|---------|----------------------------------|
| `id`           | integer | PRIMARY KEY AUTOINCREMENT        |
| `title`        | string  | Required on insert               |
| `content`      | rich_text | Optional body                  |
| `date_created` | date    | Unix timestamp (ms), auto-set    |
| `date_modified`| date    | Unix timestamp (ms), auto-updated|
| `hidden`       | boolean | Soft-delete flag (0 / 1)         |

---

## Column Types

```
string          – TEXT
integer         – INTEGER
float           – REAL
boolean         – INTEGER (0 or 1)
rating          – INTEGER (0–5)
advanced_rating – REAL (0.0–10.0)
date            – INTEGER (Unix ms timestamp)
single_tag      – TEXT (one registered tag value)
multi_tag       – TEXT (comma-separated registered tag values)
rich_text       – TEXT (HTML string for TipTap editor)
link            – TEXT (JSON: { displayName: string, url: string })
custom          – TEXT (validated against a per-column regex rule)
```

---

## Column Metadata Fields

Every column in the metadata carries these fields:

| Field           | Type    | All columns | Tag columns only | Description |
|-----------------|---------|:-----------:|:----------------:|-------------|
| `type`          | string  | ✓ | | Column type (see above) |
| `hidden`        | boolean | ✓ | | Whether the column is visible in the UI |
| `index`         | integer | ✓ | | Display order (0-based) |
| `visualization` | string  | ✓ | | Front-end render hint (e.g. `"progress"`, `"stars"`, `"pill"`) |
| `tags`          | array   | | ✓ | Registered tag options `[{ name, description }]` |
| `tagLock`       | boolean | | ✓ | When `true`, users cannot add or remove tags |
| `linkedList`    | string  | | ✓ | ID of the GlobalTagList this column is bound to (empty = unlinked) |
| `rule`          | string  | custom only | | Regex for custom-type validation |

### tagLock + linkedList behaviour

- `tagLock: false` (default) — tags can be freely added/removed via the register/unregister endpoints.
- `tagLock: true`, `linkedList: ""` — tags are locked manually; use the `/taglock` endpoint to change.
- `tagLock: true`, `linkedList: "<id>"` — column is bound to a GlobalTagList. Tags are pulled from the list automatically on every sync. The lock cannot be changed manually — unlink first.

---

## GlobalTagLists

A GlobalTagList is a database-level, named list of strings stored in the database metadata (`globalTagLists` field). It lets you share a single source of truth for tag values across multiple columns.

**Acceptable source column types:** `string`, `single_tag`, `multi_tag`

| Source type | How values are collected |
|-------------|--------------------------|
| `single_tag` / `multi_tag` | Copies the column's registered tag names |
| `string` | Scans all rows and collects every unique non-null value |

**Sync behaviour:** If a list for the same `tableName + columnName` already exists, it is updated in-place (same ID). Otherwise a new list is created.

**Propagation:** When a list is synced, any tag column currently linked to it automatically has its `tags[]` refreshed with the new values.

**Link / unlink flow:**
1. Create or sync a list with `POST /api/database/:dbId/taglist/sync`.
2. Link a tag column: `POST .../column/:col/link` — sets `tagLock = true`, replaces `tags[]`.
3. Re-sync whenever the source data changes — all linked columns update automatically.
4. Unlink: `POST .../column/:col/unlink` — clears `linkedList`, resets `tagLock = false`, tags remain.

---

## API Endpoints

Base URL: `http://localhost:4000`

---

### Database Endpoints  `/api/database`

#### Create a Database
```http
POST /api/database
{ "name": "my_database" }
```

#### List All Databases
```http
GET /api/database
```

#### Get a Database (metadata + tables, no rows)
```http
GET /api/database/:dbId
```

#### Rename a Database
```http
PUT /api/database/:dbId
{ "newName": "renamed_database" }
```

#### Delete a Database
```http
DELETE /api/database/:dbId
```

---

### Table Endpoints  `/api/database/:dbId/table`

#### Create a Table
```http
POST /api/database/:dbId/table
{ "tableName": "my_table" }
```

#### Copy a Table (same or different database)
```http
POST /api/database/:sourceDbId/table/:tableName/copy
{ "targetDbId": "other_db_id", "newTableName": "optional_name" }
```

#### Get Rows from a Table
```http
GET /api/database/:dbId/table/:tableName
  ?offset=0
  &limit=25
  &q=(alpha or beta) and !gamma
  &s=title:asc
  &hidden=false
```

#### Rename a Table
```http
PATCH /api/database/:dbId/table/:tableName
{ "newName": "new_name" }
```

#### Change Table Visibility
```http
PATCH /api/database/:dbId/table/:tableName/visibility
{ "hidden": true }
```

#### Delete a Table
```http
DELETE /api/database/:dbId/table/:tableName
```

---

### Column Endpoints  `/api/database/:dbId/table/:tableName/column`

#### Create a Column
```http
POST /api/database/:dbId/table/:tableName/column
{ "name": "score", "type": "rating", "hidden": false }
```

#### Get All Columns
```http
GET /api/database/:dbId/table/:tableName/columns
```

#### Get a Single Column
```http
GET /api/database/:dbId/table/:tableName/column/:columnName
```

#### Rename or Retype a Column
```http
PATCH /api/database/:dbId/table/:tableName/column/:columnName
{ "newName": "score_v2", "newType": "advanced_rating" }
```
> ⚠ Changing type drops and re-adds the column — existing data is lost.

#### Change Column Visibility
```http
PATCH /api/database/:dbId/table/:tableName/column/:columnName/visibility
{ "hidden": true }
```

#### Swap Column Index (exchange two columns' display positions)
```http
PATCH /api/database/:dbId/table/:tableName/column/:columnName/swap
{ "targetIndex": 3 }
```

#### Move Column to Index (shift others)
```http
PATCH /api/database/:dbId/table/:tableName/column/:columnName/move
{ "newIndex": 2 }
```

#### Register a Tag Option
```http
POST /api/database/:dbId/table/:tableName/column/:columnName/tag
{ "name": "draft", "description": "Work in progress" }
```

#### Unregister a Tag Option
```http
DELETE /api/database/:dbId/table/:tableName/column/:columnName/tag
{ "tag": "draft" }
```

#### Set Column Regex Rule (custom type only)
```http
PATCH /api/database/:dbId/table/:tableName/column/:columnName/rule
{ "rule": "^[A-Z]{2,5}$" }
```

#### Copy a Column to Another Table
```http
POST /api/database/:dbId/table/:tableName/column/:columnName/copy
{
  "targetDbId": "other_db_id",      // optional, defaults to same db
  "targetTableName": "other_table", // required
  "targetColumnName": "new_name",   // optional, defaults to source name
  "overwrite": false                // optional
}
```
Copies both the column definition (metadata) and all row data.
Values are coerced when source and target types differ.

#### Delete a Column
```http
DELETE /api/database/:dbId/table/:tableName/column/:columnName
```

#### Set Visualization Hint
```http
PATCH /api/database/:dbId/table/:tableName/column/:columnName/visualization
{ "visualization": "progress" }
```
Free-form string the front end uses to decide how to render the column.
Examples: `"progress"`, `"stars"`, `"pill"`, `"color"`, `"avatar"`, `"bar"`, `""` (default).

#### Set tagLock Manually (tag columns only)
```http
PATCH /api/database/:dbId/table/:tableName/column/:columnName/taglock
{ "locked": true }
```
Cannot be used while the column is linked to a GlobalTagList — unlink first.

#### Link Column to a GlobalTagList (tag columns only)
```http
POST /api/database/:dbId/table/:tableName/column/:columnName/link
{ "listId": "entries_status_1762457963731" }
```
Sets `tagLock = true`, replaces `tags[]` with the list's values. Column tags are
read-only until unlinked.

#### Unlink Column from its GlobalTagList (tag columns only)
```http
POST /api/database/:dbId/table/:tableName/column/:columnName/unlink
```
Clears `linkedList`, resets `tagLock = false`. Tags remain as the last-synced values.

---

### GlobalTagList Endpoints  `/api/database/:dbId/taglist`

#### List All GlobalTagLists
```http
GET /api/database/:dbId/taglist
```

#### Get a Single GlobalTagList
```http
GET /api/database/:dbId/taglist/:listId
```

#### Sync a Column into a GlobalTagList (create or update)
```http
POST /api/database/:dbId/taglist/sync
{
  "tableName":  "entries",   // required
  "columnName": "status",    // required — must be string, single_tag, or multi_tag
  "name":       "Statuses"   // optional display name (kept on update if omitted)
}
```
- For `single_tag` / `multi_tag` columns: copies the registered tag names.
- For `string` columns: scans every row and collects unique non-null values.
- If a list already exists for the same table+column pair, it is updated in-place.
- Any tag columns currently linked to this list have their `tags[]` refreshed automatically.

#### Delete a GlobalTagList
```http
DELETE /api/database/:dbId/taglist/:listId
```
Any columns linked to this list are automatically unlinked before deletion.

---

### Row Endpoints  `/api/database/:dbId/table/:tableName/row`

#### Create a Row
```http
POST /api/database/:dbId/table/:tableName/row
{ "title": "My Entry", "content": "<p>Hello</p>" }
```

#### Get a Single Row
```http
GET /api/database/:dbId/table/:tableName/row/:rowId
```

#### Patch Row Data
```http
PATCH /api/database/:dbId/table/:tableName/row/:rowId
{ "content": "<p>Updated content</p>" }
```

#### Update Row Visibility
```http
PATCH /api/database/:dbId/table/:tableName/row/:rowId/visibility
{ "hidden": true }
```

#### Copy Rows to Another Table
```http
POST /api/database/:dbId/table/:tableName/row/copy
{
  "targetDbId": "other_db_id",      // optional
  "targetTableName": "other_table", // required
  "rowIds": [1, 2, 3],             // or "all"
  "columnMapping": [
    { "sourceColumn": "title",  "targetColumn": "title" },
    { "sourceColumn": "score",  "targetColumn": "value" }
  ]
}
```
See the `/mapping` endpoint below to generate `columnMapping` automatically.

#### Delete a Row
```http
DELETE /api/database/:dbId/table/:tableName/row/:rowId
```

---

### Column Mapping Endpoint

#### Get Suggested Column Mapping
```http
POST /api/database/:dbId/table/:tableName/mapping
{
  "targetDbId": "other_db_id",      // optional
  "targetTableName": "other_table", // required
  "overrides": {                    // optional manual pins
    "targetColumn": "sourceColumn"
  }
}
```

Returns a suggested mapping for every non-system target column:

```json
{
  "mapping": [
    {
      "targetColumn": "title",
      "targetType": "string",
      "sourceColumn": "title",
      "sourceType": "string",
      "compatibility": "exact"
    },
    {
      "targetColumn": "value",
      "targetType": "integer",
      "sourceColumn": "score",
      "sourceType": "float",
      "compatibility": "coerced",
      "notes": "Decimal part will be truncated."
    }
  ]
}
```

**Compatibility levels:**

| Level          | Meaning                                               |
|----------------|-------------------------------------------------------|
| `exact`        | Same column name and same type                        |
| `compatible`   | Same type, different name                             |
| `coerced`      | Different but safely convertible types                |
| `string_catch` | Target is `string` — accepts anything                 |
| `none`         | No compatible source column found                     |

The algorithm tries (in order): exact name+type → exact name+compatible type → fuzzy name match (Jaro-Winkler ≥ 0.85) → any compatible type → null.

---

### Rich-Text Import / Export  `/api/richtext`

All importers return TipTap-compatible HTML (`{ "html": "..." }`).  
All exporters accept `{ "html": "..." }` and return a file download.

#### Import Markdown
```http
POST /api/richtext/import/markdown
Content-Type: multipart/form-data
field "file": your .md file
```

#### Import RTF
```http
POST /api/richtext/import/rtf
Content-Type: multipart/form-data
field "file": your .rtf file
```

#### Import DOCX / Google Doc
```http
POST /api/richtext/import/docx
Content-Type: multipart/form-data
field "file": your .docx file
```
Google Docs → Download as Microsoft Word (.docx) → use this endpoint.

#### Export to Markdown
```http
POST /api/richtext/export/markdown
Content-Type: application/json
{ "html": "<p>Your TipTap content</p>" }
```
Returns a `text/markdown` file download (`export.md`).

#### Export to DOCX
```http
POST /api/richtext/export/docx
Content-Type: application/json
{ "html": "<p>Your TipTap content</p>" }
```
Returns a `.docx` file download compatible with Microsoft Word and Google Docs.

---

### Backup / Recovery Endpoints

#### Create a Backup
```http
POST /api/backup/:dbId
```

#### List All Backups
```http
GET /api/backups/retrieve
```

#### Recover a Backup
```http
POST /api/recover/:backupName
```
Restores the backup as a new database: `restored_{safeName}_{timestamp}`.

#### Delete a Backup
```http
DELETE /api/backup/:backupName
```

---

## Search & Sorting

The `GET /table/:tableName` endpoint supports Lucene-style search and sorting.

### Query (`q=`)

| Syntax              | Meaning                                          |
|---------------------|--------------------------------------------------|
| `test`              | `title` contains "test"                          |
| `title:test`        | column `title` contains "test"                   |
| `i2:test`           | column at index 2 contains "test"                |
| `alpha and beta`    | both terms in title                              |
| `alpha or beta`     | either term                                      |
| `!gamma`            | title does NOT contain "gamma"                   |
| `(a or b) and !c`   | grouping with parentheses                        |
| `title:"exact phrase"` | exact phrase search                          |

### Sort (`s=`)

| Syntax         | Meaning                  |
|----------------|--------------------------|
| `s=title:asc`  | alphabetical ascending   |
| `s=i2:desc`    | column index 2 descending|
| `s=rand`        | random order             |

### Pagination

| Parameter | Meaning               |
|-----------|-----------------------|
| `offset`  | Skip N rows           |
| `limit`   | Return at most N rows |

---

## Notes

- Six system columns are always present and cannot be modified.
- Tags must be registered on a column before they can be assigned to rows.
- Custom columns validate values against a per-column regex rule.
- Rich text is stored as HTML strings and displayed by TipTap on the front end.
- Renaming a database creates a new folder and removes the old one — the ID changes.
