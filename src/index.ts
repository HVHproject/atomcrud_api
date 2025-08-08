import express from 'express';
import cors from 'cors';
import dataRouter from './routes/database';
import tableRouter from './routes/table';
import columnRouter from './routes/column';


const app = express();
app.use(cors());
app.use(express.json());

// MOUNT HERE
app.use('/api/database', dataRouter);
app.use('/api/database', tableRouter);
app.use('/api/database', columnRouter);

app.get('/', (req, res) => {
    res.send('API is running');
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
