const express = require('express');
const router = express.Router();

// This will be injected from server.js
let helpers = null;

function initTransactionsRoutes(deps) {
    helpers = deps;
    return router;
}

// ============================================
// TRANSACTIONS DATA API
// ============================================

/**
 * @swagger
 * /api/transactions:
 *   get:
 *     summary: Get transaction history
 *     tags: [Transactions]
 *     parameters:
 *       - in: query
 *         name: month
 *         schema: { type: integer }
 *       - in: query
 *         name: year
 *         schema: { type: integer }
 *       - in: query
 *         name: all
 *         schema: { type: boolean }
 *       - in: query
 *         name: sender_cr
 *         schema: { type: string }
 *       - in: query
 *         name: transaction_type
 *         schema: { type: string }
 *       - in: query
 *         name: transaction_status
 *         schema: { type: string }
 *       - in: query
 *         name: credit_debit
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Transaction history
 */
router.get('/', async (req, res) => {
    try {
        const { sender_cr, transaction_type, transaction_status, credit_debit } = req.query;
        const { month, year, all } = helpers.getMonthFilter(req.query);

        // Read data from Excel file
        let data = await helpers.readExcelSheet(helpers.EXCEL_FILES.transactions);

        // Apply month filter (default: current month) unless all=true
        if (!all) {
            data = data.filter(item => helpers.isDateInMonth(item.transaction_date_time || item.created_date, month, year));
        }

        // Apply filters
        if (sender_cr) {
            data = data.filter(item => item.sender_cr == sender_cr);
        }
        if (transaction_type) {
            data = data.filter(item =>
                item.transaction_type && item.transaction_type.toLowerCase().includes(transaction_type.toLowerCase())
            );
        }
        if (transaction_status) {
            data = data.filter(item =>
                item.transaction_status && item.transaction_status.toLowerCase() === transaction_status.toLowerCase()
            );
        }
        if (credit_debit) {
            data = data.filter(item =>
                item.credit_debit && item.credit_debit.toLowerCase() === credit_debit.toLowerCase()
            );
        }

        // Calculate statistics
        const stats = helpers.calculateStats(data, ['transaction_amount', 'amount', 'Amount']);

        res.json({
            success: true,
            message: "Transaction history fetched successfully",
            filter_period: all ? 'All Time' : `${helpers.getMonthName(month)} ${year}`,
            month: all ? null : month,
            year: all ? null : year,
            total_records: data.length,
            summary: stats,
            data: data
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching transaction data",
            error: error.message
        });
    }
});

// ============================================
// MCP SPENDING ENDPOINTS
// ============================================

/**
 * @swagger
 * /api/mcp/spend/summary:
 *   get:
 *     summary: Get total spending summary
 *     tags: [Spending MCP]
 *     parameters:
 *       - in: query
 *         name: period
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Spending summary
 */
