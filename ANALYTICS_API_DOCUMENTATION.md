# 📊 BFC Analytics API Documentation

**Base URL:** `http://localhost:9191`

**Data Source:** Live Excel files (fetched on each request)

---

## 🔗 Table of Contents

### Data APIs
1. [Health Check](#1-health-check)
2. [Sheet Info](#2-sheet-info)
3. [All Data](#3-all-data)
4. [Remittance History](#4-remittance-history)
5. [Transactions History](#5-transactions-history)
6. [Rewards History](#6-rewards-history)
7. [TravelBuddy History](#7-travelbuddy-history)

### Analytics APIs
8. [Remittance Summary](#8-remittance-summary)
9. [Transactions Summary](#9-transactions-summary)
10. [Rewards Summary](#10-rewards-summary)
11. [TravelBuddy Summary](#11-travelbuddy-summary)
12. [Complete Dashboard](#12-complete-dashboard)
13. [Monthly Breakdown](#13-monthly-breakdown)
14. [Group by Transaction Type](#14-group-by-transaction-type)
15. [Group by Country](#15-group-by-country)
16. [Group by MCC Category](#16-group-by-mcc-category)
17. [Flyy Points Analytics](#17-flyy-points-analytics)
18. [Card Usage Analytics](#18-card-usage-analytics)

---

# 📁 DATA APIs

## 1. Health Check
```
GET /api/health
```

Check if the server is running.

**Response:**
```json
{
    "success": true,
    "message": "Server is running",
    "timestamp": "2025-12-01T10:00:00.000Z",
    "excel_files": { ... }
}
```

---

## 2. Sheet Info
```
GET /api/sheets
```

Get information about all Excel files and their sheets.

**Response:**
```json
{
    "success": true,
    "data": {
        "remittance": { "file": "...", "sheets": ["Vineet's Remittance"] },
        "transactions": { "file": "...", "sheets": ["Vineet's Transaction report"] },
        "rewards": { "file": "...", "sheets": ["Transactions", "Load", "Flyy points"] },
        "travelbuddy": { "file": "...", "sheets": ["Transactions", "Load"] }
    }
}
```

---

## 3. All Data
```
GET /api/all
```

Fetch all data from all Excel files in one request.

---

## 4. Remittance History
```
GET /api/remittance
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `cpr` | number | Filter by CPR (e.g., 851276393) |
| `paymentmode` | string | Filter by payment mode (e.g., "BFC Wallet") |
| `status` | boolean | Filter by status (true/false) |

**Examples:**
```bash
curl "http://localhost:9191/api/remittance"
curl "http://localhost:9191/api/remittance?cpr=851276393&status=true"
curl "http://localhost:9191/api/remittance?paymentmode=Benefit%20Pay"
```

---

## 5. Transactions History
```
GET /api/transactions
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `sender_cr` | number | Filter by sender CPR |
| `transaction_type` | string | Filter by type (CASH_BACK, TRAVEL_CARD_LOAD, IBAN_IN_CREDIT) |
| `transaction_status` | string | Filter by status (SUCCESS) |
| `credit_debit` | string | Filter by Credit or Debit |

**Examples:**
```bash
curl "http://localhost:9191/api/transactions"
curl "http://localhost:9191/api/transactions?credit_debit=Credit"
curl "http://localhost:9191/api/transactions?transaction_type=CASH_BACK"
```

---

## 6. Rewards History
```
GET /api/rewards
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `customerId` | number | Filter by customer ID |
| `type` | string | Filter by sheet: `transactions`, `load`, `flyy_points` |

**Examples:**
```bash
curl "http://localhost:9191/api/rewards"
curl "http://localhost:9191/api/rewards?type=flyy_points"
curl "http://localhost:9191/api/rewards?customerId=851276393&type=load"
```

---

## 7. TravelBuddy History
```
GET /api/travelbuddy
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `customerId` | number | Filter by customer ID |
| `type` | string | Filter by sheet: `transactions`, `load` |
| `country` | string | Filter by country (e.g., "India") |
| `transactionType` | string | Filter by POS or ECOM |

**Examples:**
```bash
curl "http://localhost:9191/api/travelbuddy"
curl "http://localhost:9191/api/travelbuddy?country=India"
curl "http://localhost:9191/api/travelbuddy?transactionType=POS"
```

---

# 📈 ANALYTICS APIs

## 8. Remittance Summary
```
GET /api/analytics/remittance/summary
```

Get remittance statistics with date range filtering.

| Parameter | Type | Description |
|-----------|------|-------------|
| `start_date` | string | Start date (YYYY-MM-DD) |
| `end_date` | string | End date (YYYY-MM-DD) |
| `cpr` | number | Filter by CPR |
| `paymentmode` | string | Filter by payment mode |

**Examples:**
```bash
# All time summary
curl "http://localhost:9191/api/analytics/remittance/summary"

# Date range
curl "http://localhost:9191/api/analytics/remittance/summary?start_date=2024-01-01&end_date=2024-12-31"

# Specific CPR
curl "http://localhost:9191/api/analytics/remittance/summary?cpr=851276393"
```

**Response:**
```json
{
    "success": true,
    "summary": {
        "total_transactions": 24,
        "successful_transactions": 18,
        "failed_transactions": 6,
        "success_rate": "75.00%",
        "total_amount_bhd": 8500.65,
        "successful_amount_bhd": 7200.00,
        "failed_amount_bhd": 1300.65,
        "total_fees_bhd": 36.00,
        "total_tax_bhd": 3.60,
        "average_transaction_bhd": 354.19
    },
    "by_payment_mode": {
        "BFC Wallet": { "count": 10, "total_amount": 4000, "successful": 8, "failed": 2 },
        "Benefit Pay": { "count": 14, "total_amount": 4500.65, "successful": 10, "failed": 4 }
    },
    "by_payment_type": {
        "REMITTANCE": { "count": 20, "total_amount": 7500 },
        "PIE_PAYMENT": { "count": 4, "total_amount": 1000.65 }
    }
}
```

---

## 9. Transactions Summary
```
GET /api/analytics/transactions/summary
```

Get wallet transaction statistics with date range filtering.

| Parameter | Type | Description |
|-----------|------|-------------|
| `start_date` | string | Start date (YYYY-MM-DD) |
| `end_date` | string | End date (YYYY-MM-DD) |
| `sender_cr` | number | Filter by sender CPR |
| `transaction_type` | string | Filter by transaction type |
| `credit_debit` | string | Filter by Credit or Debit |

**Examples:**
```bash
# All time summary
curl "http://localhost:9191/api/analytics/transactions/summary"

# Date range
curl "http://localhost:9191/api/analytics/transactions/summary?start_date=2025-01-01&end_date=2025-11-30"

# Only credits
curl "http://localhost:9191/api/analytics/transactions/summary?credit_debit=Credit"
```

**Response:**
```json
{
    "success": true,
    "summary": {
        "total_transactions": 331,
        "credit_transactions": 150,
        "debit_transactions": 181,
        "total_credits_bhd": 25000.00,
        "total_debits_bhd": 18000.00,
        "net_amount_bhd": 7000.00,
        "latest_balance_bhd": 312,
        "average_transaction_bhd": 129.91
    },
    "by_transaction_type": {
        "TRAVEL_CARD_LOAD": { "count": 50, "total_amount_bhd": 5000, "credits": 0, "debits": 50 },
        "IBAN_IN_CREDIT": { "count": 80, "total_amount_bhd": 15000, "credits": 80, "debits": 0 },
        "CASH_BACK": { "count": 20, "total_amount_bhd": 500, "credits": 20, "debits": 0 }
    },
    "by_bfc_type": {
        "PAYMENTS": { "count": 100, "total_amount_bhd": 10000 },
        "TOPUPS": { "count": 80, "total_amount_bhd": 15000 },
        "W2W": { "count": 50, "total_amount_bhd": 5000 }
    }
}
```

---

## 10. Rewards Summary
```
GET /api/analytics/rewards/summary
```

Get rewards card statistics including transactions, loads, and Flyy points.

| Parameter | Type | Description |
|-----------|------|-------------|
| `start_date` | string | Start date (YYYY-MM-DD) |
| `end_date` | string | End date (YYYY-MM-DD) |
| `customerId` | number | Filter by customer ID |

**Examples:**
```bash
curl "http://localhost:9191/api/analytics/rewards/summary"
curl "http://localhost:9191/api/analytics/rewards/summary?start_date=2025-01-01&end_date=2025-06-30"
curl "http://localhost:9191/api/analytics/rewards/summary?customerId=851276393"
```

**Response:**
```json
{
    "success": true,
    "transactions_summary": {
        "total_transactions": 1188,
        "total_spent_bhd": 15000.50,
        "total_markup_bhd": 375.01,
        "domestic_count": 200,
        "international_count": 988,
        "pos_count": 800,
        "ecom_count": 388
    },
    "load_summary": {
        "total_loads": 6475,
        "total_loaded_bhd": 50000.00,
        "total_loaded_usd": 132585.00,
        "average_load_bhd": 7.72
    },
    "flyy_points_summary": {
        "total_point_transactions": 551,
        "total_points_earned": 150000,
        "total_points_redeemed": 50000,
        "net_points": 100000
    },
    "by_country": {
        "India": { "count": 500, "total_bhd": 8000 },
        "United States": { "count": 200, "total_bhd": 3000 }
    },
    "by_category": {
        "Hotels & Guest Houses": { "count": 100, "total_bhd": 5000 },
        "Restaurants": { "count": 300, "total_bhd": 2000 }
    }
}
```

---

## 11. TravelBuddy Summary
```
GET /api/analytics/travelbuddy/summary
```

Get TravelBuddy card statistics.

| Parameter | Type | Description |
|-----------|------|-------------|
| `start_date` | string | Start date (YYYY-MM-DD) |
| `end_date` | string | End date (YYYY-MM-DD) |
| `customerId` | number | Filter by customer ID |
| `country` | string | Filter by country |

**Examples:**
```bash
curl "http://localhost:9191/api/analytics/travelbuddy/summary"
curl "http://localhost:9191/api/analytics/travelbuddy/summary?country=India"
curl "http://localhost:9191/api/analytics/travelbuddy/summary?start_date=2025-01-01&end_date=2025-03-31"
```

**Response:**
```json
{
    "success": true,
    "transactions_summary": {
        "total_transactions": 1188,
        "total_spent_bhd": 15000.50,
        "total_markup_bhd": 375.01,
        "domestic_count": 200,
        "international_count": 988,
        "average_transaction_bhd": 12.63
    },
    "load_summary": {
        "total_loads": 6475,
        "total_loaded_bhd": 50000.00,
        "total_loaded_usd": 132585.00,
        "current_wallet_balance": 1500.50
    },
    "by_country": {
        "India": { "count": 500, "total_bhd": 8000, "total_markup": 200 },
        "United States": { "count": 200, "total_bhd": 3000, "total_markup": 75 }
    }
}
```

---

## 12. Complete Dashboard
```
GET /api/analytics/dashboard
```

Get a complete overview of all financial data.

| Parameter | Type | Description |
|-----------|------|-------------|
| `start_date` | string | Start date (YYYY-MM-DD) |
| `end_date` | string | End date (YYYY-MM-DD) |
| `cpr` or `customerId` | number | Filter by customer (default: 851276393) |

**Examples:**
```bash
curl "http://localhost:9191/api/analytics/dashboard"
curl "http://localhost:9191/api/analytics/dashboard?start_date=2024-01-01&end_date=2025-12-31"
```

**Response:**
```json
{
    "success": true,
    "overview": {
        "total_remittance_bhd": 8500.65,
        "wallet_credits_bhd": 25000.00,
        "wallet_debits_bhd": 18000.00,
        "wallet_net_bhd": 7000.00,
        "rewards_card_spent_bhd": 15000.50,
        "rewards_card_loaded_bhd": 50000.00,
        "travelbuddy_spent_bhd": 15000.50,
        "travelbuddy_loaded_bhd": 50000.00,
        "flyy_points_earned": 150000,
        "flyy_points_redeemed": 50000,
        "flyy_points_balance": 100000
    },
    "transaction_counts": {
        "remittance": 24,
        "wallet_transactions": 331,
        "rewards_transactions": 1188,
        "rewards_loads": 6475,
        "travelbuddy_transactions": 1188,
        "travelbuddy_loads": 6475,
        "flyy_point_transactions": 551
    }
}
```

---

## 13. Monthly Breakdown
```
GET /api/analytics/monthly
```

Get monthly transaction breakdown for a specific year.

| Parameter | Type | Description |
|-----------|------|-------------|
| `year` | number | Year to analyze (default: current year) |
| `source` | string | Data source: `remittance`, `transactions`, `rewards`, `travelbuddy` |

**Examples:**
```bash
curl "http://localhost:9191/api/analytics/monthly?source=remittance&year=2024"
curl "http://localhost:9191/api/analytics/monthly?source=transactions&year=2025"
curl "http://localhost:9191/api/analytics/monthly?source=rewards&year=2025"
```

**Response:**
```json
{
    "success": true,
    "year": 2024,
    "source": "remittance",
    "monthly_data": {
        "Jan": { "count": 5, "total_bhd": 1500.00 },
        "Feb": { "count": 3, "total_bhd": 800.00 },
        "Mar": { "count": 4, "total_bhd": 1200.00 },
        "Apr": { "count": 2, "total_bhd": 500.00 },
        "May": { "count": 6, "total_bhd": 2000.00 },
        "Jun": { "count": 0, "total_bhd": 0 },
        "Jul": { "count": 1, "total_bhd": 300.00 },
        "Aug": { "count": 3, "total_bhd": 900.00 },
        "Sep": { "count": 0, "total_bhd": 0 },
        "Oct": { "count": 0, "total_bhd": 0 },
        "Nov": { "count": 2, "total_bhd": 500.00 },
        "Dec": { "count": 0, "total_bhd": 0 }
    }
}
```

---

## 14. Group by Transaction Type
```
GET /api/analytics/by-type
```

Get wallet transactions grouped by transaction type.

| Parameter | Type | Description |
|-----------|------|-------------|
| `start_date` | string | Start date (YYYY-MM-DD) |
| `end_date` | string | End date (YYYY-MM-DD) |

**Examples:**
```bash
curl "http://localhost:9191/api/analytics/by-type"
curl "http://localhost:9191/api/analytics/by-type?start_date=2025-01-01&end_date=2025-11-30"
```

**Response:**
```json
{
    "success": true,
    "by_transaction_type": {
        "TRAVEL_CARD_LOAD": {
            "count": 50,
            "total_bhd": 5000,
            "credits": 0,
            "debits": 50,
            "credit_amount": 0,
            "debit_amount": 5000
        },
        "IBAN_IN_CREDIT": {
            "count": 80,
            "total_bhd": 15000,
            "credits": 80,
            "debits": 0,
            "credit_amount": 15000,
            "debit_amount": 0
        },
        "CASH_BACK": {
            "count": 20,
            "total_bhd": 500,
            "credits": 20,
            "debits": 0,
            "credit_amount": 500,
            "debit_amount": 0
        }
    }
}
```

---

## 15. Group by Country
```
GET /api/analytics/by-country
```

Get card transactions grouped by country.

| Parameter | Type | Description |
|-----------|------|-------------|
| `start_date` | string | Start date (YYYY-MM-DD) |
| `end_date` | string | End date (YYYY-MM-DD) |
| `source` | string | Data source: `rewards` (default) or `travelbuddy` |

**Examples:**
```bash
curl "http://localhost:9191/api/analytics/by-country"
curl "http://localhost:9191/api/analytics/by-country?source=travelbuddy"
curl "http://localhost:9191/api/analytics/by-country?start_date=2025-01-01&end_date=2025-06-30"
```

**Response:**
```json
{
    "success": true,
    "total_countries": 15,
    "by_country": [
        {
            "country": "India",
            "count": 500,
            "total_bhd": 8000.50,
            "total_markup_bhd": 200.01,
            "pos_count": 450,
            "ecom_count": 50
        },
        {
            "country": "United States",
            "count": 200,
            "total_bhd": 3000.25,
            "total_markup_bhd": 75.00,
            "pos_count": 50,
            "ecom_count": 150
        },
        {
            "country": "UAE",
            "count": 100,
            "total_bhd": 1500.00,
            "total_markup_bhd": 37.50,
            "pos_count": 100,
            "ecom_count": 0
        }
    ]
}
```

---

## 16. Group by MCC Category
```
GET /api/analytics/by-category
```

Get card transactions grouped by merchant category (MCC).

| Parameter | Type | Description |
|-----------|------|-------------|
| `start_date` | string | Start date (YYYY-MM-DD) |
| `end_date` | string | End date (YYYY-MM-DD) |
| `source` | string | Data source: `rewards` (default) or `travelbuddy` |

**Examples:**
```bash
curl "http://localhost:9191/api/analytics/by-category"
curl "http://localhost:9191/api/analytics/by-category?source=travelbuddy"
```

**Response:**
```json
{
    "success": true,
    "total_categories": 25,
    "by_category": [
        {
            "category": "Hotels & Guest Houses",
            "count": 100,
            "total_bhd": 5000.00,
            "average_bhd": 50.00,
            "mcc_codes": [7011, 7012]
        },
        {
            "category": "Restaurants",
            "count": 300,
            "total_bhd": 2000.00,
            "average_bhd": 6.67,
            "mcc_codes": [5812, 5814]
        },
        {
            "category": "Grocery Stores",
            "count": 250,
            "total_bhd": 1500.00,
            "average_bhd": 6.00,
            "mcc_codes": [5411]
        }
    ]
}
```

---

## 17. Flyy Points Analytics
```
GET /api/analytics/flyy-points
```

Get detailed Flyy points analytics.

| Parameter | Type | Description |
|-----------|------|-------------|
| `start_date` | string | Start date (YYYY-MM-DD) |
| `end_date` | string | End date (YYYY-MM-DD) |
| `type` | string | Filter by `credit` or `debit` |

**Examples:**
```bash
curl "http://localhost:9191/api/analytics/flyy-points"
curl "http://localhost:9191/api/analytics/flyy-points?type=credit"
curl "http://localhost:9191/api/analytics/flyy-points?start_date=2025-01-01&end_date=2025-11-30"
```

**Response:**
```json
{
    "success": true,
    "summary": {
        "total_transactions": 551,
        "credit_transactions": 500,
        "debit_transactions": 51,
        "total_points_earned": 150000,
        "total_points_redeemed": 50000,
        "net_points": 100000,
        "average_earn_per_transaction": 300,
        "average_redeem_per_transaction": 980
    },
    "by_reason": {
        "Earned for Mc Successful Transaction": { "count": 400, "total_points": 100000, "type": "credit" },
        "Weekly Bonus Cashback": { "count": 52, "total_points": 26000, "type": "credit" },
        "Cashback": { "count": 48, "total_points": 24000, "type": "credit" },
        "Cashback": { "count": 51, "total_points": 50000, "type": "debit" }
    }
}
```

---

## 18. Card Usage Analytics
```
GET /api/analytics/card-usage
```

Get combined analytics for Rewards and TravelBuddy cards.

| Parameter | Type | Description |
|-----------|------|-------------|
| `start_date` | string | Start date (YYYY-MM-DD) |
| `end_date` | string | End date (YYYY-MM-DD) |
| `customerId` | number | Filter by customer ID |

**Examples:**
```bash
curl "http://localhost:9191/api/analytics/card-usage"
curl "http://localhost:9191/api/analytics/card-usage?customerId=851276393"
curl "http://localhost:9191/api/analytics/card-usage?start_date=2024-01-01&end_date=2025-12-31"
```

**Response:**
```json
{
    "success": true,
    "rewards_card": {
        "card_numbers": ["4560XXXXXXXX5443"],
        "total_transactions": 1188,
        "total_loads": 6475,
        "total_spent_bhd": 15000.50,
        "total_loaded_bhd": 50000.00,
        "total_markup_bhd": 375.01,
        "balance_estimate": 34999.50,
        "domestic_txns": 200,
        "international_txns": 988
    },
    "travelbuddy_card": {
        "card_numbers": ["4560XXXXXXXX5443"],
        "total_transactions": 1188,
        "total_loads": 6475,
        "total_spent_bhd": 15000.50,
        "total_loaded_bhd": 50000.00,
        "total_markup_bhd": 375.01,
        "balance_estimate": 34999.50,
        "domestic_txns": 200,
        "international_txns": 988
    },
    "combined": {
        "total_transactions": 2376,
        "total_loads": 12950,
        "total_spent_bhd": 30001.00,
        "total_loaded_bhd": 100000.00,
        "total_markup_bhd": 750.02
    }
}
```

---

# 🚀 Quick Start

### Start Server
```bash
node server.js
```

### Test All Analytics APIs (PowerShell)
```powershell
# Dashboard
Invoke-RestMethod -Uri "http://localhost:9191/api/analytics/dashboard"

# Remittance Summary
Invoke-RestMethod -Uri "http://localhost:9191/api/analytics/remittance/summary"

# Transactions Summary with date range
Invoke-RestMethod -Uri "http://localhost:9191/api/analytics/transactions/summary?start_date=2024-01-01&end_date=2024-12-31"

# Monthly breakdown
Invoke-RestMethod -Uri "http://localhost:9191/api/analytics/monthly?source=transactions&year=2025"

# By Country
Invoke-RestMethod -Uri "http://localhost:9191/api/analytics/by-country"

# Flyy Points
Invoke-RestMethod -Uri "http://localhost:9191/api/analytics/flyy-points"
```

---

# 📋 API Summary Table

| Endpoint | Description | Key Filters |
|----------|-------------|-------------|
| `/api/analytics/remittance/summary` | Remittance totals & breakdown | `start_date`, `end_date`, `cpr` |
| `/api/analytics/transactions/summary` | Wallet transaction totals | `start_date`, `end_date`, `credit_debit` |
| `/api/analytics/rewards/summary` | Rewards card + Flyy points | `start_date`, `end_date`, `customerId` |
| `/api/analytics/travelbuddy/summary` | TravelBuddy card totals | `start_date`, `end_date`, `country` |
| `/api/analytics/dashboard` | Complete overview | `start_date`, `end_date` |
| `/api/analytics/monthly` | Monthly breakdown | `year`, `source` |
| `/api/analytics/by-type` | Group by txn type | `start_date`, `end_date` |
| `/api/analytics/by-country` | Group by country | `source` |
| `/api/analytics/by-category` | Group by MCC category | `source` |
| `/api/analytics/flyy-points` | Points analytics | `type` (credit/debit) |
| `/api/analytics/card-usage` | Combined card stats | `customerId` |

---

**API Version:** 2.0.0  
**Last Updated:** December 1, 2025
