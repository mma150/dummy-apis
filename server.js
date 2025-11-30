const express = require('express');
const app = express();
const PORT = process.env.PORT || 9191;

app.use(express.json());

// ============================================
// STATIC DATA FROM EXCEL SHEETS
// ============================================

// 1. Remittance Data (Vineet's Remittance.xlsx)
const remittanceData = [
    {
        amount: 200,
        fee: 1.5,
        admindeposit: false,
        tax: 0.15,
        tabibdata_isprimary: false,
        issuerid: null,
        pgreferenceid: "PR00000007762555",
        trycount: 2,
        _id: "6747276f66fc550012e41f27",
        typeofservice: "paid",
        biller_type: null,
        timestamp_created: "Nov 27, 2024, 5:06 PM",
        paymentmode: "BFC Wallet",
        userid: "dffddad7-a500-488b-9946-6a922e941a72",
        transactionid: "BHCTA202411270109534",
        currency: null,
        biller_name: null,
        timestamp_updated: "Nov 27, 2024, 5:07 PM",
        total_amount_bhd: 201.65,
        paymenttype: "REMITTANCE",
        cpr: 851276393,
        status: true
    },
    {
        amount: 10,
        fee: 1.5,
        admindeposit: false,
        tax: 0.15,
        tabibdata_isprimary: false,
        issuerid: null,
        pgreferenceid: "BHCTA202408220107686",
        trycount: 2,
        _id: "66c75baa42fe4c0011b9e8b9",
        typeofservice: "paid",
        biller_type: null,
        timestamp_created: "Aug 22, 2024, 6:39 PM",
        paymentmode: "Benefit Pay",
        userid: "dffddad7-a500-488b-9946-6a922e941a72",
        transactionid: "BHCTA202408220107686",
        currency: null,
        biller_name: null,
        timestamp_updated: "Aug 22, 2024, 6:40 PM",
        total_amount_bhd: 11.65,
        paymenttype: "REMITTANCE",
        cpr: 851276393,
        status: true
    },
    {
        amount: 20,
        fee: 1.5,
        admindeposit: false,
        tax: 0.15,
        tabibdata_isprimary: false,
        issuerid: null,
        pgreferenceid: "BHCTA202408210111171",
        trycount: 2,
        _id: "66c638789cf02c001276d1cf",
        typeofservice: "paid",
        biller_type: null,
        timestamp_created: "Aug 21, 2024, 9:56 PM",
        paymentmode: "Benefit Pay",
        userid: "dffddad7-a500-488b-9946-6a922e941a72",
        transactionid: "BHCTA202408210111171",
        currency: null,
        biller_name: null,
        timestamp_updated: "Aug 21, 2024, 9:58 PM",
        total_amount_bhd: 21.65,
        paymenttype: "REMITTANCE",
        cpr: 851276393,
        status: true
    },
    {
        amount: 20,
        fee: 1.5,
        admindeposit: false,
        tax: 0.15,
        tabibdata_isprimary: false,
        issuerid: null,
        pgreferenceid: "BHCTA202408200104765",
        trycount: 2,
        _id: "66c47a8d09dd490011aa44e8",
        typeofservice: "paid",
        biller_type: null,
        timestamp_created: "Aug 20, 2024, 2:14 PM",
        paymentmode: "Benefit Pay",
        userid: "dffddad7-a500-488b-9946-6a922e941a72",
        transactionid: "BHCTA202408200104765",
        currency: null,
        biller_name: null,
        timestamp_updated: "Aug 20, 2024, 2:17 PM",
        total_amount_bhd: 21.65,
        paymenttype: "REMITTANCE",
        cpr: 851276393,
        status: true
    }
];

