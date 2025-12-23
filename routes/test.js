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

// Helper function to read CSV file
function readCSV(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim().replace(/\r/g, ''));

    return lines.slice(1).map(line => {
        const values = line.split(',').map(v => v.trim().replace(/\r/g, ''));
        const obj = {};
        headers.forEach((header, index) => {
            obj[header] = values[index] || null;
        });
        return obj;
    });
}

// Helper function to parse date from CSV (YYYY-MM-DD format)
function parseCSVDate(dateStr) {
    if (!dateStr) return null;
    const parts = dateStr.split('-');
    if (parts.length === 3) {
        return new Date(parts[0], parseInt(parts[1]) - 1, parts[2]);
    }
    return null;
}

// Helper function to check if date is in specific month/year
function isDateInMonth(dateStr, month, year) {
    const date = parseCSVDate(dateStr);
    if (!date) return false;
    return date.getMonth() + 1 === parseInt(month) && date.getFullYear() === parseInt(year);
}

// ============================================
// 1. GET USER DETAILS BY CPR (Validation)
// ============================================

/**
 * @swagger
 * /api/test/user-details:
 *   get:
 *     summary: Get user details by CPR for validation
 *     tags: [Test APIs]
 *     parameters:
 *       - in: query
 *         name: cpr
 *         required: true
 *         schema: { type: string }
 *         description: User's CPR number
 *     responses:
 *       200:
 *         description: User details
 *       404:
 *         description: User not found
 */
router.get('/user-details', async (req, res) => {
    try {
        const { cpr } = req.query;

        if (!cpr) {
            return res.status(400).json({
                success: false,
                message: "CPR parameter is required"
            });
        }

        // Read users from CSV
        const users = readCSV(USERS_CSV);

        // Find user by CPR
        const user = users.find(u => u.CPR === cpr);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: `User with CPR ${cpr} not found`
            });
        }

        res.json({
            success: true,
            message: "User details fetched successfully",
            data: {
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
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching user details",
            error: error.message
        });
    }
});

// ============================================
// 2. GET MONTHLY TRANSACTIONS SUMMARY
// ============================================

/**
 * @swagger
 * /api/test/monthly-transactions-summary:
 *   get:
 *     summary: Get monthly transaction summary for a CPR
 *     tags: [Test APIs]
 *     parameters:
 *       - in: query
 *         name: cpr
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: month
 *         schema: { type: integer }
 *         description: Month (1-12), defaults to current month
 *       - in: query
 *         name: year
 *         schema: { type: integer }
 *         description: Year (YYYY), defaults to current year
 *     responses:
 *       200:
 *         description: Monthly transaction summary
 */
