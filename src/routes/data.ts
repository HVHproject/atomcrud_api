import express from 'express';
const router = express.Router();

// Sample route
router.get('/', (req, res) => {
    res.json({ message: 'Hello from data router' });
});

export default router;
