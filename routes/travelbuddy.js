const express = require('express');
const router = express.Router();

// This will be injected from server.js
let helpers = null;

function initTravelBuddyRoutes(deps) {
    helpers = deps;
    return router;
}

// Helper to deduce trips from transactions
// Returns array of { trip_id: 'country_YYYYMM', country, start_date, end_date, total_spend }
function identifyTrips(travelTxns) {
    if (!travelTxns || travelTxns.length === 0) return [];

    // Sort by date
    const sorted = [...travelTxns].sort((a, b) => {
        const da = helpers.parseDate(a.Txn_Date);
        const db = helpers.parseDate(b.Txn_Date);
        return da - db;
    });

    const trips = [];
    let currentTrip = null;

    sorted.forEach(t => {
        // Only look at foreign transactions (country != 'Bahrain')
        // Use 'Country' field (capital C) as that's the actual field name in Excel
        let country = t.Country || t.country || 'Unknown';
        
        // Handle cases where country is an error object (e.g., {_error: "#N/A"})
        if (typeof country === 'object') {
            country = 'Unknown';
        }
        
        // Skip records with Unknown or Bahrain
        if (country === 'Bahrain' || country === 'Unknown' || !country) return;

        const date = helpers.parseDate(t.Txn_Date);
        if (!date) return;

        // If no current trip or country different or "gap" > 7 days => new trip
        const isDifferentCountry = currentTrip && currentTrip.country !== country;
        const isTimeGap = currentTrip && (date - currentTrip.end_date) > (7 * 24 * 60 * 60 * 1000);

        if (!currentTrip || isDifferentCountry || isTimeGap) {
            if (currentTrip) trips.push(currentTrip);

            // Start new trip
            currentTrip = {
                trip_id: `${country}_${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}_${date.getDate()}`.replace(/\s+/g, ''),
                country: country,
                start_date: date,
                end_date: date,
                transaction_count: 0,
                total_spend: 0
            };
        }

        // Add to current trip
        currentTrip.end_date = date; // extend end date
        currentTrip.transaction_count++;
        // Add amount if it's a spend (not load) - case-insensitive check
        const txnType = (t.transactionType_dsc || '').toUpperCase();
        if (txnType !== 'LOAD') {
            currentTrip.total_spend += helpers.parseAmount(t.Amount || t.BHD_Amount || t.amount || t.txn_amt || t.bill_amt);
        }
    });

    if (currentTrip) trips.push(currentTrip);
    return trips;
}

// ============================================
// TRAVELBUDDY DATA API
// ============================================

/**
 * @swagger
 * /api/travelbuddy:
 *   get:
 *     summary: Get TravelBuddy transaction history
 *     tags: [TravelBuddy]
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
 *         description: Sheet type (transactions, load)
 *       - in: query
 *         name: country
 *         schema: { type: string }
 *       - in: query
 *         name: transactionType
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: TravelBuddy transaction history
 */
router.get('/', async (req, res) => {
    try {
        const { customerId, type, country, transactionType } = req.query;
        const { month, year, all } = helpers.getMonthFilter(req.query);

        // Get all sheet names
        const sheetNames = await helpers.getSheetNames(helpers.EXCEL_FILES.travelbuddy);

        // Read all sheets
        let response = {};
        for (const sheetName of sheetNames) {
            let sheetData = await helpers.readExcelSheet(helpers.EXCEL_FILES.travelbuddy, sheetName);

            // Apply month filter (default: current month) unless all=true
            if (!all) {
                sheetData = sheetData.filter(item => helpers.isDateInMonth(item.Txn_Date, month, year));
            }

            // Apply customerId filter
            if (customerId) {
                sheetData = sheetData.filter(item => item.customerId == customerId);
            }

            // Apply country filter (only for transaction sheets)
            if (country && sheetName.toLowerCase().includes('transaction')) {
                sheetData = sheetData.filter(item =>
                    item.country && item.country.toLowerCase().includes(country.toLowerCase())
                );
            }

            // Apply transactionType filter
            if (transactionType) {
                sheetData = sheetData.filter(item =>
                    item.transactionType_dsc && item.transactionType_dsc.toLowerCase() === transactionType.toLowerCase()
                );
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
            // Calculate stats for each sheet
            sheetSummaries[key] = helpers.calculateStats(arr, ['BHD_Amount', 'Txn_Amt', 'Amount', 'amount', 'txn_amt']);
        });

        res.json({
            success: true,
            message: "TravelBuddy transaction history fetched successfully",
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
            message: "Error fetching TravelBuddy data",
            error: error.message
        });
    }
});