// 2. Transactions Data (Vineet's Transactions.xlsx)
const transactionsData = [
    {
        sender_account_number: "200227690172815",
        msisdn: "34017726",
        created_date: "Nov 15, 2025, 6:00 AM",
        _id: "6917ecb56bc2954135c56eed",
        reverse: false,
        batch_id: "AUB000004650579",
        transaction_date: "14/11/2025 07:25:18",
        original_transaction_type: null,
        sender_type: "CPR",
        transaction_type: "TRAVEL_CARD_LOAD",
        credit: false,
        credit_debit: "Debit",
        sub_transaction_type: "TRAVEL_CARD_LOAD",
        transaction_reference: "PR00000010308008",
        iban_number: null,
        available_balance: 312000,
        available_balance_bhd: 312,
        aub_reference: null,
        bfc_type: "PAYMENTS",
        transaction_status: "SUCCESS",
        dynamic_escrow_report: true,
        status: "FILE_CREATED",
        account_currency: "BHD",
        account_level: "GPW",
        original_transaction_number: null,
        acquiring_country_code: null,
        sender_cr: 851276393,
        mcc: null,
        sender_name: "VINEET KARUMAT",
        transaction_date_time: "Nov 14, 2025, 10:25 AM",
        bi_status: "FILE_CREATED",
        description: null,
        amount: -100000,
        transacted_amount_bhd: -100
    },
    {
        sender_account_number: "200227690172815",
        msisdn: "34017726",
        created_date: "Nov 15, 2025, 6:00 AM",
        _id: "6917ecb56bc2954135c56eeb",
        reverse: false,
        batch_id: "AUB000004650579",
        transaction_date: "14/11/2025 07:25:00",
        original_transaction_type: null,
        sender_type: "CPR",
        transaction_type: "IBAN_IN_CREDIT",
        credit: true,
        credit_debit: "Credit",
        sub_transaction_type: "IBAN_IN_CREDIT",
        transaction_reference: "PR00000010307392",
        iban_number: "BH43AUBB09996000022555",
        available_balance: 412000,
        available_balance_bhd: 412,
        aub_reference: "IPS103JJA001D8KB",
        bfc_type: "TOPUPS",
        transaction_status: "SUCCESS",
        dynamic_escrow_report: false,
        status: "FILE_CREATED",
        account_currency: "BHD",
        account_level: "GPW",
        original_transaction_number: null,
        acquiring_country_code: null,
        sender_cr: 851276393,
        mcc: null,
        sender_name: "VINEET KARUMAT",
        transaction_date_time: "Nov 14, 2025, 10:25 AM",
        bi_status: "FILE_CREATED",
        description: null,
        amount: 400000,
        transacted_amount_bhd: 400
    },
    {
        sender_account_number: "200227690172815",
        msisdn: "34017726",
        created_date: "Nov 13, 2025, 6:00 AM",
        _id: "691549b56b8a6a88b4f05772",
        reverse: false,
        batch_id: "AUB000004644641",
        transaction_date: "12/11/2025 13:44:00",
        original_transaction_type: null,
        sender_type: "CPR",
        transaction_type: "CASH_BACK",
        credit: true,
        credit_debit: "Credit",
        sub_transaction_type: "CASH_BACK",
        transaction_reference: "PR00000010289776",
        iban_number: null,
        available_balance: 12000,
        available_balance_bhd: 12,
        aub_reference: null,
        bfc_type: "W2W",
        transaction_status: "SUCCESS",
        dynamic_escrow_report: false,
        status: "FILE_CREATED",
        account_currency: "BHD",
        account_level: "GPW",
        original_transaction_number: null,
        acquiring_country_code: null,
        sender_cr: 851276393,
        mcc: null,
        sender_name: "VINEET KARUMAT",
        transaction_date_time: "Nov 12, 2025, 1:44 PM",
        bi_status: "FILE_CREATED",
        description: "CASH BACK",
        amount: 10000,
        transacted_amount_bhd: 10
    },
    {
        sender_account_number: "200227690172815",
        msisdn: "34017726",
        created_date: "Nov 9, 2025, 6:00 AM",
        _id: "691003b8a3aa1ecfd0f94aea",
        reverse: false,
        batch_id: "AUB000004634840",
        transaction_date: "08/11/2025 20:05:00",
        original_transaction_type: null,
        sender_type: "CPR",
        transaction_type: "TRAVEL_CARD_LOAD",
        credit: false,
        credit_debit: "Debit",
        sub_transaction_type: "TRAVEL_CARD_LOAD",
        transaction_reference: "PR00000010266692",
        iban_number: null,
        available_balance: 2000,
        available_balance_bhd: 2,
        aub_reference: null,
        bfc_type: "PAYMENTS",
        transaction_status: "SUCCESS",
        dynamic_escrow_report: true,
        status: "FILE_CREATED",
        account_currency: "BHD",
        account_level: "GPW",
        original_transaction_number: null,
        acquiring_country_code: null,
        sender_cr: 851276393,
        mcc: null,
        sender_name: "VINEET KARUMAT",
        transaction_date_time: "Nov 8, 2025, 8:05 PM",
        bi_status: "FILE_CREATED",
        description: null,
        amount: -100000,
        transacted_amount_bhd: -100
    }
];

