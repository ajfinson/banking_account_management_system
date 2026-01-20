import { Pool } from "pg";
import { randomUUID } from "crypto";
import { config as loadEnv } from "dotenv";

// Load environment variables from .env file
loadEnv();

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL environment variable is not set!");
  process.exit(1);
}

console.log("🔍 Starting PostgreSQL verification...\n");
console.log(`📍 Database URL: ${DATABASE_URL.replace(/:[^:@]+@/, ':****@')}\n`);

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

async function verifyPostgres() {
  try {
    // 1. Test basic connectivity
    console.log("1️⃣  Testing database connection...");
    const versionResult = await pool.query("SELECT version()");
    console.log("✅ Connected to PostgreSQL");
    console.log(`   Version: ${versionResult.rows[0].version.split(',')[0]}\n`);

    // 2. Check if tables exist
    console.log("2️⃣  Checking if tables exist...");
    const tablesResult = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    
    const tables = tablesResult.rows.map(r => r.table_name);
    console.log(`✅ Found ${tables.length} tables: ${tables.join(", ")}\n`);

    const requiredTables = ["person", "account", "transactions"];
    const missingTables = requiredTables.filter(t => !tables.includes(t));
    
    if (missingTables.length > 0) {
      console.error(`❌ Missing required tables: ${missingTables.join(", ")}`);
      console.log("\n💡 Run the schema.sql script to create tables:");
      console.log("   psql $DATABASE_URL < scripts/schema.sql\n");
      return;
    }

    // Check what columns exist in transactions table
    console.log("2b️⃣  Checking transactions table structure...");
    const columnsResult = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns 
      WHERE table_name = 'transactions'
      ORDER BY ordinal_position
    `);
    const columns = columnsResult.rows.map(r => `${r.column_name} (${r.data_type})`).join(", ");
    console.log(`   Columns: ${columns}\n`);

    // 3. Test CRUD operations
    console.log("3️⃣  Testing CRUD operations...\n");
    
    const testPersonId = `test-verify-${randomUUID()}`;
    let testAccountId: string | null = null;

    try {
      // Create a test person
      console.log("   📝 Creating test person...");
      await pool.query(
        "INSERT INTO person (person_id, full_name) VALUES ($1, $2)",
        [testPersonId, "Test Verification Person"]
      );
      console.log(`   ✅ Created person: ${testPersonId}`);

      // Create an account
      console.log("   📝 Creating test account...");
      const testAcctId = randomUUID();
      const accountResult = await pool.query(`
        INSERT INTO account (account_id, person_id, balance_cents, daily_withdrawal_limit_cents, account_type, active_flag, create_date)
        VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
        RETURNING account_id
      `, [testAcctId, testPersonId, 10000, 5000, "checking", true]);
      
      testAccountId = accountResult.rows[0].account_id;
      console.log(`   ✅ Created account: ${testAccountId}`);

      // Read the account
      console.log("   📝 Reading account...");
      const readResult = await pool.query(
        "SELECT * FROM account WHERE account_id = $1",
        [testAccountId]
      );
      console.log(`   ✅ Found account with balance: $${(readResult.rows[0].balance_cents / 100).toFixed(2)}`);

      // Create a deposit transaction
      console.log("   📝 Creating deposit transaction...");
      const depositId = randomUUID();
      const depositResult = await pool.query(`
        INSERT INTO transactions (transaction_id, account_id, value_cents, transaction_date)
        VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
        RETURNING transaction_id, value_cents
      `, [depositId, testAccountId, 2000]);
      console.log(`   ✅ Created deposit: $${(depositResult.rows[0].value_cents / 100).toFixed(2)}`);

      // Update account balance
      console.log("   📝 Updating account balance...");
      await pool.query(
        "UPDATE account SET balance_cents = $1 WHERE account_id = $2",
        [12000, testAccountId]
      );
      console.log(`   ✅ Updated balance to: $120.00`);

      // Create a withdrawal transaction
      console.log("   📝 Creating withdrawal transaction...");
      const withdrawId = randomUUID();
      const withdrawResult = await pool.query(`
        INSERT INTO transactions (transaction_id, account_id, value_cents, transaction_date)
        VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
        RETURNING transaction_id, value_cents
      `, [withdrawId, testAccountId, -500]);
      console.log(`   ✅ Created withdrawal: $${Math.abs(withdrawResult.rows[0].value_cents / 100).toFixed(2)}`);

      // Read transactions
      console.log("   📝 Reading transactions...");
      const txResult = await pool.query(
        "SELECT * FROM transactions WHERE account_id = $1 ORDER BY transaction_date DESC",
        [testAccountId]
      );
      console.log(`   ✅ Found ${txResult.rows.length} transactions`);

      // Test concurrent operations
      console.log("\n4️⃣  Testing concurrent operations...");
      const concurrentOps = await Promise.all([
        pool.query("SELECT COUNT(*) FROM account"),
        pool.query("SELECT COUNT(*) FROM transactions"),
        pool.query("SELECT COUNT(*) FROM person")
      ]);
      console.log(`   ✅ Accounts: ${concurrentOps[0].rows[0].count}`);
      console.log(`   ✅ Transactions: ${concurrentOps[1].rows[0].count}`);
      console.log(`   ✅ Persons: ${concurrentOps[2].rows[0].count}`);

      // Test query performance
      console.log("\n5️⃣  Testing query performance...");
      const start = Date.now();
      await pool.query(`
        SELECT 
          a.account_id,
          a.balance_cents,
          COUNT(t.transaction_id) as tx_count,
          SUM(CASE WHEN t.value_cents > 0 THEN t.value_cents ELSE 0 END) as total_deposits,
          SUM(CASE WHEN t.value_cents < 0 THEN ABS(t.value_cents) ELSE 0 END) as total_withdrawals
        FROM account a
        LEFT JOIN transactions t ON a.account_id = t.account_id
        WHERE a.account_id = $1
        GROUP BY a.account_id, a.balance_cents
      `, [testAccountId]);
      const elapsed = Date.now() - start;
      console.log(`   ✅ Complex query completed in ${elapsed}ms`);

      console.log("\n✅ All PostgreSQL operations completed successfully!\n");

    } finally {
      // Cleanup
      console.log("🧹 Cleaning up test data...");
      if (testAccountId) {
        await pool.query("DELETE FROM transactions WHERE account_id = $1", [testAccountId]);
        await pool.query("DELETE FROM account WHERE account_id = $1", [testAccountId]);
      }
      await pool.query("DELETE FROM person WHERE person_id = $1", [testPersonId]);
      console.log("✅ Cleanup complete\n");
    }

  } catch (error) {
    console.error("\n❌ Error during verification:", error);
    if (error instanceof Error) {
      console.error(`   Message: ${error.message}`);
      if ('code' in error) {
        console.error(`   Code: ${(error as any).code}`);
      }
    }
    process.exit(1);
  } finally {
    await pool.end();
  }
}

verifyPostgres()
  .then(() => {
    console.log("🎉 PostgreSQL verification complete!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("💥 Verification failed:", error);
    process.exit(1);
  });
