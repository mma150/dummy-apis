# 🧠 MCP Tools API Implementation Plan

## Overview
Create 29 REST APIs for the AI Finance Voice Agent MCP server.
All APIs read from **Redis cache** (pre-warmed data with 2-month TTL).

---

## 📊 Data Sources (Redis Keys)

| Redis Key | Source | Description |
|-----------|--------|-------------|
| `dummy-apis:remittance:0-0:default:all=true` | remittance.xlsx | All remittance data |
| `dummy-apis:transactions:0-0:default:all=true` | transactions.xlsx | All transaction data |
| `dummy-apis:rewards:0-0:all:all=true` | rewardhistory.xlsx | All rewards (3 sheets) |
| `dummy-apis:travelbuddy:0-0:all:all=true` | travelbuddytxn.xlsx | All travel buddy (2 sheets) |

---

## 🔌 API Endpoints (29 Total)

### Base URL: `http://localhost:9191/api/mcp`

---

## 1️⃣ SPENDING & BUDGET MANAGEMENT (9 APIs)

| # | Endpoint | Method | Parameters | Description |
|---|----------|--------|------------|-------------|
| 1 | `/mcp/spend/summary` | GET | `period` (month/week/year/yesterday) | Total spending, income, net for period |
| 2 | `/mcp/spend/by-category` | GET | `period` | Breakdown by MCC category |
| 3 | `/mcp/spend/top-merchants` | GET | `period`, `limit` | Top spending merchants |
| 4 | `/mcp/spend/trend` | GET | `months` (comma-separated: 1,2,3) | Month-over-month comparison |
| 5 | `/mcp/spend/search` | GET | `query`, `limit`, `offset`, `period` | Search transactions |
| 6 | `/mcp/spend/subscriptions` | GET | - | Detect recurring payments |
| 7 | `/mcp/spend/daily` | GET | `period` | Daily spend breakdown |
| 8 | `/mcp/spend/category` | GET | `period`, `category` | Specific category spending |
| 9 | `/mcp/spend/unusual` | GET | `period` | Flag outlier transactions |

**Data Source:** `rewards:Transactions` + `travelbuddy:Transactions`

---

## 2️⃣ TRAVEL WALLET & TRIP ANALYTICS (5 APIs)

| # | Endpoint | Method | Parameters | Description |
|---|----------|--------|------------|-------------|
| 10 | `/mcp/travel/trips` | GET | - | List all trips (grouped by country/dates) |
| 11 | `/mcp/travel/trip-spend` | GET | `trip_id` | Total spend for a trip |
| 12 | `/mcp/travel/load-vs-spend` | GET | `trip_id` | Compare loaded vs spent |
| 13 | `/mcp/travel/compare` | GET | `trip_id_1`, `trip_id_2` | Compare two trips |
| 14 | `/mcp/travel/currency-mix` | GET | `trip_id` | Breakdown by currency |

**Data Source:** `travelbuddy:Transactions` + `travelbuddy:Load`

---

## 3️⃣ REMITTANCE MANAGEMENT (5 APIs)

| # | Endpoint | Method | Parameters | Description |
|---|----------|--------|------------|-------------|
| 15 | `/mcp/remittance/summary` | GET | `year` | Total remitted, count, avg |
| 16 | `/mcp/remittance/recipient` | GET | `recipient_name` | Stats for specific recipient |
| 17 | `/mcp/remittance/trend` | GET | `years` (comma-separated) | Year-over-year comparison |
| 18 | `/mcp/remittance/search` | GET | `query`, `limit`, `offset` | Search by purpose/notes |
| 19 | `/mcp/remittance/fx-rate` | GET | `currency` | Get exchange rate (mock/live) |

**Data Source:** `remittance`

---

## 4️⃣ REWARDS & CASHBACK (4 APIs)

| # | Endpoint | Method | Parameters | Description |
|---|----------|--------|------------|-------------|
| 20 | `/mcp/rewards/summary` | GET | - | Total earned, redeemed, balance |
| 21 | `/mcp/rewards/activity` | GET | `period` | Breakdown by type/merchant |
| 22 | `/mcp/rewards/expiry-alerts` | GET | - | Points expiring soon |
| 23 | `/mcp/rewards/best-strategy` | GET | `category` | Recommend for max points |

**Data Source:** `rewards:Flyy points` + `rewards:Transactions`

