const express = require('express');
const router = express.Router();

// This will be injected from server.js
let helpers = null;

function initRemittanceRoutes(deps) {
    helpers = deps;
    return router;
}

// ============================================
// REMITTANCE DATA API
// ============================================

/**
 * @swagger
 * /api/remittance:
 *   get:
 *     summary: Get remittance history
 *     tags: [Remittance]
 *     parameters:
 *       - in: query
 *         name: month
 *         schema: { type: integer }
 *         description: Month (1-12)
 *       - in: query
 *         name: year
 *         schema: { type: integer }
 *         description: Year (e.g., 2024)
 *       - in: query
 *         name: all
 *         schema: { type: boolean }
 *         description: Get all records (ignore month filter)
 *       - in: query
 *         name: cpr
 *         schema: { type: string }
 *       - in: query
 *         name: paymentmode
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Remittance history
 */
router.get('/', async (req, res) => {
    try {
        const { cpr, paymentmode, status } = req.query;
        const { month, year, all } = helpers.getMonthFilter(req.query);

        // Read data from Excel file
        let data = await helpers.readExcelSheet(helpers.EXCEL_FILES.remittance);

        // Apply month filter (default: current month) unless all=true
        if (!all) {
            data = data.filter(item => helpers.isDateInMonth(item.timestamp_created, month, year));
        }

        // Apply filters
        if (cpr) {
            data = data.filter(item => item.cpr == cpr);
        }
        if (paymentmode) {
            data = data.filter(item =>
                item.paymentmode && item.paymentmode.toLowerCase().includes(paymentmode.toLowerCase())
            );
        }
        if (status !== undefined) {
            data = data.filter(item => item.status === (status === 'true'));
        }

        // Calculate statistics
        const stats = helpers.calculateStats(data, ['total_amount_in_BHD', 'amount']);

        res.json({
            success: true,
            message: "Remittance history fetched successfully",
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
            message: "Error fetching remittance data",
            error: error.message
        });
    }
});

// ============================================
// MCP REMITTANCE ENDPOINTS
// ============================================

/**
 * @swagger
 * /api/mcp/remittance/summary:
 *   get:
 *     summary: Get remittance summary
 *     tags: [Remittance MCP]
 *     parameters:
 *       - in: query
 *         name: year
 *         schema: { type: integer }
 *       - in: query
 *         name: month
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Monthly/Yearly remittance summary
 */