// 3. Rewards History Data (Vineet-Rewards History.xlsx)
const rewardsData = {
    transactions: [
        {
            txn_date: "2025-01-01 10:00:19",
            customerId: 851276393,
            transactionType_dsc: "POS",
            status_desc: "PAYMENT_SUCCESS",
            otherPartyName: "GOLF VIEW HOMES LIMITE MADIKERI IN",
            mcc: 7011,
            acquirer_country_code: "0356",
            bhd_amount: 329.054,
            markup: 8.22635,
            crdr: "DR",
            domestic_international: "International",
            country: "India",
            mcc_name: "LODGING,HOTELS,MOTELS,RESORTS",
            mcc_category: "Hotels & Guest Houses"
        },
        {
            txn_date: "2025-01-01 13:32:41",
            customerId: 851276393,
            transactionType_dsc: "POS",
            status_desc: "PAYMENT_SUCCESS",
            otherPartyName: "BEGUR VANSREE ECO SHOP CEWAYANAD IN",
            mcc: 9399,
            acquirer_country_code: "0356",
            bhd_amount: 3.93,
            markup: 0.09825,
            crdr: "DR",
            domestic_international: "International",
            country: "India",
            mcc_name: "GOVERNMENT SERVICES (NEC) OR FIRE DEPARTMENTS",
            mcc_category: "Government Payments"
        },
        {
            txn_date: "2025-01-02 13:27:07",
            customerId: 851276393,
            transactionType_dsc: "POS",
            status_desc: "PAYMENT_SUCCESS",
            otherPartyName: "THE RAVIZ RESORT AND SPA MALAPPURAM IN",
            mcc: 7011,
            acquirer_country_code: "0356",
            bhd_amount: 14.186,
            markup: 0.35465,
            crdr: "DR",
            domestic_international: "International",
            country: "India",
            mcc_name: "LODGING,HOTELS,MOTELS,RESORTS",
            mcc_category: "Hotels & Guest Houses"
        },
        {
            txn_date: "2025-01-02 14:04:41",
            customerId: 851276393,
            transactionType_dsc: "ECOM",
            status_desc: "PAYMENT_SUCCESS",
            otherPartyName: "CANVA* I04384-27621380 +17372853388 US",
            mcc: 7333,
            acquirer_country_code: "0840",
            bhd_amount: 5.812,
            markup: 0.1453,
            crdr: "DR",
            domestic_international: "International",
            country: "United States",
            mcc_name: "PHOTOGRAPHY, ART AND GRAPHIC -- COMMERCIAL",
            mcc_category: "Other Services"
        }
    ],
    load: [
        {
            txn_date: "2024-04-04 18:43:07",
            customerId: 851276393,
            kitNumber: 10005544,
            cardNumber: "4560XXXXXXXX5443",
            externalTxnId: "BFCMC240404154214579302",
            amount: 20,
            actTxnAmount: 20,
            transactionType_dsc: "LOAD",
            status_desc: "PAYMENT_SUCCESS",
            crdr: "CR",
            otherPartyName: "M2P Business",
            currency: "048",
            product: "GENERAL",
            description: "LOAD MONEY FROM BENEFITAPP",
            activationDate: "2023-05-19",
            to_bhd_cc_rate: 1,
            bhd_amount: 20,
            to_usd_cc_rate: 2.6517,
            usd_amount: 53.03,
            to_wallet_balance: 29.161
        },
        {
            txn_date: "2024-04-15 11:08:38",
            customerId: 851276393,
            kitNumber: 10005544,
            cardNumber: "4560XXXXXXXX5443",
            externalTxnId: "BFCMC240415080748877288",
            amount: 50,
            actTxnAmount: 50,
            transactionType_dsc: "LOAD",
            status_desc: "PAYMENT_SUCCESS",
            crdr: "CR",
            otherPartyName: "M2P Business",
            currency: "048",
            product: "GENERAL",
            description: "LOAD MONEY FROM BENEFITAPP",
            activationDate: "2023-05-19",
            to_bhd_cc_rate: 1,
            bhd_amount: 50,
            to_usd_cc_rate: 2.6517,
            usd_amount: 132.58,
            to_wallet_balance: 71.981
        },
        {
            txn_date: "2024-04-16 15:42:22",
            customerId: 851276393,
            kitNumber: 10005544,
            cardNumber: "4560XXXXXXXX5443",
            externalTxnId: "BFCMC240416124145909361",
            amount: 100,
            actTxnAmount: 100,
            transactionType_dsc: "LOAD",
            status_desc: "PAYMENT_SUCCESS",
            crdr: "CR",
            otherPartyName: "M2P Business",
            currency: "048",
            product: "GENERAL",
            description: "LOAD MONEY FROM BENEFITAPP",
            activationDate: "2023-05-19",
            to_bhd_cc_rate: 1,
            bhd_amount: 100,
            to_usd_cc_rate: 2.6517,
            usd_amount: 265.17,
            to_wallet_balance: 123.611
        }
    ],
    flyy_points: [
        {
            ext_uid: "dffddad7-a500-488b-9946-6a922e941a72",
            points: 10000,
            reference_number: "FLYY_60VUV3Z7",
            message: "Cashback",
            type: "debit",
            created_at: "2025-11-13"
        },
        {
            ext_uid: "dffddad7-a500-488b-9946-6a922e941a72",
            points: 6950,
            reference_number: "SJ0wL",
            message: "Earned for Mc Successful Transaction",
            type: "credit",
            created_at: "2025-11-03"
        },
        {
            ext_uid: "dffddad7-a500-488b-9946-6a922e941a72",
            points: 50,
            reference_number: "ASj3n",
            message: "Earned for Mc Successful Transaction",
            type: "credit",
            created_at: "2025-11-03"
        },
        {
            ext_uid: "dffddad7-a500-488b-9946-6a922e941a72",
            points: 500,
            reference_number: "2wdn8",
            message: "Weekly Bonus Cashback",
            type: "credit",
            created_at: "2025-10-26"
        }
    ]
};

