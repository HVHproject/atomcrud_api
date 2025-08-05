import express from 'express';
import cors from 'cors';
import dataRouter from './routes/data'; // Adjust if path differs

const app = express();
app.use(cors());
app.use(express.json());

// MOUNT HERE
app.use('/api/data', dataRouter);

app.get('/', (req, res) => {
    res.send('API is running');
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
