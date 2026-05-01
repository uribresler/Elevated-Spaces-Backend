import prisma from '../src/dbConnection';

type TimeResult = { current_time: Date };

async function testDB() {
  try {
    const result = await prisma.$queryRaw<TimeResult[]>`
      SELECT NOW() as current_time
    `;
    
    console.log("✅ Database connected successfully!");
    console.log("Current DB Time:", result[0].current_time);
  } catch (error) {
    console.error("❌ Database connection failed:");
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

testDB();