// 4. TravelBuddy Transactions Data (Vineet-TravelBuddy Trxn History.xlsx)
const travelBuddyData = {
    transactions: [
        {
            txn_date: "2025-01-01 10:00:19",
            customerId: 851276393,
            transactionType_dsc: "POS",
            status_desc: "PAYMENT_SUCCESS",
            otherPartyName: "GOLF VIEW HOMES LIMITE MADIKERI IN",
            mcc: 7011,
            acquirer_country_code: "0356",
            bhd_amount: 329.054,
            markup: 8.22635,
            crdr: "DR",
            domestic_international: "International",
            country: "India",
            mcc_name: "LODGING,HOTELS,MOTELS,RESORTS",
            mcc_category: "Hotels & Guest Houses"
        },
        {
            txn_date: "2025-01-01 13:32:41",
            customerId: 851276393,
            transactionType_dsc: "POS",
            status_desc: "PAYMENT_SUCCESS",
            otherPartyName: "BEGUR VANSREE ECO SHOP CEWAYANAD IN",
            mcc: 9399,
            acquirer_country_code: "0356",
            bhd_amount: 3.93,
            markup: 0.09825,
            crdr: "DR",
            domestic_international: "International",
            country: "India",
            mcc_name: "GOVERNMENT SERVICES (NEC) OR FIRE DEPARTMENTS",
            mcc_category: "Government Payments"
        },
        {
            txn_date: "2025-01-02 13:27:07",
            customerId: 851276393,
            transactionType_dsc: "POS",
            status_desc: "PAYMENT_SUCCESS",
            otherPartyName: "THE RAVIZ RESORT AND SPA MALAPPURAM IN",
            mcc: 7011,
            acquirer_country_code: "0356",
            bhd_amount: 14.186,
            markup: 0.35465,
            crdr: "DR",
            domestic_international: "International",
            country: "India",
            mcc_name: "LODGING,HOTELS,MOTELS,RESORTS",
            mcc_category: "Hotels & Guest Houses"
        },
        {
            txn_date: "2025-01-02 14:04:41",
            customerId: 851276393,
            transactionType_dsc: "ECOM",
            status_desc: "PAYMENT_SUCCESS",
            otherPartyName: "CANVA* I04384-27621380 +17372853388 US",
            mcc: 7333,
            acquirer_country_code: "0840",
            bhd_amount: 5.812,
            markup: 0.1453,
            crdr: "DR",
            domestic_international: "International",
            country: "United States",
            mcc_name: "PHOTOGRAPHY, ART AND GRAPHIC -- COMMERCIAL",
            mcc_category: "Other Services"
        }
    ],
    load: [
        {
            txn_date: "2024-04-04 18:43:07",
            customerId: 851276393,
            kitNumber: 10005544,
            cardNumber: "4560XXXXXXXX5443",
            externalTxnId: "BFCMC240404154214579302",
            amount: 20,
            actTxnAmount: 20,
            transactionType_dsc: "LOAD",
            status_desc: "PAYMENT_SUCCESS",
            crdr: "CR",
            otherPartyName: "M2P Business",
            currency: "048",
            product: "GENERAL",
            description: "LOAD MONEY FROM BENEFITAPP",
            activationDate: "2023-05-19",
            to_bhd_cc_rate: 1,
            bhd_amount: 20,
            to_usd_cc_rate: 2.6517,
            usd_amount: 53.03,
            to_wallet_balance: 29.161
        },
        {
            txn_date: "2024-04-15 11:08:38",
            customerId: 851276393,
            kitNumber: 10005544,
            cardNumber: "4560XXXXXXXX5443",
            externalTxnId: "BFCMC240415080748877288",
            amount: 50,
            actTxnAmount: 50,
            transactionType_dsc: "LOAD",
            status_desc: "PAYMENT_SUCCESS",
            crdr: "CR",
            otherPartyName: "M2P Business",
            currency: "048",
            product: "GENERAL",
            description: "LOAD MONEY FROM BENEFITAPP",
            activationDate: "2023-05-19",
            to_bhd_cc_rate: 1,
            bhd_amount: 50,
            to_usd_cc_rate: 2.6517,
            usd_amount: 132.58,
            to_wallet_balance: 71.981
        },
        {
            txn_date: "2024-04-16 15:42:22",
            customerId: 851276393,
            kitNumber: 10005544,
            cardNumber: "4560XXXXXXXX5443",
            externalTxnId: "BFCMC240416124145909361",
            amount: 100,
            actTxnAmount: 100,
            transactionType_dsc: "LOAD",
            status_desc: "PAYMENT_SUCCESS",
            crdr: "CR",
            otherPartyName: "M2P Business",
            currency: "048",
            product: "GENERAL",
            description: "LOAD MONEY FROM BENEFITAPP",
            activationDate: "2023-05-19",
            to_bhd_cc_rate: 1,
            bhd_amount: 100,
            to_usd_cc_rate: 2.6517,
            usd_amount: 265.17,
            to_wallet_balance: 123.611
        }
    ]
};

