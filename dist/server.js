"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const app_1 = __importDefault(require("./app"));
const dbConnection_1 = __importDefault(require("./dbConnection"));
const supabaseStorage_service_1 = require("./services/supabaseStorage.service");
dotenv_1.default.config();
const PORT = process.env.PORT || 3003;
app_1.default.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    // Initialize Supabase bucket
    try {
        await supabaseStorage_service_1.supabaseStorage.initBucket();
        console.log('Supabase Storage initialized');
    }
    catch (err) {
        console.error('Failed to initialize Supabase Storage:', err);
    }
    // Test DB connection
    dbConnection_1.default.$connect()
        .then(() => console.log('Connected to PostgreSQL database'))
        .catch((err) => {
        console.error('Failed to connect to database:', err);
        process.exit(1);
    });
});
