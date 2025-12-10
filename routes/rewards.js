const express = require('express');
const router = express.Router();

// This will be injected from server.js
let helpers = null;

function initRewardsRoutes(deps) {
    helpers = deps;
    return router;
}

// ============================================
// REWARDS DATA API
// ============================================

/**
 * @swagger
 * /api/rewards:
 *   get:
 *     summary: Get rewards history
 *     tags: [Rewards]
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
 *         name: customerId
 *         schema: { type: string }
 *       - in: query
 *         name: type
 *         schema: { type: string }
 *         description: Sheet type (transactions, load, flyy_points)
 *     responses:
 *       200:
 *         description: Rewards history
 */
router.get('/', async (req, res) => {
    try {
        const { customerId, type } = req.query;
        const { month, year, all } = helpers.getMonthFilter(req.query);

        // Get all sheet names
        const sheetNames = await helpers.getSheetNames(helpers.EXCEL_FILES.rewards);

        // Read all sheets
        let response = {};
        for (const sheetName of sheetNames) {
            let sheetData = await helpers.readExcelSheet(helpers.EXCEL_FILES.rewards, sheetName);

            // Apply month filter (default: current month) unless all=true
            if (!all) {
                const dateField = sheetName === 'Flyy points' ? 'Created_At' : 'Txn_Date';
                sheetData = sheetData.filter(item => helpers.isDateInMonth(item[dateField], month, year));
            }

            // Apply customerId filter
            if (customerId) {
                sheetData = sheetData.filter(item => item.customerId == customerId);
            }

            // Normalize sheet name for response key
            const key = sheetName.toLowerCase().replace(/\s+/g, '_');
            response[key] = sheetData;
        }

        // Filter by type if specified
        if (type) {
            const typeKey = type.toLowerCase().replace(/\s+/g, '_');
            if (response[typeKey]) {
                response = { [typeKey]: response[typeKey] };
            }
        }

        // Calculate totals and stats per sheet
        let totalRecords = 0;
        let sheetSummaries = {};
        Object.entries(response).forEach(([key, arr]) => {
            totalRecords += arr.length;
            // Calculate stats for each sheet based on its fields
            const amountField = key === 'flyy_points' ? 'Points' : ['BHD_Amount', 'Amount', 'Txn_Amt', 'amount'];
            sheetSummaries[key] = helpers.calculateStats(arr, amountField);
        });

        res.json({
            success: true,
            message: "Rewards history fetched successfully",
            filter_period: all ? 'All Time' : `${helpers.getMonthName(month)} ${year}`,
            month: all ? null : month,
            year: all ? null : year,
            sheets: Object.keys(response),
            total_records: totalRecords,
            summary: sheetSummaries,
            data: response
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching rewards data",
            error: error.message
        });
    }
});

// ============================================
// MCP REWARDS ENDPOINTS
// ============================================

/**
 * @swagger
 * /api/mcp/rewards/summary:
 *   get:
 *     summary: Get rewards summary
 *     tags: [Rewards MCP]
 *     responses:
 *       200:
 *         description: Points and cashback summary
 */
router.get('/mcp/summary', async (req, res) => {
    try {
        const rewards = await helpers.getMcpData('rewards');

        let totalPoints = 0;
        let totalCashback = 0;

        rewards.forEach(r => {
            const sheet = (r._sheet || '').toLowerCase();
            const amt = helpers.parseAmount(r.Points || r.BHD_Amount || r.Amount || r.amount);

            if (sheet.includes('flyy') || sheet.includes('points')) {
                totalPoints += amt;
            } else {
                totalCashback += amt; // BHD usually
            }
        });

        res.json({
            success: true,
            tool: 'rewards_summary',
            total_points: Math.round(totalPoints),
            total_cashback_bhd: Math.round(totalCashback * 100) / 100,
            // Mock tier
            tier: totalPoints > 10000 ? 'Platinum' : (totalPoints > 5000 ? 'Gold' : 'Silver'),
            next_tier_progress: 75 // Mock
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * @swagger
 * /api/mcp/rewards/activity:
 *   get:
 *     summary: Get rewards activity history
 *     tags: [Rewards MCP]
 *     parameters:
 *       - in: query
 *         name: period
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: History of earned rewards
 */
router.get('/mcp/activity', async (req, res) => {
    try {
        const { period } = req.query;
        const dateRange = helpers.parsePeriod(period);

        const rewards = await helpers.getMcpData('rewards');

        // Filter by date (look for various date fields)
        const activity = rewards.filter(r => {
            const dateStr = r.Created_At || r.Txn_Date || r.Date || r.timestamp;
            const date = helpers.parseDate(dateStr);
            if (!date) return false;

            if (dateRange.start && date < dateRange.start) return false;
            if (dateRange.end && date > dateRange.end) return false;
            return true;
        });

        // Helper to format date properly
        const formatDate = (rawDate) => {
            const date = helpers.parseDate(rawDate);
            if (!date || isNaN(date.getTime())) return null;
            // Format as YYYY-MM-DD HH:mm:ss
            const pad = (n) => String(n).padStart(2, '0');
            return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
        };

        // Map to standard format
        const standardActivity = activity.map(r => {
            const rawDate = r.Created_At || r.Txn_Date || r.Date || r.timestamp;
            return {
                date: formatDate(rawDate) || rawDate, // Format the date, fallback to raw if parsing fails
                description: r.Description || r.Txn_Det || r.Event || 'Reward',
                amount: helpers.parseAmount(r.Points || r.BHD_Amount || r.Amount || r.amount),
                type: (r._sheet || '').toLowerCase().includes('point') ? 'Points' : 'Cashback'
            };
        }).sort((a, b) => {
            const dateA = helpers.parseDate(a.date);
            const dateB = helpers.parseDate(b.date);
            return (dateB || 0) - (dateA || 0);
        });

        res.json({
            success: true,
            tool: 'rewards_activity',
            period: dateRange.label,
            count: standardActivity.length,
            activity: standardActivity.slice(0, 50)
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * @swagger
 * /api/mcp/rewards/expiry-alerts:
 *   get:
 *     summary: Get expiring rewards alerts
 *     tags: [Rewards MCP]
 *     responses:
 *       200:
 *         description: List of expiring points
 */
router.get('/mcp/expiry-alerts', async (req, res) => {
    try {
        // Mock logic: 10% of total points expiring in 30 days
        const rewards = await helpers.getMcpData('rewards');

        const expiringPoints = [];
        // Add a mock expiring item
        expiringPoints.push({
            amount: 500,
            expiry_date: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 15 days from now
            description: "Promotional Bonus Points"
        });

        res.json({
            success: true,
            tool: 'rewards_expiry',
            alerts: expiringPoints
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * @swagger
 * /api/mcp/rewards/best-strategy:
 *   get:
 *     summary: Get best rewards strategy for a category
 *     tags: [Rewards MCP]
 *     parameters:
 *       - in: query
 *         name: category
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Recommendation for maximizing rewards
 */
router.get('/mcp/best-strategy', async (req, res) => {
    try {
        const { category } = req.query;
        // Mock rules engine
        const rules = {
            'dining': "Use your Platinum Card for 5x points on dining.",
            'grocery': "Use Gold Card for 3% cashback at supermarkets.",
            'travel': "Book via the portal for 10x points on hotels.",
            'fuel': "Use Debit Card for 2% instant cashback."
        };

        const rec = rules[(category || '').toLowerCase()] || "Use your Platinum Card for 1.5x points on general spend.";

        res.json({
            success: true,
            tool: 'rewards_strategy',
            category: category || 'General',
            recommendation: rec
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = initRewardsRoutes;
