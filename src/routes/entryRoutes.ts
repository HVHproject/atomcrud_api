import express from "express";
import Entry from "../models/Entry";

const router = express.Router();

router.post("/entries", async (req, res) => {
    const { title, content, hidden, custom_fields } = req.body;

    const now = Math.floor(Date.now() / 1000); // UNIX timestamp

    try {
        const entry = new Entry({
            title,
            content,
            hidden,
            custom_fields,
            date_created: now,
            date_modified: now
        });

        await entry.save();
        res.status(201).json(entry);
    } catch (err) {
        res.status(400).json({ error: (err as Error).message });
    }
});

export default router;
