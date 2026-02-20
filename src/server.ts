import dotenv from 'dotenv'
import app from './app';
import prisma from './dbConnection';
import { supabaseStorage } from './services/supabaseStorage.service';
import { startCleanupCron } from './cron/cleanupExpiredInvitations';
dotenv.config();

const PORT = process.env.PORT || 3003;

// 🔥 ROOT ROUTE (Render-safe)
app.get("/", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "Elevated Spaces Backend is running 🚀",
  });
});

app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);

  // Initialize Supabase bucket
  try {
    await supabaseStorage.initBucket();
    console.log('Supabase Storage initialized');
  } catch (err) {
    console.error('Failed to initialize Supabase Storage:', err);
  }

  // Test DB connection
  prisma.$connect()
    .then(() => console.log('Connected to PostgreSQL database'))
    .catch((err: any) => {
      console.error('Failed to connect to database:', err);
      process.exit(1);
    });

  // Start cron job for cleaning up expired invitations
  startCleanupCron();
});
