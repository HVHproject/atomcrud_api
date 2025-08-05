import express from 'express';
import cors from 'cors';
import dataRouter from './routes/data';

const app = express();
const PORT = 4000;

app.use(cors());
app.use(express.json());

app.use('/api/data', dataRouter);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
