import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import entryRoutes from "./routes/entryRoutes";

dotenv.config();
const app = express();

app.use(cors());
app.use(express.json());
app.use("/api", entryRoutes);

mongoose.connect("mongodb://localhost:27017/atomcrud").then(() => {
    console.log("MongoDB connected");
    app.listen(5000, () => console.log("Server running on port 5000"));
});