router.get('/mcp/summary', async (req, res) => {
    try {
        const { year, month } = req.query;
        const targetYear = year ? parseInt(year) : new Date().getFullYear();
        const targetMonth = month ? parseInt(month) : null;

        const txns = await helpers.getMcpData('remittance');

        // Filter by year and optionally by month
        const filteredTxns = txns.filter(t => {
            const date = helpers.parseDate(t.timestamp_created);
            if (!date || t.status === false) return false;
            if (date.getFullYear() !== targetYear) return false;
            if (targetMonth && (date.getMonth() + 1) !== targetMonth) return false;
            return true;
        });

        const totalAmount = filteredTxns.reduce((sum, t) => sum + helpers.parseAmount(t.total_amount_in_BHD), 0);

        // Build period label
        const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        const periodLabel = targetMonth ? `${MONTH_NAMES[targetMonth - 1]} ${targetYear}` : `Year ${targetYear}`;

        res.json({
            success: true,
            tool: 'remittance_summary',
            period: periodLabel,
            year: targetYear,
            month: targetMonth || null,
            total_remitted: Math.round(totalAmount * 100) / 100,
            count: filteredTxns.length,
            average_amount: filteredTxns.length ? Math.round((totalAmount / filteredTxns.length) * 100) / 100 : 0
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * @swagger
 * /api/mcp/remittance/recipient:
 *   get:
 *     summary: Get stats for a specific recipient
 *     tags: [Remittance MCP]
 *     parameters:
 *       - in: query
 *         name: recipient_name
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Recipient statistics
 */
router.get('/mcp/recipient', async (req, res) => {
    try {
        const { recipient_name } = req.query;
        if (!recipient_name) return res.json({ success: false, message: "recipient_name required" });

        const txns = await helpers.getMcpData('remittance');
        const lowerName = recipient_name.toLowerCase();

        // Find matches (fuzzy)
        const matches = txns.filter(t =>
            (t.beneficiary_name || '').toLowerCase().includes(lowerName) && t.status !== false
        );

        const totalAmount = matches.reduce((sum, t) => sum + helpers.parseAmount(t.total_amount_in_BHD), 0);

        // Last sent date
        let lastSent = null;
        if (matches.length > 0) {
            const sorted = matches.map(t => helpers.parseDate(t.timestamp_created)).sort((a, b) => b - a);
            lastSent = sorted[0];
        }

        res.json({
            success: true,
            tool: 'remittance_recipient',
            recipient: recipient_name,
            total_sent: Math.round(totalAmount * 100) / 100,
            transaction_count: matches.length,
            last_sent: lastSent ? lastSent.toISOString().split('T')[0] : null
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * @swagger
 * /api/mcp/remittance/trend:
 *   get:
 *     summary: Get remittance trend over years
 *     tags: [Remittance MCP]
 *     parameters:
 *       - in: query
 *         name: years
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Year-over-year remittance trend
 */
router.get('/mcp/trend', async (req, res) => {
    try {
        const { years } = req.query;
        const numYears = years ? parseInt(years) : 3;
        const currentYear = new Date().getFullYear();

        const txns = await helpers.getMcpData('remittance');

        const trend = [];
        for (let i = 0; i < numYears; i++) {
            const y = currentYear - i;
            const yearTxns = txns.filter(t => {
                const date = helpers.parseDate(t.timestamp_created);
                return date && date.getFullYear() === y && t.status !== false;
            });
            const total = yearTxns.reduce((sum, t) => sum + helpers.parseAmount(t.total_amount_in_BHD), 0);
            trend.push({
                year: y,
                total_remitted: Math.round(total * 100) / 100,
                count: yearTxns.length
            });
        }

        res.json({
            success: true,
            tool: 'remittance_trend',
            trend: trend.reverse()
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * @swagger
 * /api/mcp/remittance/search:
 *   get:
 *     summary: Search remittance transactions
 *     tags: [Remittance MCP]
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
 *     responses:
 *       200:
 *         description: Search results
 */
router.get('/mcp/search', async (req, res) => {
    try {
        const { query, limit, offset } = req.query;
        if (!query) return res.json({ success: false, message: "query required" });

        const limitNum = limit ? parseInt(limit) : 5;
        const offsetNum = offset ? parseInt(offset) : 0;

        const txns = await helpers.getMcpData('remittance');
        const lowerQuery = query.toLowerCase();

        const matches = txns.filter(t =>
            (t.purpose_of_payment || '').toLowerCase().includes(lowerQuery) ||
            (t.beneficiary_name || '').toLowerCase().includes(lowerQuery) ||
            (t.biller_name || '').toLowerCase().includes(lowerQuery)
        );

        const paginated = matches.slice(offsetNum, offsetNum + limitNum);

        res.json({
            success: true,
            tool: 'remittance_search',
            query,
            total_matches: matches.length,
            showing: paginated.length,
            offset: offsetNum,
            results: paginated.map(t => ({
                date: t.timestamp_created,
                amount: helpers.parseAmount(t.total_amount_in_BHD),
                beneficiary: t.beneficiary_name || t.biller_name,
                purpose: t.purpose_of_payment,
                status: t.status
            }))
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * @swagger
 * /api/mcp/remittance/fx-rate:
 *   get:
 *     summary: Get current FX rate
 *     tags: [Remittance MCP]
 *     parameters:
 *       - in: query
 *         name: currency
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Exchange rate
 */
router.get('/mcp/fx-rate', async (req, res) => {
    try {
        const { currency } = req.query;
        if (!currency) return res.json({ success: false, message: "currency required" });

        // Mock FX rates (in production, integrate with live API)
        const FX_RATES = {
            'INR': 22.15,
            'PHP': 14.85,
            'USD': 0.376,
            'EUR': 0.345,
            'GBP': 0.297,
            'PKR': 74.5,
            'BDT': 28.4,
            'NPR': 35.4
        };

        const rate = FX_RATES[currency.toUpperCase()] || null;

        res.json({
            success: true,
            tool: 'remittance_fx_rate',
            base_currency: 'BHD',
            target_currency: currency.toUpperCase(),
            rate: rate,
            message: rate ? `1 BHD = ${rate} ${currency.toUpperCase()}` : 'Currency not found'
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = initRemittanceRoutes;
