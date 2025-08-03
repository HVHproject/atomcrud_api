import mongoose from "mongoose";

const customFieldSchema = new mongoose.Schema({
    value: mongoose.Schema.Types.Mixed,
    type: {
        type: String,
        enum: ["rating", "date", "tag", "rich_text", "string", "number", "boolean"],
        required: true,
    }
}, { _id: false });

const entrySchema = new mongoose.Schema({
    title: String,
    content: String,
    date_created: Number,
    date_modified: Number,
    hidden: Boolean,
    custom_fields: {
        type: Map,
        of: customFieldSchema,
        default: {}
    }
});

const Entry = mongoose.model("Entry", entrySchema);
export default Entry;