---

## 5️⃣ PERSONAL FINANCE AI (4 APIs)

| # | Endpoint | Method | Parameters | Description |
|---|----------|--------|------------|-------------|
| 24 | `/mcp/finance/savings-rate` | GET | `period` | Income vs expense ratio |
| 25 | `/mcp/finance/predict` | GET | `category`, `months` | Forecast next month spend |
| 26 | `/mcp/finance/optimize` | GET | `category`, `target` | Suggest budget adjustments |
| 27 | `/mcp/finance/set-alert` | POST | `category`, `threshold` | Set spending alert |

**Data Source:** `transactions` + `rewards:Transactions`

---

## 6️⃣ UTILITY (3 APIs)

| # | Endpoint | Method | Parameters | Description |
|---|----------|--------|------------|-------------|
| 28 | `/mcp/utility/balance` | GET | - | Current wallet balance |
| 29 | `/mcp/utility/report` | GET | `period`, `format` | Download CSV/JSON report |
| 30 | `/mcp/utility/explain-category` | GET | `category` | Voice-friendly explanation |

**Data Source:** `transactions` (latest balance)

---

## 🛠️ Implementation Details

### Helper Function: Get Data from Redis
```javascript
async function getMcpData(dataType) {
    const cacheKeys = {
        remittance: 'dummy-apis:remittance:0-0:default:all=true',
        transactions: 'dummy-apis:transactions:0-0:default:all=true',
        rewards: 'dummy-apis:rewards:0-0:all:all=true',
        travelbuddy: 'dummy-apis:travelbuddy:0-0:all:all=true'
    };
    
    const cached = await getFromCache(cacheKeys[dataType]);
    if (cached) return cached.data;
    
    // Fallback: read from Excel and cache
    // ... trigger warmup
}
```

### Period Parsing
```javascript
function parsePeriod(period) {
    const now = new Date();
    switch(period) {
        case 'yesterday': return { start: yesterday, end: yesterday };
        case 'week': return { start: 7daysAgo, end: now };
        case 'month': return { start: firstOfMonth, end: now };
        case 'year': return { start: firstOfYear, end: now };
        default: return null; // all time
    }
}
```

---

## 📋 Response Format (Standard)

### ⚠️ CRITICAL: No Raw Data Arrays to LLM

All APIs return **summarized/aggregated data only**. Never send raw transaction arrays.

**DO ✅:**
```json
{
    "success": true,
    "tool": "get_spend_summary",
    "period": "month",
    "summary": {
        "total_spent": 1250.50,
        "total_income": 2000.00,
        "net": 749.50,
        "transaction_count": 45,
        "top_category": "Food & Dining"
    },
    "cached": true,
    "timestamp": "2025-12-07T10:00:00Z"
}
```

**DON'T ❌:**
```json
{
    "data": [
        { "id": 1, "amount": 50, ... },
        { "id": 2, "amount": 30, ... },
        // ... 1000+ transactions
    ]
}
```

### Data Limits Per API

| API Type | Max Items | Format |
|----------|-----------|--------|
| Summary APIs | 0 items | Aggregated totals only |
| Top Merchants | 10 items | Name + amount only |
| Search Results | 5 items | Summary fields only |
| Category List | 15 items | Category + total only |
| Trend Data | 12 months | Month + amount only |
| Unusual Activity | 5 items | Merchant + amount + reason |

### Response Size Target
- **Max response size:** < 2KB JSON
- **No nested transaction arrays**
- **Pagination for search:** Return count + first 5 matches

---

## 🚀 Implementation Order

1. **Phase 1:** Helper functions (getMcpData, parsePeriod)
2. **Phase 2:** Spending APIs (1-9)
3. **Phase 3:** Travel APIs (10-14)
4. **Phase 4:** Remittance APIs (15-19)
5. **Phase 5:** Rewards APIs (20-23)
6. **Phase 6:** Finance AI APIs (24-27)
7. **Phase 7:** Utility APIs (28-30)

---

## 📝 Console Log Update

Add to server startup:
```
🤖 MCP TOOL APIs:
  GET /api/mcp/spend/summary          - Spending summary
  GET /api/mcp/spend/by-category      - By category
  ... (all 29 endpoints)
```

---

## ✅ Ready to Implement

Confirm to proceed with implementation.
