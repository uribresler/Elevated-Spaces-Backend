const prisma = require('./src/dbConnection').default;

async function main() {
  console.log('\n===== WEBHOOK EVENTS =====');
  const webhooks = await prisma.webhook_event.findMany({
    take: 10,
    orderBy: { created_at: 'desc' }
  });
  
  console.log(`Total Events: ${webhooks.length}`);
  webhooks.forEach(w => {
    console.log(`\nID: ${w.event_id}`);
    console.log(`Type: ${w.event_type}`);
    console.log(`Processed: ${w.processed}`);
    console.log(`Error: ${w.error_message || 'none'}`);
    console.log(`Created: ${w.created_at}`);
  });

  console.log('\n===== USER CREDIT PURCHASES =====');
  const purchases = await prisma.user_credit_purchase.findMany({
    take: 10,
    orderBy: { created_at: 'desc' },
    include: { package: true }
  });

  purchases.forEach(p => {
    console.log(`\nUser: ${p.user_id}`);
    console.log(`Amount: ${p.amount}`);
    console.log(`Status: ${p.status}`);
    console.log(`Completed: ${p.completed_at || 'pending'}`);
    console.log(`Session: ${p.stripe_session_id}`);
  });

  console.log('\n===== USER CREDIT BALANCE =====');
  const balances = await prisma.user_credit_balance.findMany({ take: 5 });
  balances.forEach(b => {
    console.log(`User ${b.user_id}: ${b.balance} credits`);
  });

  await prisma.$disconnect();
}

main().catch(console.error);
