const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

// This will be injected from server.js
let helpers = null;

function initTestRoutes(deps) {
    helpers = deps;
    return router;
}

// CSV file paths
const USERS_CSV = path.join(__dirname, '..', 'users.csv');
const TRANSACTIONS_CSV = path.join(__dirname, '..', 'transactions.csv');

// ============================================
// HELPER FUNCTIONS
// ============================================

// Helper: Read CSV file with robust parsing
function readCSV(filePath) {
    try {
        if (!fs.existsSync(filePath)) return [];
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.trim().split('\n');
        if (lines.length < 2) return [];

        const headers = lines[0].split(',').map(h => h.trim().replace(/\r/g, ''));

        return lines.slice(1).map(line => {
            // Handle split, respecting potential quotes (simple regex approach for this dataset)
            // Note: This dataset seems simple, standard split is likely sufficient, 
            // but we strip potential extra quotes.
            const values = line.split(',').map(v => v.trim().replace(/\r/g, ''));
            const obj = {};
            headers.forEach((header, index) => {
                let val = values[index] || '';
                // Remove surrounding quotes if present
                if (val.startsWith('"') && val.endsWith('"')) {
                    val = val.slice(1, -1);
                }
                obj[header] = val;
            });
            return obj;
        });
    } catch (err) {
        console.error("Error reading CSV:", err);
        return [];
    }
}

// Helper: Parse Amount to Float safely
function parseAmount(amountStr) {
    if (!amountStr) return 0;
    const cleanStr = amountStr.replace(/,/g, '').replace('BHD', '').trim();
    return parseFloat(cleanStr) || 0;
}

// Helper: Format number to 3 decimal places
function formatBHD(num) {
    return Math.round((num + Number.EPSILON) * 1000) / 1000;
}

// Helper: Generic Filter Logic
function filterTransactions(transactions, filters) {
    return transactions.filter(t => {
        // 1. CPR Filter (Mandatory usually, but handled by caller)
        if (filters.cpr && t.CPR !== filters.cpr) return false;

        // 2. Date Range Filter
        const tDate = new Date(t.Date);
        if (filters.startDate && tDate < new Date(filters.startDate)) return false;
        if (filters.endDate && tDate > new Date(filters.endDate)) return false;

        // 3. Month/Year Shortcut
        if (filters.year) {
            const year = parseInt(filters.year);
            if (tDate.getFullYear() !== year) return false;
            if (filters.month) {
                const month = parseInt(filters.month);
                if ((tDate.getMonth() + 1) !== month) return false;
            }
        }

        // 4. Type Filter (Credit/Debit) - Case insensitive
        if (filters.type && t.Type.toLowerCase() !== filters.type.toLowerCase()) return false;

        // 5. Category Filter (Partial Match)
        if (filters.category && !t.Category.toLowerCase().includes(filters.category.toLowerCase())) return false;

        // 6. Payment Source Filter (Partial Match, e.g. "Credit Card" matches "Credit Card (...9988)")
        if (filters.paymentSource && !t.Payment_Source.toLowerCase().includes(filters.paymentSource.toLowerCase())) return false;

        // 7. Status Filter
        if (filters.status && t.Status.toLowerCase() !== filters.status.toLowerCase()) return false;

        // 8. Amount Range (Absolute value comparison)
        const amt = Math.abs(parseAmount(t.Amount_BHD));
        if (filters.minAmount && amt < parseFloat(filters.minAmount)) return false;
        if (filters.maxAmount && amt > parseFloat(filters.maxAmount)) return false;

        return true;
    });
}

// ============================================
// 1. GET USER SUMMARY (Snapshot)
// ============================================
/**
 * Returns user details + total calculated balance + total income/expense all time.
 */
