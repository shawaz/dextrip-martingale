const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
async function main() {
  const trades = await sql`SELECT * FROM trades WHERE trade_mode = 'paper' ORDER BY created_at DESC LIMIT 10`;
  const wins = await sql`SELECT COUNT(*) as c FROM trades WHERE trade_mode = 'paper' AND result = 'won'`;
  const losses = await sql`SELECT COUNT(*) as c FROM trades WHERE trade_mode = 'paper' AND result = 'loss'`;
  const pending = await sql`SELECT COUNT(*) as c FROM trades WHERE trade_mode = 'paper' AND result = 'pending'`;
  const pnl = await sql`SELECT SUM(pnl) as total FROM trades WHERE trade_mode = 'paper' AND result != 'pending'`;
  console.log('RECENT_TRADES:', JSON.stringify(trades));
  console.log('STATS:', JSON.stringify({wins: wins[0].c, losses: losses[0].c, pending: pending[0].c, pnl: pnl[0].total}));
}
main().catch(console.error);