router.get('/monthly-transactions-summary', async (req, res) => {
    try {
        const { cpr } = req.query;
        const now = new Date();
        const month = req.query.month ? parseInt(req.query.month) : now.getMonth() + 1;
        const year = req.query.year ? parseInt(req.query.year) : now.getFullYear();

        if (!cpr) {
            return res.status(400).json({
                success: false,
                message: "CPR parameter is required"
            });
        }

        // Read transactions from CSV
        const allTransactions = readCSV(TRANSACTIONS_CSV);

        // Filter by CPR and month/year
        const transactions = allTransactions.filter(t =>
            t.CPR === cpr && isDateInMonth(t.Date, month, year)
        );

        if (transactions.length === 0) {
            return res.json({
                success: true,
                message: "No transactions found for the specified period",
                cpr: cpr,
                period: `${month}/${year}`,
                summary: {
                    total_transactions: 0,
                    total_credits: 0,
                    total_debits: 0,
                    net_amount: 0,
                    credit_count: 0,
                    debit_count: 0
                }
            });
        }

        // Calculate summary
        let totalCredits = 0;
        let totalDebits = 0;
        let creditCount = 0;
        let debitCount = 0;
        const categoryBreakdown = {};
        const statusBreakdown = {};

        transactions.forEach(t => {
            const amount = parseFloat(t.Amount_BHD) || 0;
            const type = t.Type;
            const category = t.Category || 'Uncategorized';
            const status = t.Status || 'Unknown';

            if (type === 'Credit') {
                totalCredits += amount;
                creditCount++;
            } else if (type === 'Debit') {
                totalDebits += Math.abs(amount);
                debitCount++;
            }

            // Category breakdown
            if (!categoryBreakdown[category]) {
                categoryBreakdown[category] = { amount: 0, count: 0 };
            }
            categoryBreakdown[category].amount += Math.abs(amount);
            categoryBreakdown[category].count++;

            // Status breakdown
            if (!statusBreakdown[status]) {
                statusBreakdown[status] = 0;
            }
            statusBreakdown[status]++;
        });

        // Format category breakdown
        const categories = Object.entries(categoryBreakdown)
            .map(([name, data]) => ({
                category: name,
                total_amount: Math.round(data.amount * 1000) / 1000,
                transaction_count: data.count
            }))
            .sort((a, b) => b.total_amount - a.total_amount);

        res.json({
            success: true,
            message: "Monthly transaction summary fetched successfully",
            cpr: cpr,
            period: `${month}/${year}`,
            summary: {
                total_transactions: transactions.length,
                total_credits: Math.round(totalCredits * 1000) / 1000,
                total_debits: Math.round(totalDebits * 1000) / 1000,
                net_amount: Math.round((totalCredits - totalDebits) * 1000) / 1000,
                credit_count: creditCount,
                debit_count: debitCount,
                by_category: categories,
                by_status: statusBreakdown
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching monthly transaction summary",
            error: error.message
        });
    }
});

// ============================================
// 3. GET MONTHLY TRANSACTIONS DETAILED
// ============================================

/**
 * @swagger
 * /api/test/monthly-transactions:
 *   get:
 *     summary: Get detailed monthly transactions for a CPR
 *     tags: [Test APIs]
 *     parameters:
 *       - in: query
 *         name: cpr
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: month
 *         schema: { type: integer }
 *       - in: query
 *         name: year
 *         schema: { type: integer }
 *       - in: query
 *         name: type
 *         schema: { type: string }
 *         description: Filter by type (Credit/Debit)
 *       - in: query
 *         name: category
 *         schema: { type: string }
 *         description: Filter by category
 *     responses:
 *       200:
 *         description: Detailed monthly transactions
 */
router.get('/monthly-transactions', async (req, res) => {
    try {
        const { cpr, type, category } = req.query;
        const now = new Date();
        const month = req.query.month ? parseInt(req.query.month) : now.getMonth() + 1;
        const year = req.query.year ? parseInt(req.query.year) : now.getFullYear();

        if (!cpr) {
            return res.status(400).json({
                success: false,
                message: "CPR parameter is required"
            });
        }

        // Read transactions from CSV
        const allTransactions = readCSV(TRANSACTIONS_CSV);

        // Filter by CPR and month/year
        let transactions = allTransactions.filter(t =>
            t.CPR === cpr && isDateInMonth(t.Date, month, year)
        );

        // Apply additional filters
        if (type) {
            transactions = transactions.filter(t =>
                t.Type && t.Type.toLowerCase() === type.toLowerCase()
            );
        }

        if (category) {
            transactions = transactions.filter(t =>
                t.Category && t.Category.toLowerCase().includes(category.toLowerCase())
            );
        }

        // Format transactions
        const formattedTransactions = transactions.map(t => ({
            transaction_id: t.TransactionID,
            date: t.Date,
            description: t.Description,
            type: t.Type,
            amount_bhd: parseFloat(t.Amount_BHD) || 0,
            category: t.Category,
            status: t.Status,
            payment_source: t.Payment_Source
        }));

        // Calculate totals
        const totalAmount = formattedTransactions.reduce((sum, t) =>
            sum + Math.abs(t.amount_bhd), 0
        );

        res.json({
            success: true,
            message: "Monthly transactions fetched successfully",
            cpr: cpr,
            period: `${month}/${year}`,
            filters_applied: {
                type: type || 'All',
                category: category || 'All'
            },
            total_records: formattedTransactions.length,
            total_amount: Math.round(totalAmount * 1000) / 1000,
            data: formattedTransactions
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching monthly transactions",
            error: error.message
        });
    }
});

// ============================================
// 4. GET ALL TRANSACTIONS BY CPR
// ============================================

/**
 * @swagger
 * /api/test/all-transactions:
 *   get:
 *     summary: Get all transactions for a CPR
 *     tags: [Test APIs]
 *     parameters:
 *       - in: query
 *         name: cpr
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *         description: Number of records to return
 *       - in: query
 *         name: offset
 *         schema: { type: integer }
 *         description: Pagination offset
 *       - in: query
 *         name: type
 *         schema: { type: string }
 *         description: Filter by type (Credit/Debit)
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *         description: Filter by status
 *     responses:
 *       200:
 *         description: All transactions for the CPR
 */
router.get('/all-transactions', async (req, res) => {
    try {
        const { cpr, type, status } = req.query;
        const limit = req.query.limit ? parseInt(req.query.limit) : 100;
        const offset = req.query.offset ? parseInt(req.query.offset) : 0;

        if (!cpr) {
            return res.status(400).json({
                success: false,
                message: "CPR parameter is required"
            });
        }

        // Read transactions from CSV
        const allTransactions = readCSV(TRANSACTIONS_CSV);

        // Filter by CPR
        let transactions = allTransactions.filter(t => t.CPR === cpr);

        // Apply additional filters
        if (type) {
            transactions = transactions.filter(t =>
                t.Type && t.Type.toLowerCase() === type.toLowerCase()
            );
        }

        if (status) {
            transactions = transactions.filter(t =>
                t.Status && t.Status.toLowerCase() === status.toLowerCase()
            );
        }

        // Sort by date (newest first)
        transactions.sort((a, b) => {
            const dateA = parseCSVDate(a.Date);
            const dateB = parseCSVDate(b.Date);
            return dateB - dateA;
        });

        const totalRecords = transactions.length;

        // Apply pagination
        const paginatedTransactions = transactions.slice(offset, offset + limit);

        // Format transactions
        const formattedTransactions = paginatedTransactions.map(t => ({
            transaction_id: t.TransactionID,
            date: t.Date,
            description: t.Description,
            type: t.Type,
            amount_bhd: parseFloat(t.Amount_BHD) || 0,
            category: t.Category,
            status: t.Status,
            payment_source: t.Payment_Source
        }));

        // Calculate summary statistics
        const credits = transactions.filter(t => t.Type === 'Credit');
        const debits = transactions.filter(t => t.Type === 'Debit');
        const totalCredits = credits.reduce((sum, t) => sum + (parseFloat(t.Amount_BHD) || 0), 0);
        const totalDebits = debits.reduce((sum, t) => sum + Math.abs(parseFloat(t.Amount_BHD) || 0), 0);

        res.json({
            success: true,
            message: "All transactions fetched successfully",
            cpr: cpr,
            filters_applied: {
                type: type || 'All',
                status: status || 'All'
            },
            pagination: {
                total_records: totalRecords,
                limit: limit,
                offset: offset,
                showing: formattedTransactions.length
            },
            summary: {
                total_credits: Math.round(totalCredits * 1000) / 1000,
                total_debits: Math.round(totalDebits * 1000) / 1000,
                net_amount: Math.round((totalCredits - totalDebits) * 1000) / 1000,
                credit_count: credits.length,
                debit_count: debits.length
            },
            data: formattedTransactions
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching all transactions",
            error: error.message
        });
    }
});

module.exports = initTestRoutes;