router.get('/user-summary', async (req, res) => {
    try {
        console.log(`\n--- API CALL: /user-summary ---`);
        console.log(`Query Params:`, req.query);

        const { cpr } = req.query;
        if (!cpr) return res.status(400).json({ success: false, message: "CPR required" });

        const users = readCSV(USERS_CSV);
        const user = users.find(u => u.CPR === cpr);

        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        // Calculate Stats
        const allTransactions = readCSV(TRANSACTIONS_CSV);
        const userTransactions = allTransactions.filter(t => t.CPR === cpr);

        let currentBalance = 0;
        let totalIncome = 0;
        let totalSpend = 0;

        userTransactions.forEach(t => {
            const amt = parseAmount(t.Amount_BHD);
            currentBalance += amt;
            if (amt > 0) totalIncome += amt;
            else totalSpend += Math.abs(amt);
        });

        const responseData = {
            success: true,
            user: {
                cpr: user.CPR,
                full_name: user.FullName,
                date_of_birth: user.DOB,
                mobile: user.Mobile,
                email: user.Email,
                address: {
                    house_flat: user.House_Flat,
                    building: user.Building,
                    road: user.Road,
                    block: user.Block,
                    area: user.Area
                },
                occupation: user.Occupation,
                income_bhd: parseFloat(user.Income_BHD) || 0
            },
            financials: {
                current_balance: formatBHD(currentBalance),
                total_income_all_time: formatBHD(totalIncome),
                total_spend_all_time: formatBHD(totalSpend),
                transaction_count: userTransactions.length
            }
        };

        console.log(`Response Summary: Balance=${responseData.financials.current_balance}, Recs=${responseData.financials.transaction_count}`);
        res.json(responseData);

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================
// 2. GET TRANSACTIONS (Master Search)
// ============================================
/**
 * The "Swiss Army Knife" endpoint.
 * Filters: startDate, endDate, month, year, type, category, paymentSource, status, minAmount, maxAmount.
 * NO PAGINATION - Returns all matching data.
 */
router.get('/transactions', async (req, res) => {
    try {
        console.log(`\n--- API CALL: /transactions ---`);
        console.log(`Query Params:`, req.query);

        const { cpr } = req.query;
        if (!cpr) return res.status(400).json({ success: false, message: "CPR required" });

        const allTransactions = readCSV(TRANSACTIONS_CSV);

        // Use generic filter
        const filtered = filterTransactions(allTransactions, req.query);

        // Sort: Newest First
        filtered.sort((a, b) => b.Date.localeCompare(a.Date));

        // Format for response
        const formattedData = filtered.map(t => ({
            id: t.TransactionID,
            date: t.Date,
            description: t.Description,
            category: t.Category,
            type: t.Type, // Credit / Debit
            amount: parseAmount(t.Amount_BHD),
            status: t.Status,
            payment_source: t.Payment_Source
        }));

        const totalAmount = formattedData.reduce((sum, t) => sum + t.amount, 0);

        console.log(`Found ${formattedData.length} transactions. Net Total: ${formatBHD(totalAmount)}`);

        res.json({
            success: true,
            cpr: cpr,
            count: formattedData.length,
            net_total_of_selection: formatBHD(totalAmount),
            filters_applied: req.query,
            data: formattedData
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================
// 3. GET ANALYTICS (Stats & Breakdowns)
// ============================================
/**
 * Returns aggregated data based on the same filters as /transactions.
 * Useful for "How much did I spend on Food last month?" or "Spending by Card".
 */
router.get('/analytics', async (req, res) => {
    try {
        console.log(`\n--- API CALL: /analytics ---`);
        console.log(`Query Params:`, req.query);

        const { cpr } = req.query;
        if (!cpr) return res.status(400).json({ success: false, message: "CPR required" });

        const allTransactions = readCSV(TRANSACTIONS_CSV);
        const filtered = filterTransactions(allTransactions, req.query);

        let income = 0;
        let expense = 0;
        const categoryMap = {};
        const sourceMap = {};

        filtered.forEach(t => {
            const amt = parseAmount(t.Amount_BHD);
            const absAmt = Math.abs(amt);
            const cat = t.Category || 'Uncategorized';
            const source = t.Payment_Source || 'Unknown';

            if (amt > 0) income += amt;
            else {
                expense += absAmt;

                // Track Category Spending (Only for Debits)
                if (!categoryMap[cat]) categoryMap[cat] = 0;
                categoryMap[cat] += absAmt;

                // Track Payment Source Usage (Only for Debits usually, but let's track volume)
                // Actually, let's track Spending by Source
                if (!sourceMap[source]) sourceMap[source] = 0;
                sourceMap[source] += absAmt;
            }
        });

        // Convert Maps to Arrays
        const categories = Object.keys(categoryMap).map(k => ({
            name: k,
            total: formatBHD(categoryMap[k]),
            percentage: expense > 0 ? Math.round((categoryMap[k] / expense) * 100) : 0
        })).sort((a, b) => b.total - a.total);

        const sources = Object.keys(sourceMap).map(k => ({
            name: k,
            total: formatBHD(sourceMap[k]),
            percentage: expense > 0 ? Math.round((sourceMap[k] / expense) * 100) : 0
        })).sort((a, b) => b.total - a.total);

        const responseData = {
            success: true,
            cpr: cpr,
            period_summary: {
                total_income: formatBHD(income),
                total_expense: formatBHD(expense),
                net_flow: formatBHD(income - expense),
                transaction_count: filtered.length
            },
            breakdown_by_category: categories,
            breakdown_by_payment_source: sources
        };

        console.log(`Analytics Generated: Income=${responseData.period_summary.total_income}, Expense=${responseData.period_summary.total_expense}`);
        res.json(responseData);

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================
// 4. GET METADATA (Autocomplete Helpers)
// ============================================
/**
 * Returns unique Categories and Payment Sources available for this user.
 * Helps the AI know what strings to query.
 */
router.get('/metadata', async (req, res) => {
    try {
        const { cpr } = req.query;
        if (!cpr) return res.status(400).json({ success: false, message: "CPR required" });

        const allTransactions = readCSV(TRANSACTIONS_CSV);
        const userTransactions = allTransactions.filter(t => t.CPR === cpr);

        const uniqueCategories = [...new Set(userTransactions.map(t => t.Category))].filter(Boolean).sort();
        const uniqueSources = [...new Set(userTransactions.map(t => t.Payment_Source))].filter(Boolean).sort();
        const years = [...new Set(userTransactions.map(t => t.Date.substring(0, 4)))].sort();

        res.json({
            success: true,
            available_data: {
                years: years,
                categories: uniqueCategories,
                payment_sources: uniqueSources
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = initTestRoutes;