// ============================================
// MCP TRAVEL/TRAVELBUDDY ENDPOINTS
// ============================================

/**
 * @swagger
 * /api/mcp/travel/trips:
 *   get:
 *     summary: List travel trips
 *     description: Identifies trips based on foreign currency transactions.
 *     tags: [Travel MCP]
 *     parameters:
 *       - in: query
 *         name: period
 *         schema: { type: string }
 *         description: Filter by period (e.g., "this month", "last 3 months", "2024", "January")
 *     responses:
 *       200:
 *         description: List of identified trips
 */
router.get('/mcp/trips', async (req, res) => {
    try {
        const { period } = req.query;
        const dateRange = helpers.parsePeriod(period);
        
        let txns = await helpers.getMcpData('travelbuddy');
        
        // Filter by period if specified
        if (dateRange.start || dateRange.end) {
            txns = txns.filter(t => {
                const date = helpers.parseDate(t.Txn_Date);
                if (!date) return false;
                if (dateRange.start && date < dateRange.start) return false;
                if (dateRange.end && date > dateRange.end) return false;
                return true;
            });
        }
        
        const trips = identifyTrips(txns);

        // Return summary list
        const summary = trips.map(t => ({
            country: t.country,
            dates: `${t.start_date.toISOString().split('T')[0]} to ${t.end_date.toISOString().split('T')[0]}`,
            spend: Math.round(t.total_spend * 100) / 100
        })).sort((a, b) => new Date(b.dates.split(' to ')[0]) - new Date(a.dates.split(' to ')[0])); // Newest first

        res.json({
            success: true,
            tool: 'travel_trips',
            period: dateRange.label,
            count: summary.length,
            trips: summary
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * @swagger
 * /api/mcp/travel/trip-spend:
 *   get:
 *     summary: Get details of a specific trip
 *     tags: [Travel MCP]
 *     parameters:
 *       - in: query
 *         name: trip_id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Trip spend details
 */
router.get('/mcp/trip-spend', async (req, res) => {
    try {
        const { trip_id } = req.query;
        if (!trip_id) return res.json({ success: false, message: "trip_id required" });

        const txns = await helpers.getMcpData('travelbuddy');
        const trips = identifyTrips(txns);
        const trip = trips.find(t => t.trip_id === trip_id);

        if (!trip) return res.status(404).json({ success: false, message: "Trip not found" });

        // Filter original transactions for this trip
        const tripTxns = txns.filter(t => {
            const date = helpers.parseDate(t.Txn_Date);
            const txnType = (t.transactionType_dsc || '').toUpperCase();
            return t.country === trip.country &&
                date >= trip.start_date &&
                date <= trip.end_date &&
                txnType !== 'LOAD';
        });

        // Top categories for this trip
        const catMap = {};
        tripTxns.forEach(t => {
            const cat = t.MCC_Category || t.mcc_description || 'General';
            const amt = helpers.parseAmount(t.amount || t.txn_amt || t.bill_amt);
            if (!catMap[cat]) catMap[cat] = 0;
            catMap[cat] += amt;
        });

        res.json({
            success: true,
            tool: 'travel_trip_spend',
            trip: {
                country: trip.country,
                total_spend: Math.round(trip.total_spend * 100) / 100,
                duration_days: Math.ceil((trip.end_date - trip.start_date) / (1000 * 60 * 60 * 24)) + 1
            },
            categories: Object.entries(catMap)
                .map(([name, amount]) => ({ name, amount: Math.round(amount * 100) / 100 }))
                .sort((a, b) => b.amount - a.amount)
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * @swagger
 * /api/mcp/travel/load-vs-spend:
 *   get:
 *     summary: Compare travel wallet load vs spend
 *     tags: [Travel MCP]
 *     parameters:
 *       - in: query
 *         name: trip_id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Load vs Spend analysis
 */
router.get('/mcp/load-vs-spend', async (req, res) => {
    try {
        const { trip_id } = req.query;
        if (!trip_id) return res.json({ success: false, message: "trip_id required" });

        const txns = await helpers.getMcpData('travelbuddy');
        const trips = identifyTrips(txns);
        const trip = trips.find(t => t.trip_id === trip_id);

        if (!trip) return res.status(404).json({ success: false, message: "Trip not found" });

        // Find loads for this trip (same country/currency, roughly same time maybe slightly before)
        const loadStart = new Date(trip.start_date);
        loadStart.setDate(loadStart.getDate() - 7);

        const tripLoads = txns.filter(t => {
            const date = helpers.parseDate(t.Txn_Date);
            const txnType = (t.transactionType_dsc || '').toUpperCase();
            return txnType === 'LOAD' &&
                date >= loadStart &&
                date <= trip.end_date;
        });

        const totalLoaded = tripLoads.reduce((sum, t) => sum + helpers.parseAmount(t.amount || t.txn_amt), 0);
        const totalSpent = trip.total_spend;

        res.json({
            success: true,
            tool: 'travel_load_vs_spend',
            trip_id,
            total_loaded: Math.round(totalLoaded * 100) / 100,
            total_spent: Math.round(totalSpent * 100) / 100,
            remaining: Math.round((totalLoaded - totalSpent) * 100) / 100,
            utilization_pct: totalLoaded ? Math.round((totalSpent / totalLoaded) * 100) : 0
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * @swagger
 * /api/mcp/travel/compare:
 *   get:
 *     summary: Compare two trips
 *     tags: [Travel MCP]
 *     parameters:
 *       - in: query
 *         name: trip_id_1
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: trip_id_2
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Trip comparison
 */
router.get('/mcp/compare', async (req, res) => {
    try {
        const { trip_id_1, trip_id_2 } = req.query;
        if (!trip_id_1 || !trip_id_2) return res.json({ success: false, message: "Two trip IDs required" });

        const txns = await helpers.getMcpData('travelbuddy');
        const trips = identifyTrips(txns);
        const t1 = trips.find(t => t.trip_id === trip_id_1);
        const t2 = trips.find(t => t.trip_id === trip_id_2);

        if (!t1 || !t2) return res.status(404).json({ success: false, message: "One or both trips not found" });

        res.json({
            success: true,
            tool: 'travel_compare',
            comparison: {
                trip_1: {
                    country: t1.country,
                    total_spend: Math.round(t1.total_spend * 100) / 100,
                    daily_avg: Math.round((t1.total_spend / ((t1.end_date - t1.start_date) / (86400000) + 1)) * 100) / 100
                },
                trip_2: {
                    country: t2.country,
                    total_spend: Math.round(t2.total_spend * 100) / 100,
                    daily_avg: Math.round((t2.total_spend / ((t2.end_date - t2.start_date) / (86400000) + 1)) * 100) / 100
                },
                difference_spend: Math.round((t1.total_spend - t2.total_spend) * 100) / 100
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * @swagger
 * /api/mcp/travel/currency-mix:
 *   get:
 *     summary: Get currency usage for a trip
 *     tags: [Travel MCP]
 *     parameters:
 *       - in: query
 *         name: trip_id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Currency mix analysis
 */
router.get('/mcp/currency-mix', async (req, res) => {
    try {
        const { trip_id } = req.query;
        if (!trip_id) return res.json({ success: false, message: "trip_id required" });

        const txns = await helpers.getMcpData('travelbuddy');
        const trips = identifyTrips(txns);
        const trip = trips.find(t => t.trip_id === trip_id);

        if (!trip) return res.status(404).json({ success: false, message: "Trip not found" });

        // Filter txns for trip
        const tripTxns = txns.filter(t => {
            const date = helpers.parseDate(t.Txn_Date);
            const txnType = (t.transactionType_dsc || '').toUpperCase();
            return t.country === trip.country &&
                date >= trip.start_date &&
                date <= trip.end_date &&
                txnType !== 'LOAD';
        });

        const currencyMap = {};
        tripTxns.forEach(t => {
            const curr = t.txn_curr || 'BHD';
            const amt = helpers.parseAmount(t.txn_amt || t.amount); // amount in foreign currency
            if (!currencyMap[curr]) currencyMap[curr] = 0;
            currencyMap[curr] += amt;
        });

        res.json({
            success: true,
            tool: 'travel_currency_mix',
            currencies: Object.entries(currencyMap)
                .map(([code, amount]) => ({ code, amount: Math.round(amount * 100) / 100 }))
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = initTravelBuddyRoutes;
