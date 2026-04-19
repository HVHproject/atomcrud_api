import express from 'express';
import cors from 'cors';
import dataRouter from './routes/database';
import tableRouter from './routes/table';
import columnRouter from './routes/column';
import rowRouter from './routes/row';
import recoveryRouter from './routes/recovery';
import richTextRouter from './routes/richtext';
import transferRouter from './routes/transfer';
import tagListRouter from './routes/taglist';
import galleryRouter from './routes/gallery';

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

app.use('/api/database', dataRouter);
app.use('/api/database', tableRouter);
app.use('/api/database', columnRouter);
app.use('/api/database', rowRouter);
app.use('/api/database', recoveryRouter);
app.use('/api/database', transferRouter);
app.use('/api/database', tagListRouter);
app.use('/api/database', galleryRouter);
app.use('/api/richtext', richTextRouter);

app.get('/', (_req, res) => {
    res.send('API is running');
});

export default app;
