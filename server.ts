
import app from './src/app';
import prisma from './src/dbConnection';

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  // Test DB connection
  prisma.$connect()
    .then(() => console.log('Connected to PostgreSQL database'))
    .catch((err: any) => {
      console.error('Failed to connect to database:', err);
      process.exit(1);
    });
});
