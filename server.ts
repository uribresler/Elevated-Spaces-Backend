
import app from './src/app';
import prisma from './src/dbConnection';
import { supabaseStorage } from './src/services/supabaseStorage.service';

const PORT = process.env.PORT || 3003;

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
});