router.get('/mcp/spend/summary', async (req, res) => {
    try {
        const { period } = req.query;
        const dateRange = helpers.parsePeriod(period);

        // Fetch transactions (main + travelbuddy for comprehensive view)
        const [txns, travelTxns] = await Promise.all([
            helpers.getMcpData('transactions'),
            helpers.getMcpData('travelbuddy')
        ]);

        // Filter valid spending transactions
        const mainSpend = txns.filter(t => helpers.isDebit(t) && helpers.getTxnAmount(t) > 0);

        // TravelBuddy: filter for spend transactions (not loads)
        const travelSpend = travelTxns.filter(t => {
            if (helpers.isLoad(t)) return false;
            const amt = helpers.getTxnAmount(t);
            return amt > 0;
        });

        // Filter by date
        const filteredMain = helpers.filterByDate(mainSpend, dateRange, 'transaction_date_time');
        const filteredTravel = helpers.filterByDate(travelSpend, dateRange, 'Txn_Date');

        // Calculate totals
        let totalSpent = 0;
        let totalIncome = 0;
        let txnCount = 0;

        filteredMain.forEach(t => {
            totalSpent += helpers.getTxnAmount(t);
            txnCount++;
        });

        filteredTravel.forEach(t => {
            totalSpent += helpers.getTxnAmount(t);
            txnCount++;
        });

        // Calculate Income from main transactions (Credit)
        const mainIncome = txns.filter(t => helpers.isCredit(t));
        const filteredIncome = helpers.filterByDate(mainIncome, dateRange, 'transaction_date_time');
        filteredIncome.forEach(t => totalIncome += helpers.getTxnAmount(t));

        res.json({
            success: true,
            tool: 'spend_summary',
            period: dateRange.label,
            summary: {
                total_spent: Math.round(totalSpent * 100) / 100,
                total_income: Math.round(totalIncome * 100) / 100,
                net: Math.round((totalIncome - totalSpent) * 100) / 100,
                transaction_count: txnCount
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * @swagger
 * /api/mcp/spend/by-category:
 *   get:
 *     summary: Get spending breakdown by category
 *     tags: [Spending MCP]
 *     parameters:
 *       - in: query
 *         name: period
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Spending by category
 */
router.get('/mcp/spend/by-category', async (req, res) => {
    try {
        const { period } = req.query;
        const dateRange = helpers.parsePeriod(period);

        const txns = await helpers.getMcpData('transactions');

        // Filter spending transactions
        const spendTxns = txns.filter(t => helpers.isDebit(t) && helpers.getTxnAmount(t) > 0);
        const filtered = helpers.filterByDate(spendTxns, dateRange, 'transaction_date_time');

        // Group by category
        const categoryMap = {};
        filtered.forEach(t => {
            const category = t.mcc_category || t.MCC_Category || t.category || 'Other';
            if (!categoryMap[category]) {
                categoryMap[category] = { total: 0, count: 0 };
            }
            categoryMap[category].total += helpers.getTxnAmount(t);
            categoryMap[category].count++;
        });

        const categories = Object.entries(categoryMap)
            .map(([name, data]) => ({
                category: name,
                total_spent: Math.round(data.total * 100) / 100,
                transaction_count: data.count
            }))
            .sort((a, b) => b.total_spent - a.total_spent);

        res.json({
            success: true,
            tool: 'spend_by_category',
            period: dateRange.label,
            categories
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * @swagger
 * /api/mcp/spend/top-merchants:
 *   get:
 *     summary: Get top merchants by spending
 *     tags: [Spending MCP]
 *     parameters:
 *       - in: query
 *         name: period
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Top merchants
 */
router.get('/mcp/spend/top-merchants', async (req, res) => {
    try {
        const { period, limit } = req.query;
        const dateRange = helpers.parsePeriod(period);
        const limitNum = limit ? parseInt(limit) : 10;

        const txns = await helpers.getMcpData('transactions');

        // Filter spending transactions
        const spendTxns = txns.filter(t => helpers.isDebit(t) && helpers.getTxnAmount(t) > 0);
        const filtered = helpers.filterByDate(spendTxns, dateRange, 'transaction_date_time');

        // Group by merchant
        const merchantMap = {};
        filtered.forEach(t => {
            const merchant = t.merchant_name || t.other_party_name || t.description || 'Unknown';
            if (!merchantMap[merchant]) {
                merchantMap[merchant] = { total: 0, count: 0 };
            }
            merchantMap[merchant].total += helpers.getTxnAmount(t);
            merchantMap[merchant].count++;
        });

        const merchants = Object.entries(merchantMap)
            .map(([name, data]) => ({
                merchant: name,
                total_spent: Math.round(data.total * 100) / 100,
                transaction_count: data.count
            }))
            .sort((a, b) => b.total_spent - a.total_spent)
            .slice(0, limitNum);

        res.json({
            success: true,
            tool: 'top_merchants',
            period: dateRange.label,
            merchants
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * @swagger
 * /api/mcp/spend/search:
 *   get:
 *     summary: Search transactions
 *     tags: [Spending MCP]
 *     parameters:
 *       - in: query
 *         name: query
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *       - in: query
 *         name: offset
 *         schema: { type: integer }
 *       - in: query
 *         name: period
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Search results
 */
router.get('/mcp/spend/search', async (req, res) => {
    try {
        const { query, limit, offset, period } = req.query;
        if (!query) return res.json({ success: false, message: "query required" });

        const limitNum = limit ? parseInt(limit) : 5;
        const offsetNum = offset ? parseInt(offset) : 0;
        const dateRange = helpers.parsePeriod(period);

        const txns = await helpers.getMcpData('transactions');
        const lowerQuery = query.toLowerCase();

        let matches = txns.filter(t =>
            (t.merchant_name || '').toLowerCase().includes(lowerQuery) ||
            (t.other_party_name || '').toLowerCase().includes(lowerQuery) ||
            (t.description || '').toLowerCase().includes(lowerQuery) ||
            (t.mcc_category || '').toLowerCase().includes(lowerQuery)
        );

        matches = helpers.filterByDate(matches, dateRange, 'transaction_date_time');

        const paginated = matches.slice(offsetNum, offsetNum + limitNum);

        res.json({
            success: true,
            tool: 'find_transactions',
            query,
            period: dateRange.label,
            total_matches: matches.length,
            showing: paginated.length,
            offset: offsetNum,
            results: paginated.map(t => ({
                date: t.transaction_date_time,
                amount: helpers.getTxnAmount(t),
                merchant: t.merchant_name || t.other_party_name,
                category: t.mcc_category,
                type: t.credit_debit
            }))
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * @swagger
 * /api/mcp/spend/daily:
 *   get:
 *     summary: Get daily spending breakdown
 *     tags: [Spending MCP]
 *     parameters:
 *       - in: query
 *         name: period
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Daily spending timeline
 */
router.get('/mcp/spend/daily', async (req, res) => {
    try {
        const { period } = req.query;
        const dateRange = helpers.parsePeriod(period || 'week');

        const txns = await helpers.getMcpData('transactions');

        // Filter spending transactions
        const spendTxns = txns.filter(t => helpers.isDebit(t) && helpers.getTxnAmount(t) > 0);
        const filtered = helpers.filterByDate(spendTxns, dateRange, 'transaction_date_time');

        // Group by date
        const dailyMap = {};
        filtered.forEach(t => {
            const date = helpers.parseDate(t.transaction_date_time);
            if (date) {
                const dateKey = date.toISOString().split('T')[0];
                if (!dailyMap[dateKey]) {
                    dailyMap[dateKey] = { total: 0, count: 0 };
                }
                dailyMap[dateKey].total += helpers.getTxnAmount(t);
                dailyMap[dateKey].count++;
            }
        });

        const daily = Object.entries(dailyMap)
            .map(([date, data]) => ({
                date,
                total_spent: Math.round(data.total * 100) / 100,
                transaction_count: data.count
            }))
            .sort((a, b) => a.date.localeCompare(b.date));

        res.json({
            success: true,
            tool: 'daily_spend',
            period: dateRange.label,
            daily
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * @swagger
 * /api/mcp/spend/unusual:
 *   get:
 *     summary: Detect unusual spending
 *     tags: [Spending MCP]
 *     parameters:
 *       - in: query
 *         name: period
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Unusual transactions
 */
router.get('/mcp/spend/unusual', async (req, res) => {
    try {
        const { period } = req.query;
        const dateRange = helpers.parsePeriod(period);

        const txns = await helpers.getMcpData('transactions');

        // Filter spending transactions
        const spendTxns = txns.filter(t => helpers.isDebit(t) && helpers.getTxnAmount(t) > 0);
        const filtered = helpers.filterByDate(spendTxns, dateRange, 'transaction_date_time');

        // Calculate statistics for outlier detection
        const amounts = filtered.map(t => helpers.getTxnAmount(t));
        const avg = amounts.length ? amounts.reduce((a, b) => a + b, 0) / amounts.length : 0;
        const stdDev = amounts.length ? Math.sqrt(amounts.reduce((sq, n) => sq + Math.pow(n - avg, 2), 0) / amounts.length) : 0;

        // Flag transactions > 2 standard deviations above mean
        const threshold = avg + (2 * stdDev);
        const unusual = filtered
            .filter(t => helpers.getTxnAmount(t) > threshold)
            .map(t => ({
                date: t.transaction_date_time,
                amount: helpers.getTxnAmount(t),
                merchant: t.merchant_name || t.other_party_name,
                category: t.mcc_category,
                reason: 'Amount significantly above average'
            }))
            .sort((a, b) => b.amount - a.amount);

        res.json({
            success: true,
            tool: 'unusual_activity',
            period: dateRange.label,
            average_spend: Math.round(avg * 100) / 100,
            threshold: Math.round(threshold * 100) / 100,
            unusual_count: unusual.length,
            unusual_transactions: unusual.slice(0, 10)
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = initTransactionsRoutes;
