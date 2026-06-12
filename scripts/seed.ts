import { main } from '../src/scripts/seed.shared';

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
