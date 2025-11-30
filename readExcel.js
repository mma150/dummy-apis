const XlsxPopulate = require('xlsx-populate');
const path = require('path');

const files = [
    "Vineet's Remittance.xlsx",
    "Vineet's Transactions.xlsx",
    "Vineet-Rewards History.xlsx",
    "Vineet-TravelBuddy Trxn History.xlsx"
];

async function readFiles() {
    for (const file of files) {
        console.log(`\n\n========== ${file} ==========`);
        try {
            const workbook = await XlsxPopulate.fromFileAsync(path.join(__dirname, file), { password: 'BFCxMobi@2468' });
            workbook.sheets().forEach(sheet => {
                console.log(`\n--- Sheet: ${sheet.name()} ---`);
                const usedRange = sheet.usedRange();
                if (usedRange) {
                    const data = usedRange.value();
                    // Print first 5 rows only to see headers and sample data
                    data.slice(0, 5).forEach((row, idx) => {
                        console.log(`Row ${idx + 1}:`, JSON.stringify(row));
                    });
                    console.log(`Total rows: ${data.length}`);
                }
            });
        } catch (err) {
            console.log(`Error reading file: ${err.message}`);
        }
    }
}

readFiles();