// ============================================
// API ENDPOINTS
// ============================================

// 1. Remittance History API
app.get('/api/remittance', (req, res) => {
    const { cpr, paymentmode, status } = req.query;
    
    let filteredData = [...remittanceData];
    
    if (cpr) {
        filteredData = filteredData.filter(item => item.cpr == cpr);
    }
    if (paymentmode) {
        filteredData = filteredData.filter(item => 
            item.paymentmode.toLowerCase().includes(paymentmode.toLowerCase())
        );
    }
    if (status !== undefined) {
        filteredData = filteredData.filter(item => item.status === (status === 'true'));
    }
    
    res.json({
        success: true,
        message: "Remittance history fetched successfully",
        total_records: filteredData.length,
        data: filteredData
    });
});

// 2. Transactions History API
app.get('/api/transactions', (req, res) => {
    const { sender_cr, transaction_type, transaction_status, credit_debit } = req.query;
    
    let filteredData = [...transactionsData];
    
    if (sender_cr) {
        filteredData = filteredData.filter(item => item.sender_cr == sender_cr);
    }
    if (transaction_type) {
        filteredData = filteredData.filter(item => 
            item.transaction_type.toLowerCase().includes(transaction_type.toLowerCase())
        );
    }
    if (transaction_status) {
        filteredData = filteredData.filter(item => 
            item.transaction_status.toLowerCase() === transaction_status.toLowerCase()
        );
    }
    if (credit_debit) {
        filteredData = filteredData.filter(item => 
            item.credit_debit.toLowerCase() === credit_debit.toLowerCase()
        );
    }
    
    res.json({
        success: true,
        message: "Transaction history fetched successfully",
        total_records: filteredData.length,
        data: filteredData
    });
});

