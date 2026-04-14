/**
 * Integration tests for the AtomCRUD backend API.
 *
 * Tests run sequentially in a single fork so that database state created in
 * one describe block can be reused in the next without conflicts.
 *
 * The setup file (setup.ts) redirects DB_FOLDER and BACKUP_FOLDER to a temp
 * directory before any module loads, so production data is never touched.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../app';

// ─────────────────────────────────────────────────────────────────────────────
// Shared state — populated as tests run
// ─────────────────────────────────────────────────────────────────────────────
let dbId = '';       // created in the Database suite
let db2Id = '';      // second database for cross-db tests
let backupName = ''; // created in the Recovery suite

// ─────────────────────────────────────────────────────────────────────────────
// 1. Database endpoints
// ─────────────────────────────────────────────────────────────────────────────
describe('Database endpoints', () => {
    it('POST /api/database — creates a database', async () => {
        const res = await request(app)
            .post('/api/database')
            .send({ name: 'test_db' });

        expect(res.status).toBe(201);
        expect(res.body).toHaveProperty('id');
        dbId = res.body.id;
    });

    it('POST /api/database — creates a second database for cross-db tests', async () => {
        const res = await request(app)
            .post('/api/database')
            .send({ name: 'test_db_two' });

        expect(res.status).toBe(201);
        db2Id = res.body.id;
    });

    it('POST /api/database — 400 on missing name', async () => {
        const res = await request(app).post('/api/database').send({});
        expect(res.status).toBe(400);
    });

    it('GET /api/database — lists databases', async () => {
        const res = await request(app).get('/api/database');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.some((d: any) => d.id === dbId)).toBe(true);
    });

    it('GET /api/database/:dbId — returns database metadata', async () => {
        const res = await request(app).get(`/api/database/${dbId}`);
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('tables');
    });

    it('GET /api/database/:dbId — 404 on unknown id', async () => {
        const res = await request(app).get('/api/database/nonexistent_9999999999');
        expect(res.status).toBe(404);
    });

    it('PUT /api/database/:dbId — renames database', async () => {
        const res = await request(app)
            .put(`/api/database/${dbId}`)
            .send({ newName: 'renamed_db' });

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('newId');
        dbId = res.body.newId; // update shared id
    });

    it('PUT /api/database/:dbId — 400 on missing newName', async () => {
        const res = await request(app).put(`/api/database/${dbId}`).send({});
        expect(res.status).toBe(400);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Table endpoints
// ─────────────────────────────────────────────────────────────────────────────
describe('Table endpoints', () => {
    it('POST /api/database/:dbId/table — creates a table', async () => {
        // Note: createDatabase already seeds an 'entries' table; use a different name
        const res = await request(app)
            .post(`/api/database/${dbId}/table`)
            .send({ tableName: 'notes' });

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
    });

    it('POST /api/database/:dbId/table — 500 on duplicate table', async () => {
        const res = await request(app)
            .post(`/api/database/${dbId}/table`)
            .send({ tableName: 'notes' });

        expect(res.status).toBe(500); // createTable throws, route returns 500
    });

    it('GET /api/database/:dbId/table/:tableName — returns table rows', async () => {
        const res = await request(app).get(`/api/database/${dbId}/table/notes`);
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('rows');
        expect(Array.isArray(res.body.rows)).toBe(true);
    });

    it('PATCH /api/database/:dbId/table/:tableName — renames table', async () => {
        const res = await request(app)
            .patch(`/api/database/${dbId}/table/notes`)
            .send({ newName: 'items' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('PATCH /api/database/:dbId/table/:tableName/visibility — hides table', async () => {
        const res = await request(app)
            .patch(`/api/database/${dbId}/table/items/visibility`)
            .send({ hidden: true });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('PATCH .../visibility — unhides table', async () => {
        const res = await request(app)
            .patch(`/api/database/${dbId}/table/items/visibility`)
            .send({ hidden: false });

        expect(res.status).toBe(200);
    });

    it('PATCH .../visibility — 400 on non-boolean', async () => {
        const res = await request(app)
            .patch(`/api/database/${dbId}/table/items/visibility`)
            .send({ hidden: 'yes' });

        expect(res.status).toBe(400);
    });

    it('POST .../copy — copies table within same db', async () => {
        const res = await request(app)
            .post(`/api/database/${dbId}/table/items/copy`)
            .send({ newTableName: 'items_copy' });

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
    });

    it('DELETE /api/database/:dbId/table/:tableName — deletes table', async () => {
        const res = await request(app)
            .delete(`/api/database/${dbId}/table/items_copy`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Column endpoints
// ─────────────────────────────────────────────────────────────────────────────
describe('Column endpoints', () => {
    it('POST .../column — creates a string column', async () => {
        const res = await request(app)
            .post(`/api/database/${dbId}/table/items/column`)
            .send({ name: 'author', type: 'string' });

        expect(res.status).toBe(201);
        expect(res.body).toHaveProperty('name', 'author');
    });

    it('POST .../column — creates a rating column', async () => {
        const res = await request(app)
            .post(`/api/database/${dbId}/table/items/column`)
            .send({ name: 'score', type: 'rating' });

        expect(res.status).toBe(201);
    });

    it('POST .../column — creates a single_tag column', async () => {
        const res = await request(app)
            .post(`/api/database/${dbId}/table/items/column`)
            .send({ name: 'status', type: 'single_tag' });

        expect(res.status).toBe(201);
        expect(res.body).toHaveProperty('tagLock', false);
        expect(res.body).toHaveProperty('linkedList', '');
    });

    it('POST .../column — 400 on missing name', async () => {
        const res = await request(app)
            .post(`/api/database/${dbId}/table/items/column`)
            .send({ type: 'string' });

        expect(res.status).toBe(400);
    });

    it('GET .../columns — lists all columns', async () => {
        const res = await request(app).get(`/api/database/${dbId}/table/items/columns`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        const names = res.body.map((c: any) => c.name);
        expect(names).toContain('author');
        expect(names).toContain('score');
        expect(names).toContain('status');
    });

    it('GET .../column/:columnName — returns a single column', async () => {
        const res = await request(app).get(`/api/database/${dbId}/table/items/column/author`);
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('type', 'string');
    });

    it('PATCH .../column/:columnName — renames column', async () => {
        const res = await request(app)
            .patch(`/api/database/${dbId}/table/items/column/author`)
            .send({ newName: 'writer' });

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('name', 'writer');
    });

    it('PATCH .../column/:columnName/visibility — hides column', async () => {
        const res = await request(app)
            .patch(`/api/database/${dbId}/table/items/column/writer/visibility`)
            .send({ hidden: true });

        expect(res.status).toBe(200);
        expect(res.body.hidden).toBe(true);
    });

    it('PATCH .../column/:columnName/swap — swaps column indices', async () => {
        // score is at some index; swap with another
        const colsRes = await request(app).get(`/api/database/${dbId}/table/items/columns`);
        const score = colsRes.body.find((c: any) => c.name === 'score');
        const writer = colsRes.body.find((c: any) => c.name === 'writer');

        if (score && writer) {
            const res = await request(app)
                .patch(`/api/database/${dbId}/table/items/column/score/swap`)
                .send({ targetIndex: writer.index });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        }
    });

    it('PATCH .../column/:columnName/move — moves column to index', async () => {
        const res = await request(app)
            .patch(`/api/database/${dbId}/table/items/column/score/move`)
            .send({ newIndex: 2 });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('POST .../column/:columnName/tag — registers a tag', async () => {
        const res = await request(app)
            .post(`/api/database/${dbId}/table/items/column/status/tag`)
            .send({ name: 'draft', description: 'Work in progress' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('POST .../tag — registers a second tag', async () => {
        const res = await request(app)
            .post(`/api/database/${dbId}/table/items/column/status/tag`)
            .send({ name: 'published' });

        expect(res.status).toBe(200);
    });

    it('POST .../tag — 400 on duplicate tag', async () => {
        const res = await request(app)
            .post(`/api/database/${dbId}/table/items/column/status/tag`)
            .send({ name: 'draft' });

        expect(res.status).toBe(400);
    });

    it('POST .../tag — 400 on missing name', async () => {
        const res = await request(app)
            .post(`/api/database/${dbId}/table/items/column/status/tag`)
            .send({});

        expect(res.status).toBe(400);
    });

    it('DELETE .../tag — unregisters a tag', async () => {
        const res = await request(app)
            .delete(`/api/database/${dbId}/table/items/column/status/tag`)
            .send({ tag: 'published' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('PATCH .../visualization — sets visualization hint', async () => {
        const res = await request(app)
            .patch(`/api/database/${dbId}/table/items/column/score/visualization`)
            .send({ visualization: 'stars' });

        expect(res.status).toBe(200);
        expect(res.body.column).toHaveProperty('visualization', 'stars');
    });

    it('PATCH .../taglock — manually locks a tag column', async () => {
        const res = await request(app)
            .patch(`/api/database/${dbId}/table/items/column/status/taglock`)
            .send({ locked: true });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('PATCH .../taglock — unlocks a tag column', async () => {
        const res = await request(app)
            .patch(`/api/database/${dbId}/table/items/column/status/taglock`)
            .send({ locked: false });

        expect(res.status).toBe(200);
    });

    it('PATCH .../taglock — 400 on non-boolean', async () => {
        const res = await request(app)
            .patch(`/api/database/${dbId}/table/items/column/status/taglock`)
            .send({ locked: 1 });

        expect(res.status).toBe(400);
    });

    it('POST .../column — creates a custom column', async () => {
        const res = await request(app)
            .post(`/api/database/${dbId}/table/items/column`)
            .send({ name: 'code', type: 'custom' });

        expect(res.status).toBe(201);
    });

    it('PATCH .../rule — sets regex rule on custom column', async () => {
        const res = await request(app)
            .patch(`/api/database/${dbId}/table/items/column/code/rule`)
            .send({ rule: '^[A-Z]{2,5}$' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('DELETE .../column/:columnName — deletes column', async () => {
        const res = await request(app)
            .delete(`/api/database/${dbId}/table/items/column/code`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Row endpoints
// ─────────────────────────────────────────────────────────────────────────────
let rowId = 0;

describe('Row endpoints', () => {
    it('POST .../row — creates a row', async () => {
        const res = await request(app)
            .post(`/api/database/${dbId}/table/items/row`)
            .send({ title: 'First Entry', content: '<p>Hello World</p>' });

        expect(res.status).toBe(201);
        expect(res.body).toHaveProperty('id');
        rowId = res.body.id;
    });

    it('POST .../row — creates a second row (for search/sort tests)', async () => {
        const res = await request(app)
            .post(`/api/database/${dbId}/table/items/row`)
            .send({ title: 'Alpha Entry', content: '<p>Alpha content</p>' });

        expect(res.status).toBe(201);
    });

    it('POST .../row — creates a third row', async () => {
        const res = await request(app)
            .post(`/api/database/${dbId}/table/items/row`)
            .send({ title: 'Beta Entry', content: '<p>Beta content</p>' });

        expect(res.status).toBe(201);
    });

    it('POST .../row — 400 on missing title', async () => {
        const res = await request(app)
            .post(`/api/database/${dbId}/table/items/row`)
            .send({ content: '<p>Oops</p>' });

        expect(res.status).toBe(400);
    });

    it('GET .../row/:rowId — gets a single row', async () => {
        const res = await request(app).get(`/api/database/${dbId}/table/items/row/${rowId}`);
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('id', rowId);
        expect(res.body).toHaveProperty('title', 'First Entry');
    });

    it('PATCH .../row/:rowId — updates row data', async () => {
        const res = await request(app)
            .patch(`/api/database/${dbId}/table/items/row/${rowId}`)
            .send({ title: 'First Entry (edited)' });

        expect(res.status).toBe(200);
        expect(res.body.title).toBe('First Entry (edited)');
    });

    it('PATCH .../row/:rowId — 400 when patching protected fields', async () => {
        const res = await request(app)
            .patch(`/api/database/${dbId}/table/items/row/${rowId}`)
            .send({ id: 99 });

        expect(res.status).toBe(400);
    });

    it('PATCH .../row/:rowId/visibility — hides a row', async () => {
        const res = await request(app)
            .patch(`/api/database/${dbId}/table/items/row/${rowId}/visibility`)
            .send({ hidden: true });

        expect(res.status).toBe(200);
        expect(res.body.hidden).toBe(1);
    });

    it('PATCH .../visibility — unhides row', async () => {
        const res = await request(app)
            .patch(`/api/database/${dbId}/table/items/row/${rowId}/visibility`)
            .send({ hidden: false });

        expect(res.status).toBe(200);
        expect(res.body.hidden).toBe(0);
    });

    it('GET table — pagination works (limit + offset)', async () => {
        const res = await request(app)
            .get(`/api/database/${dbId}/table/items?limit=1&offset=0`);

        expect(res.status).toBe(200);
        expect(res.body.rows).toHaveLength(1);
        expect(res.body.totalRows).toBeGreaterThanOrEqual(3);
    });

    it('GET table — search by title (simple term)', async () => {
        const res = await request(app)
            .get(`/api/database/${dbId}/table/items?q=Alpha`);

        expect(res.status).toBe(200);
        expect(res.body.rows.some((r: any) => r.title.includes('Alpha'))).toBe(true);
    });

    it('GET table — search with AND operator', async () => {
        const res = await request(app)
            .get(`/api/database/${dbId}/table/items?q=First and edited`);

        expect(res.status).toBe(200);
        expect(res.body.rows.some((r: any) => r.title.includes('edited'))).toBe(true);
    });

    it('GET table — search with negation', async () => {
        const res = await request(app)
            .get(`/api/database/${dbId}/table/items?q=!Alpha`);

        expect(res.status).toBe(200);
        expect(res.body.rows.every((r: any) => !r.title.includes('Alpha'))).toBe(true);
    });

    it('GET table — sort by title ascending', async () => {
        const res = await request(app)
            .get(`/api/database/${dbId}/table/items?s=title:asc`);

        expect(res.status).toBe(200);
        const titles = res.body.rows.map((r: any) => r.title);
        const sorted = [...titles].sort();
        expect(titles).toEqual(sorted);
    });

    it('GET table — hidden=false filters out hidden rows', async () => {
        // Hide the first row
        await request(app)
            .patch(`/api/database/${dbId}/table/items/row/${rowId}/visibility`)
            .send({ hidden: true });

        const res = await request(app)
            .get(`/api/database/${dbId}/table/items?hidden=false`);

        expect(res.status).toBe(200);
        expect(res.body.rows.every((r: any) => r.hidden === 0)).toBe(true);

        // Unhide for later tests
        await request(app)
            .patch(`/api/database/${dbId}/table/items/row/${rowId}/visibility`)
            .send({ hidden: false });
    });

    it('DELETE .../row/:rowId — deletes a row', async () => {
        // Create a throwaway row to delete
        const createRes = await request(app)
            .post(`/api/database/${dbId}/table/items/row`)
            .send({ title: 'Delete Me', content: '<p>bye</p>' });

        const throwawayId = createRes.body.id;

        const res = await request(app)
            .delete(`/api/database/${dbId}/table/items/row/${throwawayId}`);

        expect(res.status).toBe(204);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Transfer endpoints (mapping, row copy, column copy)
// ─────────────────────────────────────────────────────────────────────────────
describe('Transfer endpoints', () => {
    beforeAll(async () => {
        // Create a second table to copy into
        await request(app)
            .post(`/api/database/${dbId}/table`)
            .send({ tableName: 'items_target' });

        // Add a matching column to the target table
        await request(app)
            .post(`/api/database/${dbId}/table/items_target/column`)
            .send({ name: 'writer', type: 'string' });
    });

    it('POST .../mapping — suggests column mapping', async () => {
        const res = await request(app)
            .post(`/api/database/${dbId}/table/items/mapping`)
            .send({ targetTableName: 'items_target' });

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('mapping');
        expect(Array.isArray(res.body.mapping)).toBe(true);
    });

    it('POST .../mapping — 400 on missing targetTableName', async () => {
        const res = await request(app)
            .post(`/api/database/${dbId}/table/items/mapping`)
            .send({});

        expect(res.status).toBe(400);
    });

    it('POST .../row/copy — copies rows to another table', async () => {
        const res = await request(app)
            .post(`/api/database/${dbId}/table/items/row/copy`)
            .send({
                targetTableName: 'items_target',
                rowIds: 'all',
                columnMapping: [
                    { sourceColumn: 'title', targetColumn: 'title' },
                    { sourceColumn: 'content', targetColumn: 'content' },
                ],
            });

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('copied');
        expect(res.body.copied).toBeGreaterThan(0);
    });

    it('POST .../row/copy — 400 on missing columnMapping', async () => {
        const res = await request(app)
            .post(`/api/database/${dbId}/table/items/row/copy`)
            .send({ targetTableName: 'items_target', rowIds: 'all' });

        expect(res.status).toBe(400);
    });

    it('POST .../column/:col/copy — copies column to another table', async () => {
        const res = await request(app)
            .post(`/api/database/${dbId}/table/items/column/score/copy`)
            .send({ targetTableName: 'items_target', targetColumnName: 'score_copy' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('POST .../column/:col/copy — 400 on missing targetTableName', async () => {
        const res = await request(app)
            .post(`/api/database/${dbId}/table/items/column/score/copy`)
            .send({});

        expect(res.status).toBe(400);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. GlobalTagList endpoints
// ─────────────────────────────────────────────────────────────────────────────
let tagListId = '';

describe('GlobalTagList endpoints', () => {
    it('POST .../taglist/sync — creates a GlobalTagList from single_tag column', async () => {
        const res = await request(app)
            .post(`/api/database/${dbId}/taglist/sync`)
            .send({ tableName: 'items', columnName: 'status', name: 'Item Statuses' });

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('list');
        expect(res.body.list).toHaveProperty('id');
        tagListId = res.body.list.id;
    });

    it('POST .../taglist/sync — 400 on missing tableName', async () => {
        const res = await request(app)
            .post(`/api/database/${dbId}/taglist/sync`)
            .send({ columnName: 'status' });

        expect(res.status).toBe(400);
    });

    it('GET .../taglist — lists all GlobalTagLists', async () => {
        const res = await request(app).get(`/api/database/${dbId}/taglist`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.lists)).toBe(true);
        expect(res.body.lists.some((l: any) => l.id === tagListId)).toBe(true);
    });

    it('GET .../taglist/:listId — returns a single list', async () => {
        const res = await request(app).get(`/api/database/${dbId}/taglist/${tagListId}`);
        expect(res.status).toBe(200);
        expect(res.body.list).toHaveProperty('id', tagListId);
        expect(res.body.list).toHaveProperty('name', 'Item Statuses');
    });

    it('GET .../taglist/:listId — 404 on unknown id', async () => {
        const res = await request(app).get(`/api/database/${dbId}/taglist/nonexistent`);
        expect(res.status).toBe(404);
    });

    it('POST .../column/:col/link — links column to GlobalTagList', async () => {
        // First add a multi_tag column in items_target to link
        await request(app)
            .post(`/api/database/${dbId}/table/items_target/column`)
            .send({ name: 'category', type: 'multi_tag' });

        const res = await request(app)
            .post(`/api/database/${dbId}/table/items_target/column/category/link`)
            .send({ listId: tagListId });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('POST .../column/:col/link — 400 on missing listId', async () => {
        const res = await request(app)
            .post(`/api/database/${dbId}/table/items_target/column/category/link`)
            .send({});

        expect(res.status).toBe(400);
    });

    it('PATCH .../taglock — 500 when column is linked (cannot manually change lock)', async () => {
        const res = await request(app)
            .patch(`/api/database/${dbId}/table/items_target/column/category/taglock`)
            .send({ locked: false });

        // Should throw because column has linkedList set
        expect(res.status).toBe(500);
    });

    it('POST .../column/:col/unlink — unlinks column from GlobalTagList', async () => {
        const res = await request(app)
            .post(`/api/database/${dbId}/table/items_target/column/category/unlink`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('DELETE .../taglist/:listId — deletes a GlobalTagList', async () => {
        const res = await request(app)
            .delete(`/api/database/${dbId}/taglist/${tagListId}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Rich text import / export
// ─────────────────────────────────────────────────────────────────────────────
describe('Rich text endpoints', () => {
    it('POST /api/richtext/import/markdown — converts markdown to HTML', async () => {
        const md = '# Hello\n\nThis is **bold** text.';
        const res = await request(app)
            .post('/api/richtext/import/markdown')
            .attach('file', Buffer.from(md), { filename: 'test.md', contentType: 'text/markdown' });

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('html');
        expect(res.body.html).toContain('Hello');
        expect(res.body.html).toContain('bold');
    });

    it('POST /api/richtext/import/markdown — 400 on missing file', async () => {
        const res = await request(app)
            .post('/api/richtext/import/markdown');

        expect(res.status).toBe(400);
    });

    it('POST /api/richtext/export/markdown — converts HTML to markdown file', async () => {
        const res = await request(app)
            .post('/api/richtext/export/markdown')
            .send({ html: '<h1>Hello</h1><p>World</p>' });

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/text\/markdown/);
        expect(res.text).toContain('Hello');
    });

    it('POST /api/richtext/export/markdown — 400 on missing html', async () => {
        const res = await request(app)
            .post('/api/richtext/export/markdown')
            .send({});

        expect(res.status).toBe(400);
    });

    it('POST /api/richtext/export/docx — exports HTML as DOCX buffer', async () => {
        const res = await request(app)
            .post('/api/richtext/export/docx')
            .send({ html: '<p>Hello World</p>' });

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/application\/vnd.openxmlformats/);
    });

    it('POST /api/richtext/import/rtf — converts RTF to HTML', async () => {
        // Minimal valid RTF
        const rtf = '{\\rtf1\\ansi Hello \\b World\\b0}';
        const res = await request(app)
            .post('/api/richtext/import/rtf')
            .attach('file', Buffer.from(rtf), { filename: 'test.rtf', contentType: 'text/rtf' });

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('html');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Backup / Recovery endpoints
// ─────────────────────────────────────────────────────────────────────────────
describe('Recovery endpoints', () => {
    it('POST /api/database/backup/:dbId — creates a backup', async () => {
        const res = await request(app).post(`/api/database/backup/${dbId}`);
        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body).toHaveProperty('backupName');
        backupName = res.body.backupName;
    });

    it('GET /api/database/backups/retrieve — lists backups', async () => {
        const res = await request(app).get('/api/database/backups/retrieve');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.backups)).toBe(true);
        // backups is a string[] of folder names
        expect(res.body.backups.includes(backupName)).toBe(true);
    });

    it('POST /api/database/recover/:backupName — recovers a backup as new db', async () => {
        const res = await request(app).post(`/api/database/recover/${backupName}`);
        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body).toHaveProperty('newName');

        // Clean up recovered db
        await request(app).delete(`/api/database/${res.body.newName}`);
    });

    it('POST /recover/:backupName — 400 on nonexistent backup', async () => {
        const res = await request(app).post('/api/database/recover/backup_nonexistent_9999999');
        expect(res.status).toBe(400);
    });

    it('DELETE /api/database/backup/:backupName — deletes a backup', async () => {
        const res = await request(app).delete(`/api/database/backup/${backupName}`);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('DELETE backup — 404 on nonexistent backup', async () => {
        const res = await request(app).delete('/api/database/backup/backup_nonexistent_9999999');
        expect(res.status).toBe(404);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Cleanup — delete the test databases
// ─────────────────────────────────────────────────────────────────────────────
describe('Cleanup', () => {
    it('DELETE /api/database/:dbId — deletes the first test database', async () => {
        const res = await request(app).delete(`/api/database/${dbId}`);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('DELETE /api/database/:dbId — deletes the second test database', async () => {
        const res = await request(app).delete(`/api/database/${db2Id}`);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });
});
