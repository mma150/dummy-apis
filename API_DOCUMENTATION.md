# 📚 BFC API Documentation

**Base URL:** `http://localhost:9191`

**Server Status:** Running on Port 9191

---

## 🔗 Table of Contents
1. [Health Check API](#1-health-check-api)
2. [Remittance History API](#2-remittance-history-api)
3. [Transactions History API](#3-transactions-history-api)
4. [Rewards History API](#4-rewards-history-api)
5. [TravelBuddy Transaction History API](#5-travelbuddy-transaction-history-api)

---

## 1. Health Check API

### Endpoint
```
GET /api/health
```

### Description
Check if the server is running and healthy.

### Request
```bash
curl "http://localhost:9191/api/health"
```

### Response
```json
{
    "success": true,
    "message": "Server is running",
    "timestamp": "2025-11-30T05:55:46.673Z"
}
```

---

## 2. Remittance History API

### Endpoint
```
GET /api/remittance
```

### Description
Fetch remittance transaction history. Data sourced from `Vineet's Remittance.xlsx`.

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `cpr` | number | No | Filter by CPR number (e.g., 851276393) |
| `paymentmode` | string | No | Filter by payment mode (e.g., "BFC Wallet", "Benefit Pay") |
| `status` | boolean | No | Filter by transaction status (true/false) |

### Request Examples

#### Get All Remittance History
```bash
curl "http://localhost:9191/api/remittance"
```

#### Filter by CPR
```bash
curl "http://localhost:9191/api/remittance?cpr=851276393"
```

#### Filter by Payment Mode
```bash
curl "http://localhost:9191/api/remittance?paymentmode=BFC%20Wallet"
```

```bash
curl "http://localhost:9191/api/remittance?paymentmode=Benefit%20Pay"
```

#### Filter by Status
```bash
curl "http://localhost:9191/api/remittance?status=true"
```

#### Combined Filters
```bash
curl "http://localhost:9191/api/remittance?cpr=851276393&paymentmode=BFC%20Wallet&status=true"
```

### Response Schema
```json
{
    "success": true,
    "message": "Remittance history fetched successfully",
    "total_records": 4,
    "data": [
        {
            "amount": 200,
            "fee": 1.5,
            "admindeposit": false,
            "tax": 0.15,
            "tabibdata_isprimary": false,
            "issuerid": null,
            "pgreferenceid": "PR00000007762555",
            "trycount": 2,
            "_id": "6747276f66fc550012e41f27",
            "typeofservice": "paid",
            "biller_type": null,
            "timestamp_created": "Nov 27, 2024, 5:06 PM",
            "paymentmode": "BFC Wallet",
            "userid": "dffddad7-a500-488b-9946-6a922e941a72",
            "transactionid": "BHCTA202411270109534",
            "currency": null,
            "biller_name": null,
            "timestamp_updated": "Nov 27, 2024, 5:07 PM",
            "total_amount_bhd": 201.65,
            "paymenttype": "REMITTANCE",
            "cpr": 851276393,
            "status": true
        }
    ]
}
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `amount` | number | Transaction amount |
| `fee` | number | Transaction fee |
| `tax` | number | Tax amount |
| `total_amount_bhd` | number | Total amount in BHD |
| `paymentmode` | string | Payment method used |
| `paymenttype` | string | Type of payment (REMITTANCE) |
| `cpr` | number | Customer CPR number |
| `userid` | string | User UUID |
| `transactionid` | string | Unique transaction ID |
| `timestamp_created` | string | Transaction creation time |
| `status` | boolean | Transaction status |

---

## 3. Transactions History API

### Endpoint
```
GET /api/transactions
```

### Description
Fetch wallet transaction history. Data sourced from `Vineet's Transactions.xlsx`.

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sender_cr` | number | No | Filter by sender CPR (e.g., 851276393) |
| `transaction_type` | string | No | Filter by transaction type (e.g., "CASH_BACK", "TRAVEL_CARD_LOAD", "IBAN_IN_CREDIT") |
| `transaction_status` | string | No | Filter by status (e.g., "SUCCESS") |
| `credit_debit` | string | No | Filter by Credit or Debit |

### Request Examples

#### Get All Transactions
```bash
curl "http://localhost:9191/api/transactions"
```

#### Filter by Sender CPR
```bash
curl "http://localhost:9191/api/transactions?sender_cr=851276393"
```

#### Filter by Transaction Type
```bash
curl "http://localhost:9191/api/transactions?transaction_type=CASH_BACK"
```

```bash
curl "http://localhost:9191/api/transactions?transaction_type=TRAVEL_CARD_LOAD"
```

```bash
curl "http://localhost:9191/api/transactions?transaction_type=IBAN_IN_CREDIT"
```

#### Filter by Credit/Debit
```bash
curl "http://localhost:9191/api/transactions?credit_debit=Credit"
```

```bash
curl "http://localhost:9191/api/transactions?credit_debit=Debit"
```

#### Filter by Transaction Status
```bash
curl "http://localhost:9191/api/transactions?transaction_status=SUCCESS"
```

#### Combined Filters
```bash
curl "http://localhost:9191/api/transactions?sender_cr=851276393&transaction_type=CASH_BACK&credit_debit=Credit"
```

```bash
curl "http://localhost:9191/api/transactions?transaction_type=TRAVEL_CARD_LOAD&transaction_status=SUCCESS"
```

### Response Schema
```json
{
    "success": true,
    "message": "Transaction history fetched successfully",
    "total_records": 4,
    "data": [
        {
            "sender_account_number": "200227690172815",
            "msisdn": "34017726",
            "created_date": "Nov 15, 2025, 6:00 AM",
            "_id": "6917ecb56bc2954135c56eed",
            "reverse": false,
            "batch_id": "AUB000004650579",
            "transaction_date": "14/11/2025 07:25:18",
            "sender_type": "CPR",
            "transaction_type": "TRAVEL_CARD_LOAD",
            "credit": false,
            "credit_debit": "Debit",
            "sub_transaction_type": "TRAVEL_CARD_LOAD",
            "transaction_reference": "PR00000010308008",
            "iban_number": null,
            "available_balance": 312000,
            "available_balance_bhd": 312,
            "bfc_type": "PAYMENTS",
            "transaction_status": "SUCCESS",
            "status": "FILE_CREATED",
            "account_currency": "BHD",
            "sender_cr": 851276393,
            "sender_name": "VINEET KARUMAT",
            "transaction_date_time": "Nov 14, 2025, 10:25 AM",
            "amount": -100000,
            "transacted_amount_bhd": -100
        }
    ]
}
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `sender_account_number` | string | Sender's account number |
| `sender_cr` | number | Sender CPR |
| `sender_name` | string | Sender's name |
| `transaction_type` | string | Type of transaction |
| `credit_debit` | string | Credit or Debit |
| `transacted_amount_bhd` | number | Amount in BHD |
| `available_balance_bhd` | number | Available balance in BHD |
| `transaction_status` | string | Transaction status |
| `iban_number` | string | IBAN number (if applicable) |

---

## 4. Rewards History API

### Endpoint
```
GET /api/rewards
```

### Description
Fetch rewards history including transactions, card loads, and Flyy points. Data sourced from `Vineet-Rewards History.xlsx` (3 sheets).

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `customerId` | number | No | Filter by customer ID (e.g., 851276393) |
| `type` | string | No | Filter by data type: `transactions`, `load`, `flyy_points` |

### Request Examples

#### Get All Rewards Data
```bash
curl "http://localhost:9191/api/rewards"
```

#### Get Only Transactions
```bash
curl "http://localhost:9191/api/rewards?type=transactions"
```

#### Get Only Load History
```bash
curl "http://localhost:9191/api/rewards?type=load"
```

#### Get Only Flyy Points
```bash
curl "http://localhost:9191/api/rewards?type=flyy_points"
```

#### Filter by Customer ID
```bash
curl "http://localhost:9191/api/rewards?customerId=851276393"
```

#### Combined Filters
```bash
curl "http://localhost:9191/api/rewards?customerId=851276393&type=transactions"
```

```bash
curl "http://localhost:9191/api/rewards?customerId=851276393&type=load"
```

```bash
curl "http://localhost:9191/api/rewards?customerId=851276393&type=flyy_points"
```

### Response Schema (All Data)
```json
{
    "success": true,
    "message": "Rewards history fetched successfully",
    "data": {
        "transactions": [
            {
                "txn_date": "2025-01-01 10:00:19",
                "customerId": 851276393,
                "transactionType_dsc": "POS",
                "status_desc": "PAYMENT_SUCCESS",
                "otherPartyName": "GOLF VIEW HOMES LIMITE MADIKERI IN",
                "mcc": 7011,
                "acquirer_country_code": "0356",
                "bhd_amount": 329.054,
                "markup": 8.22635,
                "crdr": "DR",
                "domestic_international": "International",
                "country": "India",
                "mcc_name": "LODGING,HOTELS,MOTELS,RESORTS",
                "mcc_category": "Hotels & Guest Houses"
            }
        ],
        "load": [
            {
                "txn_date": "2024-04-04 18:43:07",
                "customerId": 851276393,
                "kitNumber": 10005544,
                "cardNumber": "4560XXXXXXXX5443",
                "externalTxnId": "BFCMC240404154214579302",
                "amount": 20,
                "transactionType_dsc": "LOAD",
                "status_desc": "PAYMENT_SUCCESS",
                "crdr": "CR",
                "description": "LOAD MONEY FROM BENEFITAPP",
                "bhd_amount": 20,
                "usd_amount": 53.03
            }
        ],
        "flyy_points": [
            {
                "ext_uid": "dffddad7-a500-488b-9946-6a922e941a72",
                "points": 10000,
                "reference_number": "FLYY_60VUV3Z7",
                "message": "Cashback",
                "type": "debit",
                "created_at": "2025-11-13"
            }
        ]
    }
}
```

### Data Sections

#### Transactions Fields
| Field | Type | Description |
|-------|------|-------------|
| `txn_date` | string | Transaction date |
| `customerId` | number | Customer ID |
| `transactionType_dsc` | string | Transaction type (POS, ECOM) |
| `bhd_amount` | number | Amount in BHD |
| `country` | string | Transaction country |
| `mcc_category` | string | Merchant category |

#### Load Fields
| Field | Type | Description |
|-------|------|-------------|
| `cardNumber` | string | Masked card number |
| `amount` | number | Load amount |
| `description` | string | Load description |
| `bhd_amount` | number | Amount in BHD |
| `usd_amount` | number | Amount in USD |

#### Flyy Points Fields
| Field | Type | Description |
|-------|------|-------------|
| `ext_uid` | string | External user ID |
| `points` | number | Points amount |
| `message` | string | Points description |
| `type` | string | credit or debit |

---

## 5. TravelBuddy Transaction History API

### Endpoint
```
GET /api/travelbuddy
```

### Description
Fetch TravelBuddy card transaction history. Data sourced from `Vineet-TravelBuddy Trxn History.xlsx` (2 sheets).

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `customerId` | number | No | Filter by customer ID (e.g., 851276393) |
| `type` | string | No | Filter by data type: `transactions`, `load` |
| `country` | string | No | Filter by country (e.g., "India", "United States") |
| `transactionType` | string | No | Filter by transaction type (e.g., "POS", "ECOM") |

### Request Examples

#### Get All TravelBuddy Data
```bash
curl "http://localhost:9191/api/travelbuddy"
```

#### Get Only Transactions
```bash
curl "http://localhost:9191/api/travelbuddy?type=transactions"
```

#### Get Only Load History
```bash
curl "http://localhost:9191/api/travelbuddy?type=load"
```

#### Filter by Customer ID
```bash
curl "http://localhost:9191/api/travelbuddy?customerId=851276393"
```

#### Filter by Country
```bash
curl "http://localhost:9191/api/travelbuddy?country=India"
```

```bash
curl "http://localhost:9191/api/travelbuddy?country=United%20States"
```

#### Filter by Transaction Type
```bash
curl "http://localhost:9191/api/travelbuddy?transactionType=POS"
```

```bash
curl "http://localhost:9191/api/travelbuddy?transactionType=ECOM"
```

#### Combined Filters
```bash
curl "http://localhost:9191/api/travelbuddy?customerId=851276393&type=transactions"
```

```bash
curl "http://localhost:9191/api/travelbuddy?country=India&transactionType=POS"
```

```bash
curl "http://localhost:9191/api/travelbuddy?customerId=851276393&country=India&transactionType=POS"
```

```bash
curl "http://localhost:9191/api/travelbuddy?type=transactions&country=United%20States"
```

### Response Schema
```json
{
    "success": true,
    "message": "TravelBuddy transaction history fetched successfully",
    "data": {
        "transactions": [
            {
                "txn_date": "2025-01-01 10:00:19",
                "customerId": 851276393,
                "transactionType_dsc": "POS",
                "status_desc": "PAYMENT_SUCCESS",
                "otherPartyName": "GOLF VIEW HOMES LIMITE MADIKERI IN",
                "mcc": 7011,
                "acquirer_country_code": "0356",
                "bhd_amount": 329.054,
                "markup": 8.22635,
                "crdr": "DR",
                "domestic_international": "International",
                "country": "India",
                "mcc_name": "LODGING,HOTELS,MOTELS,RESORTS",
                "mcc_category": "Hotels & Guest Houses"
            }
        ],
        "load": [
            {
                "txn_date": "2024-04-04 18:43:07",
                "customerId": 851276393,
                "kitNumber": 10005544,
                "cardNumber": "4560XXXXXXXX5443",
                "externalTxnId": "BFCMC240404154214579302",
                "amount": 20,
                "transactionType_dsc": "LOAD",
                "status_desc": "PAYMENT_SUCCESS",
                "crdr": "CR",
                "description": "LOAD MONEY FROM BENEFITAPP",
                "bhd_amount": 20,
                "usd_amount": 53.03,
                "to_wallet_balance": 29.161
            }
        ]
    }
}
```

### Response Fields

#### Transactions
| Field | Type | Description |
|-------|------|-------------|
| `txn_date` | string | Transaction date/time |
| `customerId` | number | Customer ID |
| `transactionType_dsc` | string | Transaction type (POS/ECOM) |
| `status_desc` | string | Transaction status |
| `otherPartyName` | string | Merchant name |
| `mcc` | number | Merchant category code |
| `bhd_amount` | number | Amount in BHD |
| `markup` | number | Markup fee |
| `crdr` | string | Credit (CR) or Debit (DR) |
| `domestic_international` | string | Domestic or International |
| `country` | string | Transaction country |
| `mcc_name` | string | MCC description |
| `mcc_category` | string | MCC category |

#### Load
| Field | Type | Description |
|-------|------|-------------|
| `cardNumber` | string | Masked card number |
| `amount` | number | Load amount |
| `description` | string | Load source description |
| `bhd_amount` | number | Amount in BHD |
| `usd_amount` | number | Amount in USD |
| `to_wallet_balance` | number | Balance after load |

---

## 🔗 Data Relationships

| Connection | Description |
|------------|-------------|
| `customerId` = 851276393 | Links all transactions across Rewards & TravelBuddy |
| `cpr` = 851276393 | Links Remittance data |
| `sender_cr` = 851276393 | Links Wallet Transactions |
| `userid` / `ext_uid` = `dffddad7-a500-488b-9946-6a922e941a72` | Links Remittance to Flyy Points |
| User: **VINEET KARUMAT** | All data belongs to this user |

---

## 📊 Data Sources

| API | Excel File | Sheets |
|-----|------------|--------|
| `/api/remittance` | Vineet's Remittance.xlsx | Vineet's Remittance |
| `/api/transactions` | Vineet's Transactions.xlsx | Vineet's Transaction report |
| `/api/rewards` | Vineet-Rewards History.xlsx | Transactions, Load, Flyy points |
| `/api/travelbuddy` | Vineet-TravelBuddy Trxn History.xlsx | Transactions, Load |

---

## 🚀 Quick Start

### Start Server (Local)
```bash
node server.js
```

### Start Server (Docker)
```bash
# Build and run with Docker Compose
docker-compose up -d

# Or build manually
docker build -t bfc-api .
docker run --network host -e PORT=9191 bfc-api

# View logs
docker-compose logs -f

# Stop container
docker-compose down
```

### Test All Endpoints (PowerShell)
```powershell
# Health Check
Invoke-RestMethod -Uri "http://localhost:9191/api/health"

# Remittance
Invoke-RestMethod -Uri "http://localhost:9191/api/remittance"

# Transactions
Invoke-RestMethod -Uri "http://localhost:9191/api/transactions"

# Rewards
Invoke-RestMethod -Uri "http://localhost:9191/api/rewards"

# TravelBuddy
Invoke-RestMethod -Uri "http://localhost:9191/api/travelbuddy"
```

---

## 📝 Error Responses

All endpoints return consistent error format:

```json
{
    "success": false,
    "message": "Error description",
    "data": null
}
```

---

**API Version:** 1.0.0  
**Last Updated:** November 30, 2025
