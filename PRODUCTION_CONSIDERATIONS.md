# 🚨 CRITICAL PRODUCTION CONSIDERATIONS

## ⚠️ Known Limitations & Warnings

### 🌍 **TIMEZONE HANDLING**
**CRITICAL:** Daily withdrawal limits reset at **midnight UTC**, NOT user local time.

**Impact:**
- User in California (UTC-8): Limit resets at 4 PM local time (not midnight)
- User in Tokyo (UTC+9): Limit resets at 9 AM local time (not midnight)

**Why:** The system uses `transaction_date::date` for date comparison, which extracts the UTC date.

**Workarounds:**
1. Document this behavior clearly to users
2. Consider user timezone or account timezone for limit calculation
3. Store `user_timezone` column and adjust queries accordingly

**Code Location:** [service.ts#L127-129](src/modules/accounts/service.ts#L127-129)

---

### 🔄 **MULTI-PROCESS MEMORY MODE**
**CRITICAL:** In-memory mutex only works in **single-process mode**.

**Fails In:**
- Node.js cluster mode (PM2, cluster module)
- Multiple Docker containers
- Kubernetes with replicas > 1
- Serverless with concurrent invocations

**Why:** Mutexes are stored in JavaScript memory, not shared across processes.

**Solution:** 
- Use `REPO_PROVIDER=postgres` for multi-process deployments
- OR implement Redis-based distributed locking for memory mode

**Code Location:** [mutex.ts](src/infra/memory/mutex.ts)

---

### 💰 **MAXIMUM BALANCE LIMITS**
**JavaScript MAX_SAFE_INTEGER:** `9,007,199,254,740,991` cents = **$90 trillion**

**Database constraints in schema.sql** prevent:
- Balance overflow
- Precision loss when reading from database
- Integer overflow in calculations

**What happens if exceeded:**
- Database rejects the transaction (CHECK constraint violation)
- Returns 500 error (not ideal - should return specific error)

**Recommendation:** Add application-level check before overflow and return `BALANCE_LIMIT_EXCEEDED` error.

---

### 🔐 **NO AUTHENTICATION OR AUTHORIZATION**
**CRITICAL SECURITY ISSUE:** Anyone can access any account.

**Missing:**
- User authentication (JWT, OAuth, etc.)
- Account ownership validation
- Audit trail of WHO performed actions
- Rate limiting per user (currently global)

**Status:** Out of scope for this implementation, **MUST BE ADDED BEFORE PRODUCTION**.

---

### 📊 **STATEMENT QUERY PERFORMANCE**
**Inefficiency:** Opening balance calculation scans **ALL prior transactions** every time.

**Example:**
- Account created 5 years ago
- Has 1 million transactions
- User requests statement for yesterday
- System sums ALL 1 million prior transactions to get opening balance

**Solutions:**
1. Store `running_balance` in account table (updated with each transaction)
2. Use materialized views for historical balances
3. Cache daily opening balances

**Code Location:** [service.ts#L154-157](src/modules/accounts/service.ts#L154-157)

---

## ✅ **FIXES APPLIED (From Critical Review)**

### 1. ✅ **Idempotency Returns Correct Balance**
**Problem:** Duplicate requests returned CURRENT balance, not balance after THAT transaction.

**Fix:** Added `balance_after` column to transactions table. Duplicate requests now return the historical balance from when that transaction was applied.

**Code:** [schemas.sql](scripts/schema.sql)

---

### 2. ✅ **Proper Date Validation**
**Problem:** Regex-only validation allowed invalid dates like `2024-99-99`.

**Fix:** Added `.transform()` with actual date parsing to validate dates are real calendar dates.

**Code:** [schemas.ts](src/modules/accounts/schemas.ts)

---

### 3. ✅ **Request Size Limits**
**Problem:** No protection against huge payloads causing OOM.

**Fix:** Added `bodyLimit: 1MB` and `maxParamLength: 500` to Fastify config.

**Code:** [app.ts](src/app.ts)

---

### 4. ✅ **Idempotency Key Validation**
**Problem:** No format or length validation on idempotency keys.

**Fix:** Added Zod schema with max 255 characters.

**Code:** [schemas.ts](src/modules/accounts/schemas.ts), [routes.ts](src/modules/accounts/routes.ts)

---

### 5. ✅ **Database Health Check on Startup**
**Problem:** Server started even if database was down, failing on first request.

**Fix:** Added startup health check that exits if database unreachable.

**Code:** [server.ts](src/server.ts)

---

### 6. ✅ **Statement Query Index Optimization**
**Problem:** Query used `ORDER BY ASC` but index was `DESC`, causing inefficient backward scan.

**Fix:** Query now uses `ORDER BY DESC` to match index, then reverses in application.

**Code:** [postgresTransactionsRepo.ts](src/infra/postgres/postgresTransactionsRepo.ts)

---

### 7. ✅ **MAX_SAFE_INTEGER Database Constraints**
**Problem:** BIGINT in Postgres could exceed JavaScript safe integer range, causing precision loss.

**Fix:** Added CHECK constraints on all monetary columns to enforce `<= 9007199254740991`.

**Code:** [schema.sql](scripts/schema.sql)

---

### 8. ✅ **Account Status Enhancement**
**Problem:** `activeFlag` confused "blocked" with "closed". No proper closure mechanism.

**Fix:** Added `account_status` enum ('ACTIVE', 'BLOCKED', 'CLOSED') and `closed_date` column.

**Schema:** [schema.sql](scripts/schema.sql)

---

## 🔧 **DATABASE SETUP**

The [schema.sql](scripts/schema.sql) includes all fixes and constraints. Simply run:

```bash
psql -U postgres -d bank -f scripts/schema.sql
psql -U postgres -d bank -f scripts/seed.sql
```

**No migrations needed** - this is educational code with no production deployments.

---

## 🚀 **BEFORE DEPLOYING TO PRODUCTION**

### **Absolute Requirements:**
- [ ] Add authentication and authorization
- [ ] Add monitoring and alerting (Prometheus, DataDog, etc.)
- [ ] Add proper logging with correlation IDs
- [ ] Load test to find breaking points
- [ ] Security audit and penetration testing
- [ ] Implement circuit breakers for database failures
- [ ] Add caching layer (Redis) for frequently accessed data
- [ ] Set up database backups and disaster recovery
- [ ] Document API with realistic examples
- [ ] Create runbooks for common operational issues

### **Highly Recommended:**
- [ ] Add distributed tracing (OpenTelemetry, Jaeger)
- [ ] Implement graceful shutdown
- [ ] Add database connection pool tuning
- [ ] Add request timeout configurations
- [ ] Implement rate limiting per user (not just global)
- [ ] Add database query performance monitoring
- [ ] Create alerting for high error rates
- [ ] Add health check for all dependencies
- [ ] Implement feature flags for gradual rollouts
- [ ] Add API versioning strategy

### **Nice to Have:**
- [ ] GraphQL endpoint option
- [ ] Webhook support for account events
- [ ] Scheduled reports (daily balances, monthly statements)
- [ ] Multi-currency support
- [ ] Transaction tagging/categorization
- [ ] Bulk operation endpoints
- [ ] Export to CSV/PDF
- [ ] Real-time balance notifications via WebSocket

---

## 📝 **TESTING CHECKLIST**

Before considering production-ready, test:

### **Functional:**
- [ ] Create account with zero initial balance
- [ ] Create account with MAX_SAFE_INTEGER balance
- [ ] Deposit to blocked account (should fail)
- [ ] Withdraw more than balance (should fail)
- [ ] Withdraw exactly at daily limit
- [ ] Withdraw 1 cent over daily limit (should fail)
- [ ] Submit same idempotency key twice (should return same result)
- [ ] Statement with no transactions
- [ ] Statement spanning multiple days
- [ ] Pagination on statements (offset + limit)

### **Concurrency:**
- [ ] 100 concurrent deposits to same account
- [ ] 50 concurrent withdrawals to same account
- [ ] Concurrent block + deposit
- [ ] Concurrent withdraw + block
- [ ] Same idempotency key from multiple threads

### **Edge Cases:**
- [ ] Invalid date formats (2024-13-01, 2024-02-30)
- [ ] Negative amounts
- [ ] Zero amounts
- [ ] Amounts with decimals (should reject as schema expects integers)
- [ ] Very long personId (300 characters)
- [ ] Missing required fields
- [ ] Extra unexpected fields
- [ ] SQL injection attempts in all string fields
- [ ] XSS attempts in error messages

### **Performance:**
- [ ] Load test: 1000 requests/second
- [ ] Stress test: 5000 requests/second until failure
- [ ] Soak test: Sustained load for 24 hours
- [ ] Statement query with 1 million transactions
- [ ] Database connection pool exhaustion

---

## 🐛 **KNOWN ISSUES (Non-Critical)**

### 1. **Error Messages Leak Implementation Details**
Example: `"Balance overflow: result exceeds safe integer limit"`

**Impact:** Low - informational but could be more user-friendly

**Recommendation:** Return generic "Transaction amount too large" to users

---

### 2. **No Soft Delete for Transactions**
Once created, transactions cannot be reversed or marked as erroneous.

**Impact:** Medium - auditing/compliance concern

**Recommendation:** Add reversal transactions instead of deletions

---

### 3. **No Transaction Description/Memo**
Users cannot add notes to transactions.

**Impact:** Low - UX enhancement

**Recommendation:** Add optional `memo` field to transactions

---

### 4. **No Account Nickname/Alias**
Users see UUID account IDs.

**Impact:** Low - UX enhancement

**Recommendation:** Add `account_name` field

---

## 📧 **SUPPORT & QUESTIONS**

For questions about implementation or to report issues:
1. Check this document first
2. Review [ARCHITECTURE.md](ARCHITECTURE.md)
3. Check [FIXES_APPLIED.md](FIXES_APPLIED.md)
4. Open an issue with detailed reproduction steps

---

## 🎓 **LEARNING RESOURCES**

This codebase demonstrates:
- ✅ Clean architecture with repository pattern
- ✅ Dependency injection
- ✅ Database transactions for atomicity
- ✅ Idempotency for financial operations
- ✅ Concurrency control (mutexes + DB locking)
- ✅ Comprehensive error handling
- ✅ API documentation with Swagger
- ✅ Input validation with Zod
- ✅ Rate limiting

**NOT demonstrated (intentionally out of scope):**
- ❌ Authentication/Authorization
- ❌ Monitoring and observability
- ❌ Caching strategies
- ❌ Microservices communication
- ❌ Event sourcing
- ❌ CQRS pattern

This is educational code showing proper architecture and critical financial safety measures, but requires additional production hardening.
