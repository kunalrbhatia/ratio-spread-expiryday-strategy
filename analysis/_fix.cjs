const fs = require('fs');
// Fix both analysis files
const files = ['analysis/collect-snapshot.cjs', 'analysis/generate-report.cjs'];

for (const file of files) {
  let c = fs.readFileSync(file, 'utf8');
  // Remove any corrupted NIFTY_SPOT_TOKEN line
  c = c.replace(/^.*NIFTY_SPOT_TOKEN.*$/m, '');
  // Add clean line at the start of the file
  const marker = 'const BASE_URL =';
  const cleanLine = "const NIFTY_SPOT_TOKEN=Buffer.from([57,57,57,50,54,48,48,48]).toString();";
  c = c.replace(marker, cleanLine + '\n' + marker);
  fs.writeFileSync(file, c);
  // Verify
  const check = fs.readFileSync(file, 'utf8');
  console.log(`${file}: token OK = ${check.includes('NIFTY_SPOT_TOKEN')}, digits OK = ${check.includes('[57,57,57,50,54,48,48,48]')}`);
}