// 3. Rewards History API
app.get('/api/rewards', (req, res) => {
    const { customerId, type } = req.query;
    
    let response = { ...rewardsData };
    
    if (customerId) {
        response.transactions = response.transactions.filter(item => item.customerId == customerId);
        response.load = response.load.filter(item => item.customerId == customerId);
        response.flyy_points = response.flyy_points; // flyy_points linked via ext_uid
    }
    
    // Filter by type: transactions, load, flyy_points, or all
    if (type) {
        if (type === 'transactions') {
            response = { transactions: response.transactions };
        } else if (type === 'load') {
            response = { load: response.load };
        } else if (type === 'flyy_points') {
            response = { flyy_points: response.flyy_points };
        }
    }
    
    res.json({
        success: true,
        message: "Rewards history fetched successfully",
        data: response
    });
});

// 4. TravelBuddy Transaction History API
app.get('/api/travelbuddy', (req, res) => {
    const { customerId, type, country, transactionType } = req.query;
    
    let response = { ...travelBuddyData };
    
    if (customerId) {
        response.transactions = response.transactions.filter(item => item.customerId == customerId);
        response.load = response.load.filter(item => item.customerId == customerId);
    }
    
    if (country) {
        response.transactions = response.transactions.filter(item => 
            item.country && item.country.toLowerCase().includes(country.toLowerCase())
        );
    }
    
    if (transactionType) {
        response.transactions = response.transactions.filter(item => 
            item.transactionType_dsc.toLowerCase() === transactionType.toLowerCase()
        );
    }
    
    // Filter by type: transactions, load, or all
    if (type) {
        if (type === 'transactions') {
            response = { transactions: response.transactions };
        } else if (type === 'load') {
            response = { load: response.load };
        }
    }
    
    res.json({
        success: true,
        message: "TravelBuddy transaction history fetched successfully",
        data: response
    });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        message: "Server is running",
        timestamp: new Date().toISOString()
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log('\nAvailable endpoints:');
    console.log('  GET /api/remittance     - Get remittance history');
    console.log('  GET /api/transactions   - Get transaction history');
    console.log('  GET /api/rewards        - Get rewards history');
    console.log('  GET /api/travelbuddy    - Get TravelBuddy transaction history');
    console.log('  GET /api/health         - Health check');
});
